import type { PluginServerContext, PluginSettingsState } from "@getpaseo/plugin/server";
import { preferences } from "./shared/preferences";
import {
  cancelLogin,
  getState,
  removeAccount,
  renameAccount,
  setAccountDisabled,
  setAgentAccount,
  setDefaultAccount,
  startLogin,
  syncHostAccounts,
} from "./shared/rpc";
import { resolvePaths } from "./server/paths";
import { reloadAgentSessionIfIdle } from "./server/reopen";
import { LarkSubService } from "./server/service";

export default function contribute(server: PluginServerContext): () => Promise<void> {
  const paths = resolvePaths();
  const service = new LarkSubService({ paths });

  const settings = server.registerSettings(preferences);
  const applySettings = (state: PluginSettingsState<typeof preferences.schema>) => {
    if (state.status === "ready") {
      service.setPreferences(state.values);
    }
  };
  void settings.read().then(applySettings).catch((error: unknown) => {
    console.error("[LarkSub] could not read preferences", error);
  });
  const stopSettings = settings.subscribe(applySettings);

  void service.start().catch((error: unknown) => {
    console.error("[LarkSub] startup failed", error);
  });

  server.before("agent.session_open", async ({ request }) => {
    const requestedAccountId = request.env?.PASEO_LARK_ACCOUNT;
    const { env, account } = service.resolveEnvForSession(
      request.agentId,
      requestedAccountId,
      request.env,
    );
    if (account) {
      console.log(
        `[LarkSub] Session ${request.agentId} bound to Lark account "${account.label}" (${account.userName})`,
      );
    }
    return {
      ...request,
      env,
    };
  });

  server.handle(getState, async (input) => {
    if (input.refresh) {
      return service.refresh(input.accountId);
    }
    return service.list();
  });

  server.handle(syncHostAccounts, async () => {
    return service.syncHost();
  });

  server.handle(startLogin, async (input) => {
    return service.startLogin(input);
  });

  server.handle(cancelLogin, async () => {
    return service.cancelLogin();
  });

  server.handle(setDefaultAccount, async (input) => {
    return service.setDefault(input.accountId);
  });

  server.handle(setAgentAccount, async (input) => {
    const view = await service.setAgentAccount(input.agentId, input.accountId);
    void reloadAgentSessionIfIdle(input.agentId);
    return view;
  });

  server.handle(renameAccount, async (input) => {
    return service.rename(input.accountId, input.label);
  });

  server.handle(setAccountDisabled, async (input) => {
    return service.setDisabled(input.accountId, input.disabled);
  });

  server.handle(removeAccount, async (input) => {
    return service.remove(input.accountId);
  });

  return async () => {
    stopSettings();
    await service.stop();
  };
}
