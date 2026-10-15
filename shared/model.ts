import { z } from "zod";

export const LarkAppConfigSchema = z.object({
  appId: z.string(),
  brand: z.enum(["lark", "feishu"]),
  lang: z.string(),
});
export type LarkAppConfig = z.infer<typeof LarkAppConfigSchema>;

export const LarkAccountStatusSchema = z.enum(["active", "expired", "signed_out", "disabled"]);
export type LarkAccountStatus = z.infer<typeof LarkAccountStatusSchema>;

export interface LarkAccountRecord {
  id: string;
  label: string;
  userOpenId: string;
  userName: string;
  appId: string;
  brand: "lark" | "feishu";
  scopeCount?: number;
  disabled: boolean;
  addedAt: string;
  lastCheckedAt?: string;
  tokenStatus?: "valid" | "expired" | "missing";
  lastError?: string;
}

export interface LarkStateFile {
  version: 1;
  appConfig: LarkAppConfig | null;
  accounts: LarkAccountRecord[];
  defaultAccountId: string | null;
  sessionBindings: Record<string, string>;
}

export const LarkAccountViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  userOpenId: z.string(),
  userName: z.string(),
  appId: z.string(),
  brand: z.enum(["lark", "feishu"]),
  scopeCount: z.number().optional(),
  status: LarkAccountStatusSchema,
  isDefault: z.boolean(),
  disabled: z.boolean(),
  homeDir: z.string(),
  addedAt: z.string(),
  lastCheckedAt: z.string().optional(),
  lastError: z.string().optional(),
});
export type LarkAccountView = z.infer<typeof LarkAccountViewSchema>;

export const LarkPendingLoginViewSchema = z.object({
  loginId: z.string(),
  label: z.string().optional(),
  verificationUrl: z.string(),
  userCode: z.string(),
  qrDataUrl: z.string().nullable(),
  expiresAt: z.string(),
  status: z.enum(["waiting", "authorized", "failed", "expired"]),
  error: z.string().optional(),
  authorizedAccountId: z.string().optional(),
  authorizedUserName: z.string().optional(),
});
export type LarkPendingLoginView = z.infer<typeof LarkPendingLoginViewSchema>;

export const LarkStateViewSchema = z.object({
  appConfig: LarkAppConfigSchema.nullable(),
  larkCliAvailable: z.boolean(),
  larkCliPath: z.string().nullable(),
  showComposerPill: z.boolean(),
  accounts: z.array(LarkAccountViewSchema),
  defaultAccountId: z.string().nullable(),
  sessionBindings: z.record(z.string(), z.string()),
  pendingLogin: LarkPendingLoginViewSchema.nullable(),
});
export type LarkStateView = z.infer<typeof LarkStateViewSchema>;

