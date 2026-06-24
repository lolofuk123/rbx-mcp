import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "./log.js";

export type InstallAction =
  | "written"
  | "updated"
  | "skipped-same"
  | "skipped-usermodified"
  | "skipped-downgrade"
  | "no-plugins-dir"
  | "error";

export interface InstallResult {
  action: InstallAction;
  path?: string;
  message?: string;
}

export interface InstallOptions {
  log: Logger;
  /** Override the bundled plugin source (tests). */
  sourcePath?: string;
  /** Override the destination Plugins dir; `null` means "no standard path". */
  pluginsDir?: string | null;
  fileName?: string;
}

const PLUGIN_FILE = "rbx-mcp.lua";

/** Path to the plugin asset bundled in the package (../assets relative to this module). */
export function bundledPluginPath(): string {
  return fileURLToPath(new URL("../assets/rbx-mcp.lua", import.meta.url));
}

/** Local Roblox Studio Plugins folder for the current OS, or null if there's no standard one. */
export function resolvePluginsDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    return local ? join(local, "Roblox", "Plugins") : null;
  }
  if (platform === "darwin") {
    return join(homedir(), "Documents", "Roblox", "Plugins");
  }
  return null; // Linux / other: no standard Studio install path
}

function parseVersion(content: string): string {
  return content.match(/PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1] ?? "0.0.0";
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Install/refresh the bundled plugin into the local Plugins folder.
 *
 * - missing            → write
 * - identical          → skip
 * - bundled is newer   → overwrite (update)
 * - same version, diff → skip (don't clobber a user-modified copy)
 * - bundled is older   → skip (don't downgrade)
 *
 * Never throws: returns a structured result so the bootstrap can log and continue.
 */
export async function installPlugin(opts: InstallOptions): Promise<InstallResult> {
  const sourcePath = opts.sourcePath ?? bundledPluginPath();
  const pluginsDir = opts.pluginsDir !== undefined ? opts.pluginsDir : resolvePluginsDir();
  const fileName = opts.fileName ?? PLUGIN_FILE;

  if (pluginsDir === null) {
    return {
      action: "no-plugins-dir",
      message: "no standard Roblox Plugins folder for this OS — install the plugin manually (see plugin/README.md)",
    };
  }

  let bundled: string;
  try {
    bundled = await readFile(sourcePath, "utf8");
  } catch (err) {
    return { action: "error", message: `cannot read bundled plugin: ${(err as Error).message}` };
  }

  const dest = join(pluginsDir, fileName);
  try {
    await mkdir(pluginsDir, { recursive: true });
    if (!existsSync(dest)) {
      await writeFile(dest, bundled, "utf8");
      return { action: "written", path: dest };
    }
    const existing = await readFile(dest, "utf8");
    if (existing === bundled) return { action: "skipped-same", path: dest };

    const cmp = compareVersions(parseVersion(bundled), parseVersion(existing));
    if (cmp > 0) {
      await writeFile(dest, bundled, "utf8");
      return { action: "updated", path: dest };
    }
    if (cmp === 0) return { action: "skipped-usermodified", path: dest };
    return { action: "skipped-downgrade", path: dest };
  } catch (err) {
    return { action: "error", path: dest, message: (err as Error).message };
  }
}
