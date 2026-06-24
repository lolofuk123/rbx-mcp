export type StateQuery = "selection" | "explorer_tree" | "instance" | "services_summary";

/** A Studio path is a dotted name like "Workspace.Model.Part" — restrict to safe chars. */
export function isSafePath(path: string | undefined): path is string {
  return typeof path === "string" && path.trim().length > 0 && /^[A-Za-z0-9_. ]+$/.test(path);
}

const SELECTION = `
local sel = game:GetService("Selection"):Get()
if #sel == 0 then return "(nothing selected)" end
local lines = {}
for _, inst in ipairs(sel) do
	table.insert(lines, inst:GetFullName() .. " (" .. inst.ClassName .. ")")
end
return table.concat(lines, "\\n")
`.trim();

const SERVICES_SUMMARY = `
local names = {"Workspace","Lighting","ReplicatedStorage","ReplicatedFirst","ServerStorage","ServerScriptService","StarterGui","StarterPack","StarterPlayer","SoundService","Teams"}
local out = {}
for _, name in ipairs(names) do
	local ok, svc = pcall(function() return game:GetService(name) end)
	if ok and svc then
		table.insert(out, ("%s: %d children"):format(name, #svc:GetChildren()))
	end
end
return table.concat(out, "\\n")
`.trim();

function explorerTree(depth: number): string {
  return `
local DEPTH = ${depth}
local function walk(inst, d, prefix, out)
	for _, child in ipairs(inst:GetChildren()) do
		table.insert(out, prefix .. child.Name .. " (" .. child.ClassName .. ")")
		if d < DEPTH then
			walk(child, d + 1, prefix .. "  ", out)
		end
	end
end
local out = {}
walk(workspace, 1, "", out)
if #out == 0 then return "(workspace is empty)" end
return table.concat(out, "\\n")
`.trim();
}

function instanceDump(path: string): string {
  // `path` MUST be pre-validated by isSafePath before reaching here.
  return `
local parts = string.split("${path}", ".")
local node = game
for _, p in ipairs(parts) do
	if p ~= "" and node then
		node = node:FindFirstChild(p)
	end
end
if not node then return "(not found: ${path})" end
local children = {}
for _, c in ipairs(node:GetChildren()) do
	table.insert(children, "  " .. c.Name .. " (" .. c.ClassName .. ")")
end
return table.concat({
	"Instance: " .. node:GetFullName(),
	"ClassName: " .. node.ClassName,
	"Children (" .. #children .. "):",
	table.concat(children, "\\n"),
}, "\\n")
`.trim();
}

/** Build the server-owned Lua snippet for a read_studio_state query. */
export function buildStateSnippet(query: StateQuery, params: { path?: string; depth?: number }): string {
  switch (query) {
    case "selection":
      return SELECTION;
    case "services_summary":
      return SERVICES_SUMMARY;
    case "explorer_tree":
      return explorerTree(clampDepth(params.depth));
    case "instance":
      return instanceDump(params.path ?? "");
  }
}

function clampDepth(depth: number | undefined): number {
  if (depth === undefined || !Number.isFinite(depth)) return 2;
  return Math.min(6, Math.max(1, Math.floor(depth)));
}
