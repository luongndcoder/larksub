import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { LarkAccountView, LarkStateView } from "../shared/model";
import { setAgentAccount, setDefaultAccount } from "../shared/rpc";
import type { LarkSubStore } from "./store";

export function contributeCommands(client: PluginClientContext, store: LarkSubStore): () => void {
  const removers: Array<() => void> = [];

  removers.push(
    client.addCommandCenterItem({
      id: "open-lark-accounts",
      title: "Manage Lark CLI Accounts (LarkSub)",
      icon: "Users",
      keywords: ["lark", "lark-cli", "feishu", "larksub", "account", "qr", "oauth", "switch"],
      context: "global",
      onSelect({ openSurface }) {
        openSurface("lark-accounts");
      },
    }),
  );

  removers.push(
    client.addSlashCommand({
      name: "lark-account",
      description: "Switch the Lark CLI account used by this session",
      argumentHint: "[name | default]",
      context: "agent",
      async onSubmit({ args, agent, openSurface }) {
        const state = await ensureState(store);
        const query = args.trim();
        if (!query) {
          openSurface("lark-accounts");
          return;
        }
        if (/^default$/i.test(query)) {
          await store.rpc(setAgentAccount, { agentId: agent.id, accountId: null });
          return;
        }
        const match = findAccount(state.accounts, query);
        if (!match) {
          const names = state.accounts.map((a) => a.label).join(", ");
          throw new Error(`No Lark account matches "${query}". Available: ${names || "none"}.`);
        }
        if (match.disabled) {
          throw new Error(`Lark account "${match.label}" is disabled.`);
        }
        await store.rpc(setAgentAccount, { agentId: agent.id, accountId: match.id });
      },
    }),
  );

  let dynamic: Array<() => void> = [];
  let signature = "";
  const syncDynamic = () => {
    const state = store.current.state;
    const next = state
      ? JSON.stringify(state.accounts.map((a) => [a.id, a.label, a.isDefault, a.status, a.disabled]))
      : "";
    if (next === signature) return;
    signature = next;
    for (const remove of dynamic) remove();
    dynamic = [];
    if (!state) return;
    state.accounts.forEach((account, index) => {
      if (account.isDefault || account.disabled || account.status === "signed_out") return;
      dynamic.push(
        client.addCommandCenterItem({
          id: `lark-default-${index}`,
          title: `Make ${account.label} (${account.userName}) the default Lark account`,
          icon: "Star",
          keywords: ["lark", "account", "default", account.label, account.userName],
          context: "global",
          async onSelect() {
            await store.rpc(setDefaultAccount, { accountId: account.id });
          },
        }),
      );
    });
  };

  const unsubscribe = store.subscribe(syncDynamic);
  syncDynamic();

  return () => {
    unsubscribe();
    for (const remove of dynamic) remove();
    for (const remove of removers) remove();
  };
}

async function ensureState(store: LarkSubStore): Promise<LarkStateView> {
  if (!store.current.state) await store.refresh();
  const state = store.current.state;
  if (!state) throw new Error(store.current.error ?? "Lark accounts are not available yet.");
  return state;
}

function findAccount(accounts: readonly LarkAccountView[], query: string): LarkAccountView | undefined {
  const needle = query.toLowerCase();
  return (
    accounts.find((a) => a.id.toLowerCase() === needle) ??
    accounts.find((a) => a.label.toLowerCase() === needle) ??
    accounts.find((a) => a.userName.toLowerCase() === needle) ??
    accounts.find((a) => a.label.toLowerCase().includes(needle) || a.userName.toLowerCase().includes(needle))
  );
}
