import { describe, it, expect, vi } from "vitest";
import { createLogger } from "../src/log.js";

describe("createLogger", () => {
  it("never writes to stdout — only stderr", () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = createLogger("debug");
    log.error("e");
    log.warn("w");
    log.info("i");
    log.debug("d");
    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(4);
    out.mockRestore();
    err.mockRestore();
  });

  it("filters messages below the configured level", () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = createLogger("warn");
    log.error("e");
    log.warn("w");
    log.info("i");
    log.debug("d");
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});
