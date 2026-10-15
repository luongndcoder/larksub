import { execFile, spawn, type ChildProcess } from "node:child_process";
import { chmod, lstat, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import type { LarkAppConfig } from "../shared/model";
import { readJson, writeJsonAtomic } from "./json-file";
import type { LarkSubPaths } from "./paths";

const execFileAsync = promisify(execFile);

export interface HostLarkUser {
  appId: string;
  userOpenId: string;
  userName: string;
  tokenStatus?: "valid" | "expired" | "missing";
}

export interface LarkAuthStatusResult {
  identity?: string;
  appId?: string;
  brand?: "lark" | "feishu";
  userName?: string;
  userOpenId?: string;
  tokenStatus?: "valid" | "expired" | "missing";
  scopeCount?: number;
  note?: string;
}

export interface StartedDeviceLogin {
  deviceCode: string;
  verificationUrl: string;
  userCode?: string;
  expiresIn: number;
  qrDataUrl?: string;
  stagingHome: string;
  waitProcess: ChildProcess;
}

const KNOWN_BINARY_CANDIDATES = [
  "/opt/homebrew/lib/node_modules/@larksuite/cli/bin/lark-cli",
  "/usr/local/lib/node_modules/@larksuite/cli/bin/lark-cli",
  "/opt/homebrew/bin/lark-cli",
  "/usr/local/bin/lark-cli",
];

export async function findLarkCliBinary(
  paths: LarkSubPaths,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  for (const candidate of KNOWN_BINARY_CANDIDATES) {
    if (await isExecutable(candidate)) return candidate;
  }
  const pathEnv = env.PATH ?? process.env.PATH ?? "";
  for (const segment of pathEnv.split(delimiter)) {
    const dir = segment.trim();
    if (!dir || dir === paths.binDir) continue;
    const candidate = join(dir, "lark-cli");
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

interface RawLarkAppEntry {
  appId?: string;
  brand?: string;
  lang?: string;
  users?: Array<{ userOpenId?: string; userName?: string }>;
}

export async function readHostLarkConfig(hostHome: string): Promise<{
  appConfig: LarkAppConfig | null;
  users: Array<{ userOpenId: string; userName: string }>;
}> {
  const configPath = join(hostHome, ".lark-cli", "config.json");
  const raw = (await readJson(configPath).catch(() => undefined)) as
    | (RawLarkAppEntry & { apps?: RawLarkAppEntry[] })
    | undefined;
  const entry: RawLarkAppEntry | undefined =
    Array.isArray(raw?.apps) && raw.apps.length > 0 ? raw.apps[0] : raw;
  if (!entry || typeof entry.appId !== "string" || !entry.appId.trim()) {
    return { appConfig: null, users: [] };
  }
  const brand = entry.brand === "feishu" ? "feishu" : "lark";
  const lang = typeof entry.lang === "string" && entry.lang.trim() ? entry.lang.trim() : "en_us";
  const users = Array.isArray(entry.users)
    ? entry.users
        .filter(
          (u): u is { userOpenId: string; userName: string } =>
            Boolean(u && typeof u.userOpenId === "string" && u.userOpenId.trim()),
        )
        .map((u) => ({
          userOpenId: u.userOpenId.trim(),
          userName: typeof u.userName === "string" && u.userName.trim() ? u.userName.trim() : u.userOpenId.trim(),
        }))
    : [];
  return {
    appConfig: {
      appId: entry.appId.trim(),
      brand,
      lang,
    },
    users,
  };
}

export async function ensureSymlink(target: string, linkPath: string): Promise<void> {
  await mkdir(dirname(linkPath), { recursive: true, mode: 0o700 });
  try {
    const existing = await lstat(linkPath);
    if (existing.isSymbolicLink()) return;
    return;
  } catch {
    // Does not exist yet
  }
  try {
    await symlink(target, linkPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export async function ensureIsolatedLarkHome(
  paths: LarkSubPaths,
  homeDir: string,
  appConfig: LarkAppConfig,
  user: { userOpenId: string; userName: string } | null,
): Promise<void> {
  await mkdir(join(homeDir, ".lark-cli"), { recursive: true, mode: 0o700 });
  if (process.platform === "darwin") {
    const hostKeychains = join(paths.hostHome, "Library", "Keychains");
    const hostAppSupport = join(paths.hostHome, "Library", "Application Support", "lark-cli");
    await mkdir(hostAppSupport, { recursive: true, mode: 0o700 }).catch(() => undefined);
    await ensureSymlink(hostKeychains, join(homeDir, "Library", "Keychains"));
    await ensureSymlink(hostAppSupport, join(homeDir, "Library", "Application Support", "lark-cli"));
  } else if (process.platform === "linux") {
    const hostConfig = join(paths.hostHome, ".config", "lark-cli");
    await mkdir(hostConfig, { recursive: true, mode: 0o700 }).catch(() => undefined);
    await ensureSymlink(hostConfig, join(homeDir, ".config", "lark-cli"));
  }
  const configJson = {
    apps: [
      {
        appId: appConfig.appId,
        appSecret: {
          source: "keychain",
          id: `appsecret:${appConfig.appId}`,
        },
        brand: appConfig.brand,
        lang: appConfig.lang,
        users: user ? [{ userOpenId: user.userOpenId, userName: user.userName }] : [],
      },
    ],
  };
  await writeJsonAtomic(join(homeDir, ".lark-cli", "config.json"), configJson, 0o600);
}

export async function ensureLarkCliShim(paths: LarkSubPaths, realBinary: string): Promise<string> {
  await mkdir(paths.binDir, { recursive: true, mode: 0o755 });
  const shimPath = join(paths.binDir, "lark-cli");
  const script = `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STATE_FILE = ${JSON.stringify(paths.stateFile)};
const HOMES_DIR = ${JSON.stringify(paths.homesDir)};
const REAL_BIN = ${JSON.stringify(realBinary)};

function resolveLarkHome() {
  const sessionId = process.env.PASEO_LARK_SESSION_ID;
  try {
    if (existsSync(STATE_FILE)) {
      const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      const boundId = (sessionId && state.sessionBindings && state.sessionBindings[sessionId]) || (sessionId ? state.defaultAccountId : undefined);
      if (boundId) {
        const candidate = join(HOMES_DIR, boundId);
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch {}
  if (process.env.PASEO_LARK_HOME && existsSync(process.env.PASEO_LARK_HOME)) {
    return process.env.PASEO_LARK_HOME;
  }
  return process.env.HOME;
}

const resolvedHome = resolveLarkHome();
const env = { ...process.env };
if (resolvedHome) env.HOME = resolvedHome;

try {
  execFileSync(REAL_BIN, process.argv.slice(2), { stdio: "inherit", env });
} catch (err) {
  if (err && typeof err.status === "number") process.exit(err.status);
  throw err;
}
`;
  await writeFile(shimPath, script, { mode: 0o755 });
  await chmod(shimPath, 0o755);
  await patchGlobalLarkCliWrapper(paths, realBinary).catch(() => undefined);
  return shimPath;
}

async function patchGlobalLarkCliWrapper(paths: LarkSubPaths, realBinary: string): Promise<void> {
  const wrapperCandidates = [
    `${realBinary}.js`,
    "/opt/homebrew/lib/node_modules/@larksuite/cli/bin/lark-cli.js",
    "/usr/local/lib/node_modules/@larksuite/cli/bin/lark-cli.js",
  ];
  const hookMarker = "// [larksub-paseo-hook]";
  const hookSnippet = `${hookMarker}
if (process.env.PASEO_LARK_SESSION_ID || process.env.PASEO_LARK_HOME) {
  try {
    const _stateFile = ${JSON.stringify(paths.stateFile)};
    const _homesDir = ${JSON.stringify(paths.homesDir)};
    const _sid = process.env.PASEO_LARK_SESSION_ID;
    let _resolved = null;
    if (fs.existsSync(_stateFile)) {
      const _st = JSON.parse(fs.readFileSync(_stateFile, "utf8"));
      const _bid = (_sid && _st.sessionBindings && _st.sessionBindings[_sid]) || (_sid ? _st.defaultAccountId : null);
      if (_bid && fs.existsSync(path.join(_homesDir, _bid))) {
        _resolved = path.join(_homesDir, _bid);
      }
    }
    if (!_resolved && process.env.PASEO_LARK_HOME && fs.existsSync(process.env.PASEO_LARK_HOME)) {
      _resolved = process.env.PASEO_LARK_HOME;
    }
    if (_resolved) process.env.HOME = _resolved;
  } catch {}
}
`;
  for (const wrapperPath of wrapperCandidates) {
    try {
      const content = await readFile(wrapperPath, "utf8");
      if (content.includes(hookMarker)) continue;
      const targetLine = 'execFileSync(bin, process.argv.slice(2), { stdio: "inherit" });';
      if (!content.includes(targetLine)) continue;
      const updated = content.replace(targetLine, `${hookSnippet}  ${targetLine}`);
      await writeFile(wrapperPath, updated, "utf8");
    } catch {
      // Ignore if wrapper doesn't exist or isn't writable
    }
  }
}

export async function listHostAuthorizedUsers(
  binary: string,
  hostHome: string,
): Promise<HostLarkUser[]> {
  try {
    const { stdout } = await execFileAsync(binary, ["auth", "list"], {
      env: { ...process.env, HOME: hostHome },
      timeout: 10_000,
    });
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (!Array.isArray(parsed)) return [];
    const results: HostLarkUser[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const userOpenId = typeof entry.userOpenId === "string" ? entry.userOpenId.trim() : "";
      if (!userOpenId) continue;
      const userName =
        typeof entry.userName === "string" && entry.userName.trim() ? entry.userName.trim() : userOpenId;
      const appId = typeof entry.appId === "string" ? entry.appId.trim() : "";
      const rawStatus = typeof entry.tokenStatus === "string" ? entry.tokenStatus : "";
      const tokenStatus =
        rawStatus === "valid" || rawStatus === "needs_refresh" || rawStatus === "ready"
          ? "valid"
          : rawStatus === "expired"
            ? "expired"
            : "missing";
      results.push({ appId, userOpenId, userName, tokenStatus });
    }
    return results;
  } catch {
    return [];
  }
}

function normalizeAuthStatusJson(raw: unknown): LarkAuthStatusResult {
  if (!raw || typeof raw !== "object") {
    return { tokenStatus: "missing" };
  }
  const obj = raw as Record<string, unknown>;
  const identities =
    obj.identities && typeof obj.identities === "object"
      ? (obj.identities as Record<string, unknown>)
      : undefined;
  const userIdentity =
    identities?.user && typeof identities.user === "object"
      ? (identities.user as Record<string, unknown>)
      : undefined;

  const userOpenId =
    (typeof obj.userOpenId === "string" && obj.userOpenId.trim()) ||
    (typeof userIdentity?.openId === "string" && userIdentity.openId.trim()) ||
    undefined;
  const userName =
    (typeof obj.userName === "string" && obj.userName.trim()) ||
    (typeof userIdentity?.userName === "string" && userIdentity.userName.trim()) ||
    undefined;

  const rawStatus =
    (typeof obj.tokenStatus === "string" && obj.tokenStatus) ||
    (typeof userIdentity?.tokenStatus === "string" && userIdentity.tokenStatus) ||
    (typeof userIdentity?.status === "string" && userIdentity.status) ||
    "";

  const available = userIdentity?.available !== false;
  const tokenStatus: "valid" | "expired" | "missing" =
    (rawStatus === "valid" || rawStatus === "ready" || rawStatus === "needs_refresh") && available
      ? "valid"
      : rawStatus === "expired"
        ? "expired"
        : "missing";

  let scopeCount = typeof obj.scopeCount === "number" ? obj.scopeCount : undefined;
  if (scopeCount === undefined && typeof userIdentity?.scope === "string") {
    scopeCount = userIdentity.scope.trim().split(/\s+/).filter(Boolean).length;
  }

  return {
    identity: typeof obj.identity === "string" ? obj.identity : undefined,
    appId: typeof obj.appId === "string" ? obj.appId : undefined,
    brand: obj.brand === "feishu" ? "feishu" : "lark",
    userOpenId,
    userName,
    tokenStatus,
    scopeCount,
    note: tokenStatus === "valid" ? undefined : typeof obj.note === "string" ? obj.note : undefined,
  };
}

export async function probeAccountStatus(
  binary: string,
  accountHome: string,
): Promise<LarkAuthStatusResult> {
  try {
    const { stdout } = await execFileAsync(binary, ["auth", "status"], {
      env: { ...process.env, HOME: accountHome },
      timeout: 12_000,
    });
    return normalizeAuthStatusJson(JSON.parse(stdout.trim()));
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout?.trim();
    if (stdout) {
      try {
        return normalizeAuthStatusJson(JSON.parse(stdout));
      } catch {
        // Ignore parse failure
      }
    }
    return {
      tokenStatus: "missing",
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function startDeviceLogin(options: {
  binary: string;
  paths: LarkSubPaths;
  appConfig: LarkAppConfig;
  loginId: string;
  domain?: string;
  onAuthorized: (result: { userOpenId: string; userName: string; scopeCount?: number }) => Promise<void>;
  onFailed: (reason: string) => Promise<void>;
}): Promise<StartedDeviceLogin> {
  const { binary, paths, appConfig, loginId, domain = "all", onAuthorized, onFailed } = options;
  const stagingHome = join(paths.stagingDir, loginId);
  await rm(stagingHome, { recursive: true, force: true });
  await ensureIsolatedLarkHome(paths, stagingHome, appConfig, null);

  const { stdout, stderr } = await execFileAsync(
    binary,
    ["auth", "login", "--domain", domain, "--no-wait", "--json"],
    {
      env: { ...process.env, HOME: stagingHome },
      timeout: 15_000,
    },
  );
  const rawOutput = stdout.trim() || stderr.trim();
  const challenge = JSON.parse(rawOutput) as {
    device_code?: string;
    expires_in?: number;
    verification_url?: string;
  };
  if (!challenge.device_code || !challenge.verification_url) {
    throw new Error(`Unexpected response from lark-cli auth login: ${rawOutput}`);
  }

  let userCode: string | undefined;
  try {
    const parsedUrl = new URL(challenge.verification_url);
    userCode = parsedUrl.searchParams.get("user_code") ?? undefined;
  } catch {
    // Ignore URL parse error
  }

  let qrDataUrl: string | undefined;
  const qrFile = join(stagingHome, "qr.png");
  try {
    await execFileAsync(
      binary,
      ["auth", "qrcode", challenge.verification_url, "--output", qrFile, "--size", "256"],
      {
        env: { ...process.env, HOME: stagingHome },
        timeout: 8_000,
      },
    );
    const pngBytes = await readFile(qrFile);
    qrDataUrl = `data:image/png;base64,${pngBytes.toString("base64")}`;
  } catch {
    // QR generation is optional if verificationUrl is present
  }

  const waitProcess = spawn(
    binary,
    ["auth", "login", "--device-code", challenge.device_code, "--json"],
    {
      env: { ...process.env, HOME: stagingHome },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdoutBuf = "";
  let stderrBuf = "";
  waitProcess.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
  });
  waitProcess.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
  });

  waitProcess.on("close", async (code) => {
    try {
      if (code === 0) {
        const status = await probeAccountStatus(binary, stagingHome);
        if (status.userOpenId) {
          await onAuthorized({
            userOpenId: status.userOpenId,
            userName: status.userName || status.userOpenId,
            scopeCount: status.scopeCount,
          });
          return;
        }
        const cfg = await readHostLarkConfig(stagingHome);
        const firstUser = cfg.users[0];
        if (firstUser) {
          await onAuthorized({
            userOpenId: firstUser.userOpenId,
            userName: firstUser.userName,
          });
          return;
        }
      }
      const errText = stdoutBuf.trim() || stderrBuf.trim() || `Exited with code ${code ?? "unknown"}`;
      await onFailed(errText);
    } catch (error) {
      await onFailed(error instanceof Error ? error.message : String(error));
    } finally {
      await rm(stagingHome, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  return {
    deviceCode: challenge.device_code,
    verificationUrl: challenge.verification_url,
    userCode,
    expiresIn: challenge.expires_in ?? 600,
    qrDataUrl,
    stagingHome,
    waitProcess,
  };
}
