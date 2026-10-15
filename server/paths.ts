import { homedir } from "node:os";
import { join } from "node:path";

export interface LarkSubPaths {
  readonly root: string;
  readonly stateFile: string;
  readonly homesDir: string;
  readonly binDir: string;
  readonly stagingDir: string;
  readonly hostHome: string;
  accountHome(accountId: string): string;
}

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export function validateId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new Error(`Invalid account id "${id}". Expected lowercase letters, digits, hyphens, or underscores.`);
  }
}

export function slugifyId(input: string, fallback = "lark-user"): string {
  const normalized = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return normalized || fallback;
}

export function paseoHomeDir(env: NodeJS.ProcessEnv = process.env, hostHome = homedir()): string {
  return env.PASEO_HOME?.trim() || join(hostHome, ".paseo");
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env, hostHome = homedir()): LarkSubPaths {
  const paseoHome = paseoHomeDir(env, hostHome);
  const root = env.LARKSUB_DIR?.trim() || join(paseoHome, "larksub");
  const homesDir = join(root, "homes");
  const binDir = join(root, "bin");
  const stagingDir = join(root, "staging");
  return {
    root,
    stateFile: join(root, "state.json"),
    homesDir,
    binDir,
    stagingDir,
    hostHome,
    accountHome(accountId: string) {
      validateId(accountId);
      return join(homesDir, accountId);
    },
  };
}
