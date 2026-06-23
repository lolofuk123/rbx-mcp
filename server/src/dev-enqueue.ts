/**
 * Dev CLI: enqueue one Lua command against a running server and print the result.
 *
 *   RBXMCP_DEV=1 npm run dev               # in one terminal (starts the server)
 *   npm run dev-enqueue -- "return 1 + 1"  # in another
 *
 * Talks to the dev-only POST /v1/_dev/enqueue route (only present when RBXMCP_DEV is set).
 * This is a standalone process, not the MCP server, so writing to stdout is fine here.
 */
const code = process.argv[2];
if (!code) {
  console.error('usage: dev-enqueue "<lua code>"');
  process.exit(1);
}

const host = process.env.RBXMCP_HOST ?? "127.0.0.1";
const port = process.env.RBXMCP_PORT ?? "30700";
const token = process.env.RBXMCP_TOKEN;

const headers: Record<string, string> = { "content-type": "application/json" };
if (token) headers["x-rbxmcp-token"] = token;

try {
  const res = await fetch(`http://${host}:${port}/v1/_dev/enqueue`, {
    method: "POST",
    headers,
    body: JSON.stringify({ code }),
  });
  const text = await res.text();
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    /* leave as-is */
  }
  console.log(`HTTP ${res.status}\n${pretty}`);
  process.exit(res.ok ? 0 : 1);
} catch (err) {
  console.error(
    `Failed to reach the server at http://${host}:${port}. ` +
      `Is it running with RBXMCP_DEV=1?\n${(err as Error).message}`,
  );
  process.exit(1);
}
