import type {
  PluginButton,
  PluginButtonMenuEntry,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import type { LarkAccountView, LarkStateView } from "../shared/model";
import { setAgentAccount } from "../shared/rpc";
import type { LarkSubStore } from "./store";

const PAGE_SIZE = 200;
const MAX_PAGES = 10;

interface TrackedAgent {
  id: string;
  workspaceId: string;
  provider: string;
}

export function contributePills(client: PluginClientContext, store: LarkSubStore): () => void {
  const agents = new Map<string, TrackedAgent>();
  const pills = new Map<string, { registration: PluginButtonRegistration; key: string }>();
  const lifetime = new AbortController();
  let stopped = false;

  function sync(): void {
    if (stopped) return;
    const state = store.current.state;
    for (const [agentId, pill] of pills) {
      if (!agents.has(agentId)) {
        pill.registration.remove();
        pills.delete(agentId);
      }
    }
    for (const agent of agents.values()) {
      const button = state ? buttonFor(client, store, state, agent) : null;
      const existing = pills.get(agent.id);
      if (!button) {
        existing?.registration.remove();
        pills.delete(agent.id);
        continue;
      }
      const key = JSON.stringify([button.label, button.title, button.icon, menuKey(button)]);
      if (existing) {
        if (existing.key !== key) {
          existing.registration.update(button);
          existing.key = key;
        }
        continue;
      }
      try {
        const registration = client.addComposerPill({
          id: "lark-account",
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          button,
        });
        pills.set(agent.id, { registration, key });
      } catch (error) {
        console.warn("[LarkSub] could not add lark-account pill", error);
      }
    }
  }

  const unsubscribeStore = store.subscribe(sync);

  const track = (agent: { id: string; workspaceId?: string | null; provider: string }) => {
    if (!agent.workspaceId) return;
    agents.set(agent.id, { id: agent.id, workspaceId: agent.workspaceId, provider: agent.provider });
  };

  const newestFirst = () => [{ key: "updated_at" as const, direction: "desc" as const }];
  let snapshots = 0;

  async function loadOlder(cursor: string | null, generation: number): Promise<void> {
    for (let page = 1; cursor && page < MAX_PAGES; page += 1) {
      const result = await client.paseo.agents.list({
        signal: lifetime.signal,
        sort: newestFirst(),
        page: { limit: PAGE_SIZE, cursor },
      });
      if (stopped || generation !== snapshots) return;
      for (const { agent } of result.entries) track(agent);
      sync();
      cursor = result.pageInfo.hasMore ? (result.pageInfo.nextCursor ?? null) : null;
    }
  }

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal, sort: newestFirst(), page: { limit: PAGE_SIZE } })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries, pageInfo }) => {
          const generation = ++snapshots;
          agents.clear();
          for (const { agent } of entries) track(agent);
          sync();
          const next = pageInfo.hasMore ? (pageInfo.nextCursor ?? null) : null;
          void loadOlder(next, generation).catch((error: unknown) => {
            if (!stopped) console.warn("[LarkSub] could not list older agents", error);
          });
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") agents.delete(update.agentId);
          else {
            const known = agents.has(update.agent.id);
            track(update.agent);
            if (!known) void store.refresh();
          }
          sync();
        },
      });
      return undefined;
    })
    .catch((error: unknown) => {
      if (!stopped) console.error("[LarkSub] agent observation failed", error);
    });

  return () => {
    stopped = true;
    lifetime.abort();
    unsubscribeStore();
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
  };
}

function buttonFor(
  client: PluginClientContext,
  store: LarkSubStore,
  state: LarkStateView,
  agent: TrackedAgent,
): PluginButton | null {
  if (!state.showComposerPill) return null;

  const usable = state.accounts.filter((a) => !a.disabled);
  const boundId = state.sessionBindings[agent.id];
  const current =
    (boundId ? usable.find((a) => a.id === boundId) : undefined) ??
    (state.defaultAccountId ? usable.find((a) => a.id === state.defaultAccountId) : undefined) ??
    usable[0];

  const choose = (accountId: string | null) => async () => {
    await store.rpc(setAgentAccount, { agentId: agent.id, accountId });
  };

  const items: PluginButtonMenuEntry[] = state.accounts.map((account, index) => {
    const isCurrent = account.id === current?.id;
    return {
      kind: "item",
      id: `lark-account-${index}`,
      title: menuTitle(account),
      icon: isCurrent ? "CircleCheck" : "Circle",
      disabled: account.disabled || account.status === "signed_out" || (isCurrent && Boolean(boundId)),
      behavior: { kind: "action", onPress: choose(account.id) },
    };
  });

  if (boundId) {
    const fallback = state.accounts.find((a) => a.isDefault);
    items.push(
      { kind: "separator", id: "default-divider" },
      {
        kind: "item",
        id: "follow-default",
        title: fallback ? `Follow default (${fallback.label})` : "Follow default account",
        icon: "Undo2",
        behavior: { kind: "action", onPress: choose(null) },
      },
    );
  }

  if (items.length > 0) {
    items.push({ kind: "separator", id: "manage-divider" });
  }
  items.push({
    kind: "item",
    id: "manage-lark",
    title: state.accounts.length === 0 ? "Add Lark account (QR / OAuth)…" : "Manage Lark accounts…",
    icon: "Users",
    behavior: {
      kind: "action",
      onPress() {
        client.openSurface("lark-accounts");
      },
    },
  });

  return {
    title: current
      ? `Lark CLI account: ${current.label} (${current.userName})`
      : "Choose or add a Lark CLI account for this session",
    icon: current?.status === "expired" ? "CircleAlert" : "Users",
    label: current ? `Lark · ${current.label}` : "Lark · Add",
    behavior: { kind: "menu", items },
  };
}

function menuTitle(account: LarkAccountView): string {
  const base =
    account.userName && account.userName !== account.label
      ? `${account.label} (${account.userName})`
      : account.label;
  if (account.status === "signed_out") return `${base} — signed out`;
  if (account.status === "disabled") return `${base} — disabled`;
  if (account.status === "expired") return `${base} — token expired`;
  if (account.isDefault) return `${base} — default`;
  return base;
}

function menuKey(button: PluginButton): string {
  return button.behavior.kind === "menu"
    ? button.behavior.items
        .map((item) => (item.kind === "item" ? `${item.id}:${item.title}:${String(item.icon)}:${item.disabled}` : item.id))
        .join("|")
    : button.behavior.kind;
}
