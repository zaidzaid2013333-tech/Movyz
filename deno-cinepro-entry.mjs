// Deno Deploy entrypoint for Movyz CinePro.
import process from "node:process";

process.env.NODE_ENV = process.env.NODE_ENV?.trim() || "production";
process.env.HOST = process.env.HOST?.trim() || "0.0.0.0";
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

console.log("[Movyz/Deno] PUBLIC_URL:", process.env.PUBLIC_URL || "missing");

// Use a dynamic import so all runtime environment overrides are applied
// before CinePro constructs its OMSS server.
await import("./.deno-cinepro/core/dist/server.js");
