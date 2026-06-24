import { describe, it, expect } from "vitest";
import { toToolResult, textResult } from "../../src/mcp/toToolResult.js";

describe("toToolResult", () => {
  it("formats a success with output and return values", () => {
    const r = toToolResult({ commandId: "a", ok: true, output: "hi", returnValues: ["2"], error: null, durationMs: 5 });
    expect(r.isError).toBe(false);
    const text = r.content[0]!.text;
    expect(text).toContain("✅ ok");
    expect(text).toContain("hi");
    expect(text).toContain("returns: 2");
    expect(text).toContain("5 ms");
  });

  it("marks truncated results", () => {
    const r = toToolResult({ commandId: "a", ok: true, output: "x", returnValues: null, error: null, durationMs: 1, truncated: true });
    expect(r.content[0]!.text).toContain("truncated");
  });

  it("formats an error with phase, message, and traceback (isError)", () => {
    const r = toToolResult({
      commandId: "a",
      ok: false,
      output: "partial",
      returnValues: null,
      error: { message: "boom", traceback: "tb-line", phase: "runtime" },
      durationMs: 1,
    });
    expect(r.isError).toBe(true);
    const text = r.content[0]!.text;
    expect(text).toContain("runtime error: boom");
    expect(text).toContain("partial");
    expect(text).toContain("tb-line");
  });

  it("textResult builds a plain text block", () => {
    expect(textResult("hello").content[0]!.text).toBe("hello");
    expect(textResult("bad", true).isError).toBe(true);
  });
});
