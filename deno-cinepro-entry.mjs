// Deno Deploy entrypoint for Movyz CinePro.
//
// CinePro Core is a Node-style HTTP server. Deno Deploy supplies the
// application/org slugs at runtime, which lets us build the canonical public
// URL used by CinePro's proxy/link builder without hard-coding a deployment URL.
import process from "node:process";

process.env.NODE_ENV = process.env.NODE_ENV?.trim() || "production";
process.env.HOST = process.env.HOST?.trim() || "0.0.0.0";
process.env.PORT = process.env.PORT?.trim() || "8000";

const appSlug = process.env.DENO_DEPLOY_APP_SLUG?.trim();
const orgSlug = process.env.DENO_DEPLOY_ORG_SLUG?.trim();
if (!process.env.PUBLIC_URL?.trim() && appSlug && orgSlug) {
  process.env.PUBLIC_URL = "https://" + appSlug + "." + orgSlug + ".deno.net";
}

// Use a dynamic import so all runtime environment overrides are applied
// before CinePro constructs its OMSS server.
await import("./.deno-cinepro/core/dist/server.js");
