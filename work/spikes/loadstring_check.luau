--!nocheck
-- RoMCP spike: verify the load-bearing plugin assumptions (Spec 02 §10).
-- Tests: (1) loadstring available + runs, (2) setfenv-based print capture,
--        (3) xpcall + debug.traceback, (4) compile-error path.
--
-- HOW TO RUN
--   Quick check : paste this whole file into the Studio Command Bar and press Enter.
--   Faithful    : put it in a Script, right-click it in Explorer →
--                 "Save as Local Plugin..." (this runs it in the real PLUGIN
--                 security context we ship in — the one the spec cares about).
--
-- Read the VERDICT line at the bottom of Output.

local results = {}

-- (1) loadstring present?
local hasLoadstring = (typeof(loadstring) == "function")
results.loadstring_present = hasLoadstring
if not hasLoadstring then
	warn("[rbx-mcp-spike] loadstring is NOT available in this context — STOP, design assumption broken.")
end

-- (2) compile a real chunk
local code = [[
print("hello from chunk")
warn("a warning from chunk")
return 1 + 1, workspace.Name
]]

local chunk, compileErr = nil, nil
if hasLoadstring then
	chunk, compileErr = loadstring(code, "=rbx-mcp")
end
results.compiled = (chunk ~= nil)

-- (3) capture print/warn via a custom environment (setfenv path)
local captureWorks = false
local capturedText, returnedA, returnedB, ranOk = "", nil, nil, false
if chunk then
	local buf = {}
	local function cap(...)
		local parts = {}
		for i = 1, select("#", ...) do
			parts[i] = tostring(select(i, ...))
		end
		table.insert(buf, table.concat(parts, "\t"))
	end

	local okSetfenv = pcall(function()
		local env = setmetatable({
			print = cap,
			warn = function(...) cap("[warn]", ...) end,
		}, { __index = getfenv() }) -- real globals (workspace, game, services) fall through
		setfenv(chunk, env)
	end)
	results.setfenv_callable = okSetfenv

	-- (4) run with traceback
	local packed = table.pack(xpcall(chunk, function(e)
		return debug.traceback(tostring(e), 2)
	end))
	ranOk = packed[1]
	returnedA, returnedB = packed[2], packed[3]
	capturedText = table.concat(buf, "\n")
	captureWorks = okSetfenv and ranOk and (capturedText:find("hello from chunk") ~= nil)
end
results.capture_works = captureWorks
results.ran_ok = ranOk

-- (5) compile-error path returns nil + message?
local badChunk, badErr = nil, "loadstring unavailable"
if hasLoadstring then
	badChunk, badErr = loadstring("return (")
end
results.compile_error_path = (badChunk == nil and type(badErr) == "string")

-- (6) runtime-error path produces a traceback?
local tracebackWorks = false
if hasLoadstring then
	local errChunk = loadstring([[error("boom")]])
	if errChunk then
		local _, tb = xpcall(errChunk, function(e) return debug.traceback(tostring(e), 2) end)
		tracebackWorks = type(tb) == "string" and tb:find("boom") ~= nil
		results.runtime_traceback_sample = tb
	end
end
results.traceback_works = tracebackWorks

-- Report -----------------------------------------------------------------
print("================ RoMCP spike results ================")
print("loadstring present :", results.loadstring_present)
print("chunk compiled     :", results.compiled)
print("setfenv callable   :", results.setfenv_callable)
print("ran ok             :", results.ran_ok)
print("captured output    :", string.format("%q", capturedText))
print("returns            :", returnedA, returnedB)
print("compile-error path :", results.compile_error_path)
print("traceback works    :", results.traceback_works)
print("traceback sample   :")
print(results.runtime_traceback_sample)
print("-----------------------------------------------------")

local allPass = results.loadstring_present
	and results.compiled
	and results.capture_works
	and results.compile_error_path
	and results.traceback_works

if allPass then
	print("VERDICT: ✅ ALL PASS — Spec 02 design is viable as written.")
else
	warn("VERDICT: ❌ FAIL — one or more assumptions broke; see lines above before building Phase 1.")
	if not results.capture_works then
		warn("  → print capture failed. Fallback: inject print via the chunk's _ENV / string-prefix instead of setfenv (Spec 02 §10).")
	end
	if not results.loadstring_present then
		warn("  → loadstring missing. Try the 'Save as Local Plugin' path; if still missing, the loadstring design is blocked.")
	end
end
print("=====================================================")
