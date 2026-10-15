import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { LarkStateViewSchema } from "./model";

export const getState = defineRpc({
  name: "larksub.state",
  input: z.object({
    refresh: z.boolean().optional(),
    accountId: z.string().optional(),
  }),
  output: LarkStateViewSchema,
});

export const startLogin = defineRpc({
  name: "larksub.login.start",
  input: z.object({
    label: z.string().optional(),
    domain: z.string().optional(),
  }),
  output: LarkStateViewSchema,
});

export const cancelLogin = defineRpc({
  name: "larksub.login.cancel",
  input: z.object({}),
  output: LarkStateViewSchema,
});

export const setDefaultAccount = defineRpc({
  name: "larksub.accounts.default",
  input: z.object({
    accountId: z.string().nullable(),
  }),
  output: LarkStateViewSchema,
});

export const setAgentAccount = defineRpc({
  name: "larksub.agents.account",
  input: z.object({
    agentId: z.string(),
    accountId: z.string().nullable(),
  }),
  output: LarkStateViewSchema,
});

export const renameAccount = defineRpc({
  name: "larksub.accounts.rename",
  input: z.object({
    accountId: z.string(),
    label: z.string(),
  }),
  output: LarkStateViewSchema,
});

export const setAccountDisabled = defineRpc({
  name: "larksub.accounts.disabled",
  input: z.object({
    accountId: z.string(),
    disabled: z.boolean(),
  }),
  output: LarkStateViewSchema,
});

export const removeAccount = defineRpc({
  name: "larksub.accounts.remove",
  input: z.object({
    accountId: z.string(),
  }),
  output: LarkStateViewSchema,
});

export const syncHostAccounts = defineRpc({
  name: "larksub.accounts.sync",
  input: z.object({}),
  output: LarkStateViewSchema,
});
