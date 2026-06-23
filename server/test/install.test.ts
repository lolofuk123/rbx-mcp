import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPlugin, resolvePluginsDir } from "../src/install.js";
import type { Logger } from "../src/log.js";

const silent: Logger = { error() {}, warn() {}, info() {}, debug() {} };

describe("installPlugin", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rbxmcp-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function source(version: string, extra = ""): Promise<string> {
    const p = join(dir, `bundled-${version}-${Math.random().toString(36).slice(2)}.luau`);
    await writeFile(p, `local PLUGIN_VERSION = "${version}"\n${extra}`);
    return p;
  }

  it("writes the plugin when the destination is empty", async () => {
    const pluginsDir = join(dir, "Plugins");
    const r = await installPlugin({ log: silent, sourcePath: await source("0.1.0"), pluginsDir });
    expect(r.action).toBe("written");
    expect(await readFile(join(pluginsDir, "rbx-mcp.lua"), "utf8")).toContain("0.1.0");
  });

  it("skips when the installed copy is identical", async () => {
    const pluginsDir = join(dir, "Plugins");
    const s = await source("0.1.0");
    await installPlugin({ log: silent, sourcePath: s, pluginsDir });
    const r = await installPlugin({ log: silent, sourcePath: s, pluginsDir });
    expect(r.action).toBe("skipped-same");
  });

  it("updates when the bundled version is newer", async () => {
    const pluginsDir = join(dir, "Plugins");
    await installPlugin({ log: silent, sourcePath: await source("0.1.0"), pluginsDir });
    const r = await installPlugin({ log: silent, sourcePath: await source("0.2.0"), pluginsDir });
    expect(r.action).toBe("updated");
    expect(await readFile(join(pluginsDir, "rbx-mcp.lua"), "utf8")).toContain("0.2.0");
  });

  it("preserves a user-modified copy at the same version", async () => {
    const pluginsDir = join(dir, "Plugins");
    await installPlugin({ log: silent, sourcePath: await source("0.1.0", "-- original"), pluginsDir });
    const r = await installPlugin({ log: silent, sourcePath: await source("0.1.0", "-- changed"), pluginsDir });
    expect(r.action).toBe("skipped-usermodified");
  });

  it("does not downgrade", async () => {
    const pluginsDir = join(dir, "Plugins");
    await installPlugin({ log: silent, sourcePath: await source("0.2.0"), pluginsDir });
    const r = await installPlugin({ log: silent, sourcePath: await source("0.1.0"), pluginsDir });
    expect(r.action).toBe("skipped-downgrade");
  });

  it("reports no-plugins-dir when there is no standard path", async () => {
    const r = await installPlugin({ log: silent, sourcePath: await source("0.1.0"), pluginsDir: null });
    expect(r.action).toBe("no-plugins-dir");
  });

  it("reports an error if the bundled source is missing", async () => {
    const r = await installPlugin({ log: silent, sourcePath: join(dir, "nope.luau"), pluginsDir: join(dir, "Plugins") });
    expect(r.action).toBe("error");
  });
});

describe("resolvePluginsDir", () => {
  it("is null on linux/unknown", () => {
    expect(resolvePluginsDir("linux", {})).toBeNull();
  });
  it("uses LOCALAPPDATA on windows", () => {
    expect(resolvePluginsDir("win32", { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" })).toContain("Roblox");
  });
  it("uses Documents on macOS", () => {
    expect(resolvePluginsDir("darwin", {})).toContain("Roblox");
  });
});
