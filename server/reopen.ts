import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { paseoHomeDir } from "./paths";

const execFileAsync = promisify(execFile);

/**
 * Reloads an idle agent session so updated environment variables take effect immediately,
 * although our `~/.paseo/larksub/bin/lark-cli` shim also reads `state.json` dynamically on every command!
 */
export async function reloadAgentSessionIfIdle(agentId: string): Promise<void> {
  try {
    await execFileAsync(
      "paseo",
      ["agent", "reload", agentId, "--json", "--home", paseoHomeDir()],
      { timeout: 10_000 },
    );
  } catch {
    // Non-fatal: the dynamic lark-cli shim resolves sessionBindings[PASEO_LARK_SESSION_ID] from state.json on every command.
  }
}
