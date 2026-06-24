// Copy the canonical single-file plugin into server/assets/ so it ships in the
// npm tarball and can be auto-installed at runtime. Source of truth lives in
// plugin/src/ — this is a one-way copy, run as part of `npm run build`.
import { mkdir, copyFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const src = fileURLToPath(new URL("../../plugin/src/rbx-mcp.server.luau", import.meta.url));
const destDir = fileURLToPath(new URL("../assets/", import.meta.url));
// NOTE: ships as ".lua" — Studio's loose-file plugin loader does not pick up ".luau".
const dest = fileURLToPath(new URL("../assets/rbx-mcp.lua", import.meta.url));

await mkdir(destDir, { recursive: true });
await copyFile(src, dest);

const content = await readFile(dest, "utf8");
const version = content.match(/PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1] ?? "unknown";
console.log(`bundled plugin v${version} -> server/assets/rbx-mcp.lua`);
void here;
