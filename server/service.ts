import { randomBytes } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { delimiter } from "node:path";
import { rm } from "node:fs/promises";
import type {
  LarkAccountRecord,
  LarkAccountStatus,
  LarkAccountView,
  LarkPendingLoginView,
  LarkStateFile,
  LarkStateView,
} from "../shared/model";
import { DEFAULT_PREFERENCES, type LarkSubPreferences } from "../shared/preferences";
import { Mutex } from "./json-file";
import {
  ensureIsolatedLarkHome,
  ensureLarkCliShim,
  findLarkCliBinary,
  listHostAuthorizedUsers,
  probeAccountStatus,
  readHostLarkConfig,
  startDeviceLogin,
} from "./lark";
import { slugifyId, validateId, type LarkSubPaths } from "./paths";
import { emptyState, loadState, normalizeDefault, saveState } from "./state";

export interface LarkSubLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

interface ActiveLoginState {
  view: LarkPendingLoginView;
  waitProcess: ChildProcess;
  stagingHome: string;
}

export class LarkSubService {
  private readonly paths: LarkSubPaths;
  private readonly log: LarkSubLogger;
  private readonly mutex = new Mutex();
  private state: LarkStateFile = emptyState();
  private preferences: LarkSubPreferences = DEFAULT_PREFERENCES;
  private larkBinary: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private activeLogin: ActiveLoginState | null = null;
  private started = false;

  constructor(options: { paths: LarkSubPaths; log?: LarkSubLogger }) {
    this.paths = options.paths;
    this.log = options.log ?? {
      info: (msg) => console.log(`[LarkSub] ${msg}`),
      warn: (msg) => console.warn(`[LarkSub] ${msg}`),
    };
  }


  async start(): Promise<void> {
    await this.mutex.run(async () => {
      this.state = await loadState(this.paths.stateFile);
      this.larkBinary = await findLarkCliBinary(this.paths);
      if (this.larkBinary) {
        await ensureLarkCliShim(this.paths, this.larkBinary);
      }
      await this.syncFromHostLocked();
      await saveState(this.paths.stateFile, this.state);
      this.started = true;
    });
    this.scheduleRefresh();
    void this.refreshAll().catch((error) => {
      this.log.warn(`Initial Lark account status check failed: ${ formatError(error) }`);
    });
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.activeLogin) {
      this.activeLogin.waitProcess.kill("SIGTERM");
      await rm(this.activeLogin.stagingHome, { recursive: true, force: true }).catch(() => undefined);
      this.activeLogin = null;
    }
  }

  setPreferences(preferences: LarkSubPreferences): void {
    this.preferences = preferences;
    if (this.started) this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    const intervalMs = Math.max(1, this.preferences.refreshIntervalMinutes) * 60_000;
    this.refreshTimer = setInterval(() => {
      void this.refreshAll().catch((error) => {
        this.log.warn(`Scheduled Lark status refresh failed: ${formatError(error)}`);
      });
    }, intervalMs);
    this.refreshTimer.unref?.();
  }

  private async syncFromHostLocked(): Promise<void> {
    const hostCfg = await readHostLarkConfig(this.paths.hostHome);
    if (hostCfg.appConfig) {
      this.state.appConfig = hostCfg.appConfig;
    }
    const appConfig = this.state.appConfig;
    if (!appConfig) return;

    const discovered = new Map<string, { userOpenId: string; userName: string; tokenStatus?: "valid" | "expired" | "missing" }>();
    for (const u of hostCfg.users) {
      discovered.set(u.userOpenId, { userOpenId: u.userOpenId, userName: u.userName });
    }
    if (this.larkBinary) {
      const hostUsers = await listHostAuthorizedUsers(this.larkBinary, this.paths.hostHome);
      for (const u of hostUsers) {
        if (u.appId && u.appId !== appConfig.appId) continue;
        discovered.set(u.userOpenId, {
          userOpenId: u.userOpenId,
          userName: u.userName,
          tokenStatus: u.tokenStatus,
        });
      }
    }

    for (const user of discovered.values()) {
      let existing = this.state.accounts.find((a) => a.userOpenId === user.userOpenId);
      if (!existing) {
        const id = this.allocateAccountId(user.userName, user.userOpenId);
        existing = {
          id,
          label: user.userName,
          userOpenId: user.userOpenId,
          userName: user.userName,
          appId: appConfig.appId,
          brand: appConfig.brand,
          disabled: false,
          addedAt: new Date().toISOString(),
          tokenStatus: user.tokenStatus ?? "valid",
        };
        this.state.accounts.push(existing);
      } else {
        existing.userName = user.userName || existing.userName;
        if (user.tokenStatus) existing.tokenStatus = user.tokenStatus;
      }
    }

    for (const account of this.state.accounts) {
      await ensureIsolatedLarkHome(
        this.paths,
        this.paths.accountHome(account.id),
        {
          appId: account.appId || appConfig.appId,
          brand: account.brand || appConfig.brand,
          lang: appConfig.lang,
        },
        {
          userOpenId: account.userOpenId,
          userName: account.userName,
        },
      );
    }

    normalizeDefault(this.state);
  }

  private allocateAccountId(label: string, userOpenId: string): string {
    const base = slugifyId(label, slugifyId(userOpenId.replace(/^ou_/, ""), "lark-user"));
    const taken = new Set(this.state.accounts.map((a) => a.id));
    if (!taken.has(base)) return base;
    for (let i = 2; i < 100; i += 1) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${base}-${randomBytes(3).toString("hex")}`;
  }

  async list(): Promise<LarkStateView> {
    return this.mutex.run(async () => this.snapshot());
  }

  async syncHost(): Promise<LarkStateView> {
    return this.mutex.run(async () => {
      this.larkBinary = await findLarkCliBinary(this.paths);
      if (this.larkBinary) {
        await ensureLarkCliShim(this.paths, this.larkBinary);
      }
      await this.syncFromHostLocked();
      await saveState(this.paths.stateFile, this.state);
      return this.snapshot();
    });
  }

  async refresh(accountId?: string): Promise<LarkStateView> {
    if (accountId) {
      await this.refreshOne(accountId);
    } else {
      await this.refreshAll();
    }
    return this.list();
  }

  async refreshAll(): Promise<void> {
    const ids = this.state.accounts.map((a) => a.id);
    for (const id of ids) {
      await this.refreshOne(id);
    }
  }

  private async refreshOne(accountId: string): Promise<void> {
    const binary = this.larkBinary ?? (await findLarkCliBinary(this.paths));
    if (!binary) return;
    this.larkBinary = binary;

    const account = this.state.accounts.find((a) => a.id === accountId);
    if (!account) return;

    const homeDir = this.paths.accountHome(account.id);
    const status = await probeAccountStatus(binary, homeDir);

    await this.mutex.run(async () => {
      const target = this.state.accounts.find((a) => a.id === accountId);
      if (!target) return;
      target.lastCheckedAt = new Date().toISOString();
      if (status.userName) target.userName = status.userName;
      if (typeof status.scopeCount === "number") target.scopeCount = status.scopeCount;
      if (status.tokenStatus === "valid" || status.tokenStatus === "expired") {
        target.tokenStatus = status.tokenStatus;
        target.lastError = undefined;
      } else {
        target.tokenStatus = "missing";
        target.lastError = status.note;
      }
      await saveState(this.paths.stateFile, this.state);
    });
  }

  async startLogin(input?: { label?: string; domain?: string }): Promise<LarkStateView> {
    return this.mutex.run(async () => {
      const binary = this.larkBinary ?? (await findLarkCliBinary(this.paths));
      if (!binary) {
        throw new Error("lark-cli was not found on this machine. Install @larksuite/cli first.");
      }
      this.larkBinary = binary;

      if (!this.state.appConfig) {
        await this.syncFromHostLocked();
      }
      const appConfig = this.state.appConfig;
      if (!appConfig) {
        throw new Error(
          "No Lark App configuration found in ~/.lark-cli/config.json. Run `lark-cli config init` on the host once.",
        );
      }

      if (this.activeLogin) {
        this.activeLogin.waitProcess.kill("SIGTERM");
        await rm(this.activeLogin.stagingHome, { recursive: true, force: true }).catch(() => undefined);
        this.activeLogin = null;
      }

      const loginId = `login-${randomBytes(4).toString("hex")}`;
      const requestedLabel = input?.label?.trim() || undefined;
      const started = await startDeviceLogin({
        binary,
        paths: this.paths,
        appConfig,
        loginId,
        domain: input?.domain?.trim() || "all",
        onAuthorized: async ({ userOpenId, userName, scopeCount }) => {
          await this.mutex.run(async () => {
            let account = this.state.accounts.find((a) => a.userOpenId === userOpenId);
            const now = new Date().toISOString();
            if (!account) {
              const id = this.allocateAccountId(requestedLabel || userName, userOpenId);
              account = {
                id,
                label: requestedLabel || userName,
                userOpenId,
                userName,
                appId: appConfig.appId,
                brand: appConfig.brand,
                scopeCount,
                disabled: false,
                addedAt: now,
                lastCheckedAt: now,
                tokenStatus: "valid",
              };
              this.state.accounts.push(account);
            } else {
              if (requestedLabel) account.label = requestedLabel;
              account.userName = userName || account.userName;
              account.scopeCount = scopeCount ?? account.scopeCount;
              account.disabled = false;
              account.lastCheckedAt = now;
              account.tokenStatus = "valid";
              account.lastError = undefined;
            }
            await ensureIsolatedLarkHome(
              this.paths,
              this.paths.accountHome(account.id),
              appConfig,
              { userOpenId: account.userOpenId, userName: account.userName },
            );
            await saveState(this.paths.stateFile, this.state);
            if (this.activeLogin && this.activeLogin.view.loginId === loginId) {
              this.activeLogin.view = {
                ...this.activeLogin.view,
                status: "authorized",
                authorizedAccountId: account.id,
                authorizedUserName: account.userName,
              };
            }
          });
        },
        onFailed: async (reason) => {
          await this.mutex.run(async () => {
            if (this.activeLogin && this.activeLogin.view.loginId === loginId) {
              this.activeLogin.view = {
                ...this.activeLogin.view,
                status: "failed",
                error: reason,
              };
            }
          });
        },
      });

      const expiresAt = new Date(Date.now() + started.expiresIn * 1000).toISOString();
      this.activeLogin = {
        view: {
          loginId,
          label: requestedLabel,
          verificationUrl: started.verificationUrl,
          userCode: started.userCode ?? "",
          qrDataUrl: started.qrDataUrl ?? null,
          expiresAt,
          status: "waiting",
        },
        waitProcess: started.waitProcess,
        stagingHome: started.stagingHome,
      };

      return this.snapshot();
    });
  }

  async cancelLogin(): Promise<LarkStateView> {
    return this.mutex.run(async () => {
      if (this.activeLogin) {
        this.activeLogin.waitProcess.kill("SIGTERM");
        await rm(this.activeLogin.stagingHome, { recursive: true, force: true }).catch(() => undefined);
        this.activeLogin = null;
      }
      return this.snapshot();
    });
  }

  async setDefault(accountId: string | null): Promise<LarkStateView> {
    return this.mutex.run(async () => {
      if (accountId !== null) {
        const target = this.requireAccount(accountId);
        if (target.disabled) throw new Error(`Account "${target.label}" is disabled.`);
        this.state.defaultAccountId = target.id;
      } else {
        this.state.defaultAccountId = null;
      }
      await saveState(this.paths.stateFile, this.state);
      return this.snapshot();
    });
  }

  async setAgentAccount(agentId: string, accountId: string | null): Promise<LarkStateView> {
    return this.mutex.run(async () => {
      if (!agentId.trim()) throw new Error("agentId is required.");
      if (accountId === null) {
        delete this.state.sessionBindings[agentId];
      } else {
        const target = this.requireAccount(accountId);
        if (target.disabled) throw new Error(`Account "${target.label}" is disabled.`);
        this.state.sessionBindings[agentId] = target.id;
      }
      await saveState(this.paths.stateFile, this.state);
      return this.snapshot();
    });
  }

  async rename(accountId: string, label: string): Promise<LarkStateView> {
    return this.mutex.run(async () => {
      const trimmed = label.trim();
      if (!trimmed) throw new Error("Account label cannot be empty.");
      const target = this.requireAccount(accountId);
      target.label = trimmed;
      await saveState(this.paths.stateFile, this.state);
      return this.snapshot();
    });
  }

  async setDisabled(accountId: string, disabled: boolean): Promise<LarkStateView> {
    return this.mutex.run(async () => {
      const target = this.requireAccount(accountId);
      target.disabled = disabled;
      await saveState(this.paths.stateFile, this.state);
      return this.snapshot();
    });
  }

  async remove(accountId: string): Promise<LarkStateView> {
    return this.mutex.run(async () => {
      validateId(accountId);
      const index = this.state.accounts.findIndex((a) => a.id === accountId);
      if (index === -1) throw new Error(`Unknown Lark account "${accountId}".`);
      this.state.accounts.splice(index, 1);
      for (const [sessionId, boundId] of Object.entries(this.state.sessionBindings)) {
        if (boundId === accountId) delete this.state.sessionBindings[sessionId];
      }
      await rm(this.paths.accountHome(accountId), { recursive: true, force: true }).catch(() => undefined);
      await saveState(this.paths.stateFile, this.state);
      return this.snapshot();
    });
  }

  resolveEnvForSession(
    agentId: string,
    requestedAccountId: string | undefined,
    existingEnv: Readonly<Record<string, string>> | undefined,
  ): { env: Record<string, string>; account: LarkAccountRecord | null } {
    let account: LarkAccountRecord | undefined;
    if (requestedAccountId) {
      account = this.state.accounts.find((a) => a.id === requestedAccountId && !a.disabled);
      if (account) {
        this.state.sessionBindings[agentId] = account.id;
        void saveState(this.paths.stateFile, this.state).catch(() => undefined);
      }
    }
    if (!account) {
      const boundId = this.state.sessionBindings[agentId];
      if (boundId) {
        account = this.state.accounts.find((a) => a.id === boundId && !a.disabled);
      }
    }
    if (!account && this.state.defaultAccountId) {
      account = this.state.accounts.find((a) => a.id === this.state.defaultAccountId && !a.disabled);
    }
    if (!account) {
      account = this.state.accounts.find((a) => !a.disabled);
    }

    const baseEnv: Record<string, string> = { ...(existingEnv ?? {}) };
    const currentPath = baseEnv.PATH || process.env.PATH || "";
    const pathSegments = currentPath.split(delimiter).filter(Boolean);
    if (!pathSegments.includes(this.paths.binDir)) {
      pathSegments.unshift(this.paths.binDir);
    }
    baseEnv.PATH = pathSegments.join(delimiter);
    baseEnv.PASEO_LARK_SESSION_ID = agentId;

    if (account) {
      baseEnv.PASEO_LARK_HOME = this.paths.accountHome(account.id);
      baseEnv.PASEO_LARK_ACCOUNT = account.id;
      baseEnv.PASEO_LARK_USER = account.userName;
    }

    return { env: baseEnv, account: account ?? null };
  }

  private requireAccount(accountId: string): LarkAccountRecord {
    validateId(accountId);
    const found = this.state.accounts.find((a) => a.id === accountId);
    if (!found) throw new Error(`Unknown Lark account "${accountId}".`);
    return found;
  }

  private snapshot(): LarkStateView {
    const accounts: LarkAccountView[] = this.state.accounts.map((a) => ({
      id: a.id,
      label: a.label,
      userOpenId: a.userOpenId,
      userName: a.userName,
      appId: a.appId,
      brand: a.brand,
      scopeCount: a.scopeCount,
      status: computeStatus(a),
      isDefault: this.state.defaultAccountId === a.id,
      disabled: a.disabled,
      homeDir: this.paths.accountHome(a.id),
      addedAt: a.addedAt,
      lastCheckedAt: a.lastCheckedAt,
      lastError: a.lastError,
    }));

    return {
      appConfig: this.state.appConfig,
      larkCliAvailable: Boolean(this.larkBinary),
      larkCliPath: this.larkBinary,
      showComposerPill: this.preferences.showComposerPill,
      accounts,
      defaultAccountId: this.state.defaultAccountId,
      sessionBindings: { ...this.state.sessionBindings },
      pendingLogin: this.activeLogin ? { ...this.activeLogin.view } : null,
    };
  }
}


function computeStatus(account: LarkAccountRecord): LarkAccountStatus {
  if (account.disabled) return "disabled";
  if (account.tokenStatus === "expired") return "expired";
  if (account.tokenStatus === "missing") return "signed_out";
  return "active";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
