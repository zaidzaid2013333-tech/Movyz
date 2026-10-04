// Deno Deploy entrypoint for Movyz CinePro.
import process from "node:process";

process.env.NODE_ENV = process.env.NODE_ENV?.trim() || "production";
process.env.HOST = process.env.HOST?.trim() || "localhost";
process.env.PORT = process.env.PORT?.trim() || "8000";

// Prefer an explicitly configured public URL. Otherwise build the default
// Deno Deploy URL from the built-in application/org slugs.
const configuredPublicUrl =
  process.env.PUBLIC_URL?.trim() ||
  (
    process.env.DENO_DEPLOY_APP_SLUG &&
    process.env.DENO_DEPLOY_ORG_SLUG
      ? `https://${process.env.DENO_DEPLOY_APP_SLUG}.${process.env.DENO_DEPLOY_ORG_SLUG}.deno.net`
      : ""
  );

if (configuredPublicUrl) {
  process.env.PUBLIC_URL = configuredPublicUrl.replace(/\/+$/, "");
}

console.log("[Movyz/Deno] HOST:", process.env.HOST);
console.log("[Movyz/Deno] PORT:", process.env.PORT);
console.log("[Movyz/Deno] PUBLIC_URL:", process.env.PUBLIC_URL || "missing");

// CinePro starts its HTTP server from src/server.ts. Keep this entrypoint
// alive after loading CinePro so Deno's warm-up does not race the async
// provider discovery/server.start() sequence.
await import("./.deno-cinepro/core/dist/server.js");

await new Promise(() => {});
