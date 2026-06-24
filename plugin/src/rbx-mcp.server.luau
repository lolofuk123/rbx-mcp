--!nocheck
--[[
	rbx-mcp — Roblox Studio plugin (single file)

	Polls the local rbx-mcp server for Lua commands, runs each via loadstring(),
	and reports back captured output, return values, and errors (with traceback).

	Deliberately dumb and universal: it executes whatever Lua it's handed, so it
	never needs updating for new tasks. All intelligence lives on the AI side.

	Talks only to the local server over loopback HTTP. Requires HttpService.
	Spec: work/02-studio-plugin.md · wire contract: work/01-wire-protocol.md
]]

local HttpService = game:GetService("HttpService")

local PLUGIN_VERSION = "0.1.0"
local HOLD_MS = 25000 -- long-poll hold; keep under HttpService's request timeout
local MAX_RESULT_BYTES = 900 * 1024 -- stay under the server's 1 MiB default
local SETTING_PREFIX = "rbx-mcp."

-- ============================================================ [Config]
local Config = {}
local DEFAULTS = { host = "127.0.0.1", port = 30700, token = "", enabled = false }

local function getSetting(key, default)
	local ok, value = pcall(function()
		return plugin:GetSetting(SETTING_PREFIX .. key)
	end)
	if not ok or value == nil then
		return default
	end
	return value
end

local function setSetting(key, value)
	pcall(function()
		plugin:SetSetting(SETTING_PREFIX .. key, value)
	end)
end

function Config.load()
	return {
		host = getSetting("host", DEFAULTS.host),
		port = tonumber(getSetting("port", DEFAULTS.port)) or DEFAULTS.port,
		token = getSetting("token", DEFAULTS.token),
		enabled = getSetting("enabled", DEFAULTS.enabled) == true,
	}
end

function Config.base(cfg)
	return ("http://%s:%d"):format(cfg.host, cfg.port)
end

-- ============================================================ [Serialize]
-- Total: never throws. Produces a JSON-safe string for any value.
local Serialize = {}
local MAX_KEYS, MAX_DEPTH = 50, 3

function Serialize.value(v, depth, seen)
	depth = depth or 0
	local t = typeof(v)
	if t == "nil" then
		return "nil"
	elseif t == "string" then
		return v
	elseif t == "number" or t == "boolean" then
		return tostring(v)
	elseif t == "Instance" then
		local ok, full = pcall(function()
			return v:GetFullName()
		end)
		return ("%s (%s)"):format(ok and full or v.Name, v.ClassName)
	elseif t == "table" then
		seen = seen or {}
		if seen[v] then
			return "<cycle>"
		end
		if depth >= MAX_DEPTH then
			return "{…}"
		end
		seen[v] = true
		local parts, count = {}, 0
		for key, val in pairs(v) do
			count += 1
			if count > MAX_KEYS then
				table.insert(parts, "… (truncated)")
				break
			end
			table.insert(parts, ("%s = %s"):format(tostring(key), Serialize.value(val, depth + 1, seen)))
		end
		seen[v] = nil
		return "{" .. table.concat(parts, ", ") .. "}"
	elseif t == "function" then
		return "<function>"
	else
		local ok, s = pcall(tostring, v)
		return ok and s or ("<" .. t .. ">")
	end
end

-- ============================================================ [Executor]
-- loadstring + captured environment + xpcall/traceback. Verified by the spike.
local Executor = {}

function Executor.run(code)
	local chunk, compileErr = loadstring(code, "=rbx-mcp")
	if not chunk then
		return {
			ok = false,
			output = "",
			error = { message = tostring(compileErr), traceback = tostring(compileErr), phase = "compile" },
			durationMs = 0,
		}
	end

	local buffer = {}
	local function capture(...)
		local parts = {}
		for i = 1, select("#", ...) do
			parts[i] = tostring(select(i, ...))
		end
		table.insert(buffer, table.concat(parts, "\t"))
	end

	local env = setmetatable({
		print = capture,
		warn = function(...)
			capture("[warn]", ...)
		end,
	}, { __index = getfenv() })
	setfenv(chunk, env)

	local t0 = os.clock()
	local results = table.pack(xpcall(chunk, function(err)
		return debug.traceback(tostring(err), 2)
	end))
	local durationMs = math.floor((os.clock() - t0) * 1000 + 0.5)
	local output = table.concat(buffer, "\n")

	if results[1] then
		local returnValues = nil
		if results.n >= 2 then
			returnValues = {}
			for i = 2, results.n do
				returnValues[i - 1] = Serialize.value(results[i])
			end
		end
		return { ok = true, output = output, returnValues = returnValues, error = nil, durationMs = durationMs }
	else
		local tb = tostring(results[2])
		local message = tb:match("^[^\n]*") or tb
		return {
			ok = false,
			output = output,
			error = { message = message, traceback = tb, phase = "runtime" },
			durationMs = durationMs,
		}
	end
end

-- Enforce the wire size cap: trim output (then drop return values) if too big.
local function capResult(result)
	if #result.output > MAX_RESULT_BYTES then
		result.output = result.output:sub(1, MAX_RESULT_BYTES) .. "\n… (truncated)"
		result.truncated = true
	end
	return result
end

-- ============================================================ [Transport]
local Transport = {}

local function headers(cfg)
	local h = { ["Content-Type"] = "application/json", ["X-RbxMcp-Plugin"] = "plugin/" .. PLUGIN_VERSION }
	if cfg.token and cfg.token ~= "" then
		h["X-RbxMcp-Token"] = cfg.token
	end
	return h
end

function Transport.poll(cfg, clientId)
	local url = ("%s/v1/poll?clientId=%s&wait=%d"):format(Config.base(cfg), HttpService:UrlEncode(clientId), HOLD_MS)
	local res = HttpService:RequestAsync({ Url = url, Method = "GET", Headers = headers(cfg) })
	if res.StatusCode == 200 then
		return "command", HttpService:JSONDecode(res.Body).command
	elseif res.StatusCode == 204 then
		return "idle"
	elseif res.StatusCode == 401 then
		return "auth"
	end
	return "error", res.StatusCode
end

function Transport.postResult(cfg, result)
	local res = HttpService:RequestAsync({
		Url = Config.base(cfg) .. "/v1/result",
		Method = "POST",
		Headers = headers(cfg),
		Body = HttpService:JSONEncode(result),
	})
	if res.StatusCode == 200 then
		return "accepted"
	elseif res.StatusCode == 404 then
		return "unknown"
	end
	return "error", res.StatusCode
end

-- ============================================================ [Ui]
local Ui = {}
local widget, statusLabel, toggleButton, lastLabel
local fields = {}

local COLORS = {
	ok = Color3.fromRGB(120, 220, 130),
	warn = Color3.fromRGB(240, 200, 90),
	error = Color3.fromRGB(240, 110, 110),
	idle = Color3.fromRGB(200, 200, 200),
}

local function makeLabel(text, parent, order)
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.new(1, -16, 0, 18)
	label.Font = Enum.Font.Gotham
	label.TextSize = 13
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextColor3 = COLORS.idle
	label.Text = text
	label.LayoutOrder = order
	label.Parent = parent
	return label
end

local function makeField(labelText, settingKey, value, order, parent, onSave)
	makeLabel(labelText, parent, order)
	local box = Instance.new("TextBox")
	box.Size = UDim2.new(1, -16, 0, 24)
	box.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
	box.TextColor3 = Color3.fromRGB(230, 230, 230)
	box.Font = Enum.Font.Code
	box.TextSize = 13
	box.ClearTextOnFocus = false
	box.Text = tostring(value)
	box.LayoutOrder = order + 1
	box.Parent = parent
	box.FocusLost:Connect(function()
		setSetting(settingKey, box.Text)
		if onSave then
			onSave()
		end
	end)
	fields[settingKey] = box
	return box
end

function Ui.build(onToggle)
	local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 300, 300, 260, 260)
	widget = plugin:CreateDockWidgetPluginGui("rbxMcpWidget", info)
	widget.Title = "rbx-mcp"

	local root = Instance.new("Frame")
	root.Size = UDim2.fromScale(1, 1)
	root.BackgroundColor3 = Color3.fromRGB(46, 46, 46)
	root.BorderSizePixel = 0
	root.Parent = widget

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 6)
	layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
	layout.Parent = root

	local pad = Instance.new("UIPadding")
	pad.PaddingTop = UDim.new(0, 10)
	pad.PaddingLeft = UDim.new(0, 8)
	pad.Parent = root

	statusLabel = makeLabel("Disconnected", root, 1)
	statusLabel.TextSize = 14

	local cfg = Config.load()
	makeField("Host", "host", cfg.host, 10, root)
	makeField("Port", "port", cfg.port, 20, root)
	makeField("Token (optional)", "token", cfg.token, 30, root)

	toggleButton = Instance.new("TextButton")
	toggleButton.Size = UDim2.new(1, -16, 0, 30)
	toggleButton.BackgroundColor3 = Color3.fromRGB(64, 110, 180)
	toggleButton.TextColor3 = Color3.fromRGB(255, 255, 255)
	toggleButton.Font = Enum.Font.GothamMedium
	toggleButton.TextSize = 14
	toggleButton.Text = "Start"
	toggleButton.LayoutOrder = 40
	toggleButton.Parent = root
	toggleButton.Activated:Connect(onToggle)

	lastLabel = makeLabel("", root, 50)
	lastLabel.TextSize = 12
	lastLabel.TextColor3 = COLORS.idle
end

function Ui.setStatus(text, kind)
	if statusLabel then
		statusLabel.Text = text
		statusLabel.TextColor3 = COLORS[kind] or COLORS.idle
	end
end

function Ui.setRunning(running)
	if toggleButton then
		toggleButton.Text = running and "Stop" or "Start"
		toggleButton.BackgroundColor3 = running and Color3.fromRGB(150, 70, 70) or Color3.fromRGB(64, 110, 180)
	end
end

function Ui.setLastCommand(commandId, ok, durationMs)
	if lastLabel then
		lastLabel.Text = ("last: %s  %s  %dms"):format(commandId:sub(1, 8), ok and "ok" or "ERR", durationMs)
	end
end

function Ui.toggleVisible()
	if widget then
		widget.Enabled = not widget.Enabled
	end
end

-- ============================================================ [Loop]
local Loop = {}
local active = false
local clientId = HttpService:GenerateGUID(false)

function Loop.isActive()
	return active
end

function Loop.start()
	if active then
		return
	end
	active = true
	Ui.setRunning(true)
	Ui.setStatus("Connecting…", "warn")

	task.spawn(function()
		local backoff = 0.5
		while active do
			if not HttpService.HttpEnabled then
				Ui.setStatus("HttpService disabled — enable it in Game Settings", "error")
				task.wait(2)
				continue
			end

			local cfg = Config.load()
			local ok, kind, data = pcall(Transport.poll, cfg, clientId)

			if not active then
				break
			elseif not ok then
				Ui.setStatus("Disconnected — is the server running?", "warn")
				task.wait(backoff)
				backoff = math.min(backoff * 2, 5)
			else
				backoff = 0.5
				if kind == "idle" then
					Ui.setStatus("Connected (idle)", "ok")
				elseif kind == "auth" then
					Ui.setStatus("Auth failed — check token", "error")
					task.wait(2)
				elseif kind == "error" then
					Ui.setStatus("Server error " .. tostring(data), "warn")
					task.wait(1)
				elseif kind == "command" then
					Ui.setStatus("Executing…", "ok")
					local result = capResult(Executor.run(data.code))
					result.commandId = data.commandId
					local pok, outcome = pcall(Transport.postResult, cfg, result)
					Ui.setLastCommand(data.commandId, result.ok, result.durationMs)
					if pok and outcome == "accepted" then
						Ui.setStatus("Connected (idle)", "ok")
					else
						Ui.setStatus("Result not accepted (" .. tostring(outcome) .. ")", "warn")
					end
				end
			end
		end
	end)
end

function Loop.stop()
	active = false
	Ui.setRunning(false)
	Ui.setStatus("Disconnected", "idle")
end

-- ============================================================ [main]
local toolbar = plugin:CreateToolbar("rbx-mcp")
local button = toolbar:CreateButton("rbx-mcp", "Show/hide the rbx-mcp panel", "")
button.ClickableWhenViewportHidden = true

local function onToggle()
	if Loop.isActive() then
		Loop.stop()
		setSetting("enabled", false)
	else
		Loop.start()
		setSetting("enabled", true)
	end
end

Ui.build(onToggle)
button.Click:Connect(Ui.toggleVisible)

plugin.Unloading:Connect(function()
	active = false
end)

-- Auto-start if it was running last session.
if Config.load().enabled then
	Loop.start()
end
