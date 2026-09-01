/**
 * Optional agent tools for 1Password vault/item operations.
 *
 * These run in-process (no exec sandbox) and are only registered when the
 * operator sets `tools.enabled` (and `tools.allowWrite` for mutating tools).
 * Read tools redact concealed field values by default so secrets are not
 * casually surfaced into model context.
 */

import { Type, type Static, type TSchema } from "typebox";

import type { OnePasswordClient } from "./op-client.js";

/** Structural mirror of OpenClaw's AgentTool, kept local to avoid a hard SDK type import. */
export interface PluginTool {
  name: string;
  description: string;
  label: string;
  parameters: TSchema;
  outputSchema?: TSchema;
  execute: (
    toolCallId: string,
    params: unknown,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;
}

export type ClientFactory = () => Promise<OnePasswordClient>;

export interface CreateToolsOptions {
  getClient: ClientFactory;
  allowWrite: boolean;
}

/** 1Password item categories accepted by the create/update tools. */
const ITEM_CATEGORIES = [
  "Login",
  "SecureNote",
  "CreditCard",
  "CryptoWallet",
  "Identity",
  "Password",
  "Document",
  "ApiCredentials",
  "BankAccount",
  "Database",
  "DriverLicense",
  "Email",
  "MedicalRecord",
  "Membership",
  "OutdoorLicense",
  "Passport",
  "Rewards",
  "Router",
  "Server",
  "SshKey",
  "SocialSecurityNumber",
  "SoftwareLicense",
  "Person",
] as const;

const FIELD_TYPES = [
  "Text",
  "Concealed",
  "CreditCardType",
  "CreditCardNumber",
  "Phone",
  "Url",
  "Totp",
  "Email",
  "Reference",
  "Menu",
  "MonthYear",
  "Date",
] as const;

const CONCEALED_FIELD_TYPES = new Set(["Concealed", "Totp"]);

const FieldInput = Type.Object({
  title: Type.String({ description: "Field label, e.g. 'password' or 'api_key'." }),
  value: Type.String({ description: "Field value." }),
  fieldType: Type.Optional(
    Type.Union(
      FIELD_TYPES.map((t) => Type.Literal(t)),
      { description: "Field type; defaults to 'Text' ('Concealed' for secrets)." },
    ),
  ),
  sectionId: Type.Optional(Type.String()),
});
type FieldInput = Static<typeof FieldInput>;

function text(value: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: value }] };
}

interface RedactableField {
  id: string;
  title: string;
  fieldType: string;
  value: string;
  sectionId?: string;
}

function projectFields(
  fields: ReadonlyArray<RedactableField>,
  includeSecrets: boolean,
): Array<Record<string, unknown>> {
  return fields.map((field) => {
    const concealed = CONCEALED_FIELD_TYPES.has(field.fieldType);
    return {
      id: field.id,
      title: field.title,
      fieldType: field.fieldType,
      sectionId: field.sectionId,
      value: concealed && !includeSecrets ? "<concealed>" : field.value,
    };
  });
}

function assertWriteEnabled(allowWrite: boolean, tool: string): void {
  if (!allowWrite) {
    throw new Error(
      `Tool "${tool}" is disabled. Set plugins.entries.onepassword.config.tools.allowWrite = true to enable write operations.`,
    );
  }
}

export function createTools(options: CreateToolsOptions): PluginTool[] {
  const { getClient, allowWrite } = options;

  const listVaults: PluginTool = {
    name: "1password_list_vaults",
    label: "List 1Password vaults",
    description: "List all 1Password vaults accessible to the configured service account.",
    parameters: Type.Object({}),
    execute: async () => {
      const client = await getClient();
      const vaults = await client.listVaults();
      const summary = vaults.map((v) => ({ id: v.id, title: v.title }));
      return { ...text(JSON.stringify(summary, null, 2)), details: { vaults: summary } };
    },
  };

  const ListItemsParams = Type.Object({
    vaultId: Type.String({ description: "Vault ID (from 1password_list_vaults)." }),
  });
  const listItems: PluginTool = {
    name: "1password_list_items",
    label: "List 1Password items",
    description: "List items in a 1Password vault. Returns overviews only (no field values).",
    parameters: ListItemsParams,
    execute: async (_id, raw) => {
      const params = raw as Static<typeof ListItemsParams>;
      const client = await getClient();
      const items = await client.listItems(params.vaultId);
      const summary = items.map((i) => ({
        id: i.id,
        title: i.title,
        category: i.category,
        state: i.state,
      }));
      return { ...text(JSON.stringify(summary, null, 2)), details: { items: summary } };
    },
  };

  const GetItemParams = Type.Object({
    vaultId: Type.String(),
    itemId: Type.String(),
    includeSecrets: Type.Optional(
      Type.Boolean({
        description: "Return concealed field values in plaintext. Defaults to false.",
      }),
    ),
  });
  const getItem: PluginTool = {
    name: "1password_get_item",
    label: "Get 1Password item",
    description:
      "Get a full 1Password item including its fields. Concealed values are redacted unless includeSecrets is true.",
    parameters: GetItemParams,
    execute: async (_id, raw) => {
      const params = raw as Static<typeof GetItemParams>;
      const client = await getClient();
      const item = await client.getItem(params.vaultId, params.itemId);
      const projected = {
        id: item.id,
        title: item.title,
        category: item.category,
        vaultId: item.vaultId,
        tags: item.tags,
        notes: item.notes,
        fields: projectFields(item.fields, params.includeSecrets === true),
      };
      return { ...text(JSON.stringify(projected, null, 2)), details: projected };
    },
  };

  const ReadFieldParams = Type.Object({
    reference: Type.String({
      description: "1Password secret reference, e.g. op://Vault/Item/field.",
      pattern: "^op://",
    }),
  });
  const readField: PluginTool = {
    name: "1password_read_field",
    label: "Read 1Password field",
    description:
      "Resolve a single op:// secret reference to its value. Returns the secret in plaintext — use deliberately.",
    parameters: ReadFieldParams,
    execute: async (_id, raw) => {
      const params = raw as Static<typeof ReadFieldParams>;
      const client = await getClient();
      const value = await client.resolve(params.reference);
      return { ...text(value), details: { reference: params.reference, resolved: true } };
    },
  };

  const tools: PluginTool[] = [listVaults, listItems, getItem, readField];

  if (!allowWrite) return tools;

  const CreateItemParams = Type.Object({
    vaultId: Type.String(),
    title: Type.String(),
    category: Type.Union(
      ITEM_CATEGORIES.map((c) => Type.Literal(c)),
      { description: "1Password item category." },
    ),
    fields: Type.Optional(Type.Array(FieldInput)),
    tags: Type.Optional(Type.Array(Type.String())),
    notes: Type.Optional(Type.String()),
  });
  const createItem: PluginTool = {
    name: "1password_create_item",
    label: "Create 1Password item",
    description: "Create a new item in a 1Password vault.",
    parameters: CreateItemParams,
    execute: async (_id, raw) => {
      assertWriteEnabled(allowWrite, "1password_create_item");
      const params = raw as Static<typeof CreateItemParams>;
      const client = await getClient();
      const created = await client.createItem({
        vaultId: params.vaultId,
        title: params.title,
        // Enum values equal their string names in @1password/sdk.
        category: params.category as never,
        fields: mapFields(params.fields),
        tags: params.tags,
        notes: params.notes,
      } as never);
      return {
        ...text(`Created item ${created.id} (${created.title}).`),
        details: { id: created.id, title: created.title, vaultId: created.vaultId },
      };
    },
  };

  const UpdateItemParams = Type.Object({
    vaultId: Type.String(),
    itemId: Type.String(),
    title: Type.Optional(Type.String()),
    fields: Type.Optional(
      Type.Array(FieldInput, {
        description: "Replacement field set. When provided, replaces the item's fields.",
      }),
    ),
    tags: Type.Optional(Type.Array(Type.String())),
    notes: Type.Optional(Type.String()),
  });
  const updateItem: PluginTool = {
    name: "1password_update_item",
    label: "Update 1Password item",
    description:
      "Update an existing 1Password item. Fetches the current item, applies the provided changes, and saves it.",
    parameters: UpdateItemParams,
    execute: async (_id, raw) => {
      assertWriteEnabled(allowWrite, "1password_update_item");
      const params = raw as Static<typeof UpdateItemParams>;
      const client = await getClient();
      const current = await client.getItem(params.vaultId, params.itemId);
      const next = {
        ...current,
        ...(params.title !== undefined ? { title: params.title } : {}),
        ...(params.tags !== undefined ? { tags: params.tags } : {}),
        ...(params.notes !== undefined ? { notes: params.notes } : {}),
        ...(params.fields !== undefined ? { fields: mapFields(params.fields) } : {}),
      };
      const saved = await client.updateItem(next as never);
      return {
        ...text(`Updated item ${saved.id} (${saved.title}).`),
        details: { id: saved.id, title: saved.title, version: saved.version },
      };
    },
  };

  const DeleteItemParams = Type.Object({
    vaultId: Type.String(),
    itemId: Type.String(),
  });
  const deleteItem: PluginTool = {
    name: "1password_delete_item",
    label: "Delete 1Password item",
    description: "Permanently delete a 1Password item.",
    parameters: DeleteItemParams,
    execute: async (_id, raw) => {
      assertWriteEnabled(allowWrite, "1password_delete_item");
      const params = raw as Static<typeof DeleteItemParams>;
      const client = await getClient();
      await client.deleteItem(params.vaultId, params.itemId);
      return {
        ...text(`Deleted item ${params.itemId} from vault ${params.vaultId}.`),
        details: { itemId: params.itemId, vaultId: params.vaultId, deleted: true },
      };
    },
  };

  tools.push(createItem, updateItem, deleteItem);
  return tools;
}

function mapFields(fields: FieldInput[] | undefined): Array<Record<string, unknown>> | undefined {
  if (!fields) return undefined;
  return fields.map((f) => ({
    id: f.title.toLowerCase().replace(/\s+/g, "_"),
    title: f.title,
    value: f.value,
    fieldType: f.fieldType ?? "Text",
    ...(f.sectionId ? { sectionId: f.sectionId } : {}),
  }));
}
