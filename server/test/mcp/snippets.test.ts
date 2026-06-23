import { describe, it, expect } from "vitest";
import { buildStateSnippet, isSafePath } from "../../src/mcp/snippets.js";

describe("isSafePath", () => {
  it("accepts dotted instance paths", () => {
    expect(isSafePath("Workspace.Model.Part")).toBe(true);
    expect(isSafePath("Workspace")).toBe(true);
  });
  it("rejects empty and injection-y paths", () => {
    expect(isSafePath("")).toBe(false);
    expect(isSafePath(undefined)).toBe(false);
    expect(isSafePath('"); game:Destroy() --')).toBe(false);
    expect(isSafePath("a\"b")).toBe(false);
  });
});

describe("buildStateSnippet", () => {
  it("selection snippet uses the Selection service", () => {
    expect(buildStateSnippet("selection", {})).toContain('game:GetService("Selection")');
  });

  it("services_summary lists services", () => {
    expect(buildStateSnippet("services_summary", {})).toContain("Workspace");
  });

  it("explorer_tree clamps depth into the snippet", () => {
    expect(buildStateSnippet("explorer_tree", { depth: 3 })).toContain("DEPTH = 3");
    expect(buildStateSnippet("explorer_tree", { depth: 99 })).toContain("DEPTH = 6"); // clamped
    expect(buildStateSnippet("explorer_tree", {})).toContain("DEPTH = 2"); // default
  });

  it("instance snippet interpolates the validated path", () => {
    const code = buildStateSnippet("instance", { path: "Workspace.Part" });
    expect(code).toContain('string.split("Workspace.Part", ".")');
  });
});
