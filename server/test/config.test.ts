import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies defaults when env is empty", () => {
    const c = loadConfig({});
    expect(c.host).toBe("127.0.0.1");
    expect(c.port).toBe(30700);
    expect(c.pollHoldMs).toBe(25000);
    expect(c.cmdTimeoutMs).toBe(30000);
    expect(c.maxResultBytes).toBe(1024 * 1024);
    expect(c.maxQueueDepth).toBe(16);
    expect(c.token).toBeNull();
    expect(c.logLevel).toBe("info");
    expect(c.dev).toBe(false);
    expect(c.autoInstall).toBe(true);
  });

  it("clamps command timeout below the floor and above the ceiling", () => {
    expect(loadConfig({ RBXMCP_CMD_TIMEOUT_MS: "10" }).cmdTimeoutMs).toBe(1000);
    expect(loadConfig({ RBXMCP_CMD_TIMEOUT_MS: "9999999" }).cmdTimeoutMs).toBe(600000);
  });

  it("falls back to default on a non-numeric port", () => {
    expect(loadConfig({ RBXMCP_PORT: "not-a-number" }).port).toBe(30700);
  });

  it("honors autoinstall off and dev on", () => {
    const c = loadConfig({ RBXMCP_AUTOINSTALL: "off", RBXMCP_DEV: "1" });
    expect(c.autoInstall).toBe(false);
    expect(c.dev).toBe(true);
  });

  it("sets token only when non-empty", () => {
    expect(loadConfig({ RBXMCP_TOKEN: "secret" }).token).toBe("secret");
    expect(loadConfig({ RBXMCP_TOKEN: "" }).token).toBeNull();
  });

  it("invalid log level falls back to info", () => {
    expect(loadConfig({ RBXMCP_LOG: "loud" }).logLevel).toBe("info");
    expect(loadConfig({ RBXMCP_LOG: "debug" }).logLevel).toBe("debug");
  });
});
