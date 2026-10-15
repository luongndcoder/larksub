import { z } from "zod";
import type { LarkAccountRecord, LarkAppConfig, LarkStateFile } from "../shared/model";
import { readJson, writeJsonAtomic } from "./json-file";
import { validateId } from "./paths";

const AppConfigSchema = z.object({
  appId: z.string().min(1),
  brand: z.enum(["lark", "feishu"]),
  lang: z.string().default("en_us"),
});

const AccountRecordSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  userOpenId: z.string().min(1),
  userName: z.string().min(1),
  appId: z.string().min(1),
  brand: z.enum(["lark", "feishu"]),
  scopeCount: z.number().optional(),
  disabled: z.boolean().default(false),
  addedAt: z.string(),
  lastCheckedAt: z.string().optional(),
  tokenStatus: z.enum(["valid", "expired", "missing"]).optional(),
  lastError: z.string().optional(),
});

const StateFileSchema = z.object({
  version: z.literal(1),
  appConfig: AppConfigSchema.nullable().default(null),
  accounts: z.array(AccountRecordSchema).default([]),
  defaultAccountId: z.string().nullable().default(null),
  sessionBindings: z.record(z.string(), z.string()).default({}),
});

export function emptyState(): LarkStateFile {
  return {
    version: 1,
    appConfig: null,
    accounts: [],
    defaultAccountId: null,
    sessionBindings: {},
  };
}

export async function loadState(path: string): Promise<LarkStateFile> {
  const raw = await readJson(path);
  if (raw === undefined) return emptyState();
  const parsed = StateFileSchema.parse(raw);
  for (const account of parsed.accounts) validateId(account.id);
  const state: LarkStateFile = {
    version: 1,
    appConfig: parsed.appConfig as LarkAppConfig | null,
    accounts: parsed.accounts as LarkAccountRecord[],
    defaultAccountId: parsed.defaultAccountId,
    sessionBindings: { ...parsed.sessionBindings },
  };
  normalizeDefault(state);
  return state;
}

export async function saveState(path: string, state: LarkStateFile): Promise<void> {
  normalizeDefault(state);
  await writeJsonAtomic(path, state);
}

export function normalizeDefault(state: LarkStateFile): void {
  const usable = state.accounts.filter((a) => !a.disabled);
  const current = state.defaultAccountId;
  if (current && usable.some((a) => a.id === current)) return;
  const active = usable.find((a) => a.tokenStatus !== "missing");
  state.defaultAccountId = (active ?? usable[0])?.id ?? null;
}
