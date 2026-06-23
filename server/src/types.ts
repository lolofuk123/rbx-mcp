export type Phase = "compile" | "runtime" | "timeout" | "internal";

export interface Command {
  commandId: string;
  kind: "execute_lua";
  code: string;
  timeoutMs: number;
  meta?: Record<string, unknown>;
}

export interface ResultError {
  message: string;
  traceback: string;
  phase: Phase;
}

export interface Result {
  commandId: string;
  ok: boolean;
  output: string;
  returnValues: string[] | null;
  error: ResultError | null;
  durationMs: number;
  truncated?: boolean;
}

export interface Status {
  status: "ok";
  bridgeVersion: string;
  queueDepth: number;
  inFlight: number;
  pluginConnected: boolean;
  lastPollAt: string | null;
}

/** Structural validation of a result body posted by the plugin (defensive — the wire is untyped). */
export function isValidResultBody(v: unknown): v is Result {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (typeof r.commandId !== "string") return false;
  if (typeof r.ok !== "boolean") return false;
  if (typeof r.output !== "string") return false;
  // Be liberal: the plugin omits nil fields, so `error`/`returnValues` may be absent (undefined).
  if (r.returnValues !== null && r.returnValues !== undefined && !Array.isArray(r.returnValues)) return false;
  if (typeof r.durationMs !== "number") return false;
  if (r.error !== null && r.error !== undefined) {
    if (typeof r.error !== "object") return false;
    const e = r.error as Record<string, unknown>;
    if (typeof e.message !== "string") return false;
  }
  return true;
}
