--!nocheck
--[[
	rbx-mcp Phase 1 executor harness (Spec 02 §11, Test 1.2).

	Paste into the Studio Command Bar and press Enter. Reads the VERDICT at the
	bottom of Output. This mirrors the Executor logic in src/rbx-mcp.server.luau
	so we can assert its behaviour in Studio (there is no headless Luau runner).
]]

-- Executor under test (same shape as the plugin's [Executor] section) ----------
local function run(code)
	local chunk, compileErr = loadstring(code, "=rbx-mcp")
	if not chunk then
		return { ok = false, output = "", error = { message = tostring(compileErr), phase = "compile" } }
	end
	local buffer = {}
	local function capture(...)
		local parts = {}
		for i = 1, select("#", ...) do
			parts[i] = tostring(select(i, ...))
		end
		table.insert(buffer, table.concat(parts, "\t"))
	end
	local env = setmetatable({ print = capture, warn = function(...) capture("[warn]", ...) end }, { __index = getfenv() })
	setfenv(chunk, env)
	local results = table.pack(xpcall(chunk, function(err)
		return debug.traceback(tostring(err), 2)
	end))
	local output = table.concat(buffer, "\n")
	if results[1] then
		local rv
		if results.n >= 2 then
			rv = {}
			for i = 2, results.n do
				rv[i - 1] = tostring(results[i])
			end
		end
		return { ok = true, output = output, returnValues = rv }
	end
	local tb = tostring(results[2])
	return { ok = false, output = output, error = { message = tb:match("^[^\n]*") or tb, traceback = tb, phase = "runtime" } }
end

-- Assertions ------------------------------------------------------------------
local passed, failed = 0, 0
local function check(name, cond)
	if cond then
		passed += 1
		print(("  ✓ %s"):format(name))
	else
		failed += 1
		warn(("  ✗ %s"):format(name))
	end
end

print("================ rbx-mcp executor harness ================")

local r1 = run("return 1 + 1")
check("return 1+1 → ok", r1.ok == true)
check("return 1+1 → returnValues {\"2\"}", r1.returnValues and r1.returnValues[1] == "2")

local r2 = run('print("hi")')
check("print captured into output", r2.ok and r2.output == "hi")

local r3 = run('error("boom")')
check("runtime error → ok=false", r3.ok == false)
check("runtime error → phase runtime", r3.error and r3.error.phase == "runtime")
check("runtime error → message has boom", r3.error and r3.error.message:find("boom") ~= nil)
check("runtime error → traceback present", r3.error and #r3.error.traceback > 0)

local r4 = run("return (")
check("compile error → ok=false", r4.ok == false)
check("compile error → phase compile", r4.error and r4.error.phase == "compile")

local r5 = run('print("before"); error("after")')
check("output preserved when chunk errors", r5.ok == false and r5.output == "before")

print("----------------------------------------------------------")
if failed == 0 then
	print(("VERDICT: ✅ ALL PASS (%d checks)"):format(passed))
else
	warn(("VERDICT: ❌ %d FAILED, %d passed"):format(failed, passed))
end
print("==========================================================")
