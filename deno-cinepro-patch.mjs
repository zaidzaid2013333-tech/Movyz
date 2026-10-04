import fs from "node:fs";

const path = ".deno-cinepro/core/src/server.ts";
let source = fs.readFileSync(path, "utf8");

const discovery = "await registry.discoverProviders(path.join(__dirname, './providers/'));";
if (!source.includes(discovery)) throw new Error("CinePro discovery line not found");

source = source.replace(
  discovery,
  "console.log('[Movyz/Deno] BEFORE provider discovery');\n    " +
  discovery +
  "\n    console.log('[Movyz/Deno] AFTER provider discovery');"
);

const start = "await server.start();";
if (!source.includes(start)) throw new Error("CinePro start line not found");

source = source.replace(
  start,
  "console.log('[Movyz/Deno] BEFORE server.start()');\n    " +
  start +
  "\n    console.log('[Movyz/Deno] AFTER server.start()');"
);

fs.writeFileSync(path, source);
console.log("[Movyz/Deno] Patched CinePro diagnostics");
