// Deno Deploy entrypoint for Movyz CinePro.
//
// CinePro Core reads HOST/PORT/PUBLIC_URL while constructing its server.
// Read Deno Deploy's predefined runtime variables through Deno.env so the
// public proxy URL is available before CinePro is imported.
const getEnv = (key) => Deno.env.get(key)?.trim() || "";

const nodeEnv = getEnv("NODE_ENV") || "production";
const host = getEnv("HOST") || "0.0.0.0";
const port = getEnv("PORT") || "8000";
const configuredPublicUrl = getEnv("PUBLIC_URL");

const appSlug = getEnv("DENO_DEPLOY_APP_SLUG");
const orgSlug = getEnv("DENO_DEPLOY_ORG_SLUG");
const publicUrl =
  configuredPublicUrl ||
  (appSlug && orgSlug ? "https://" + appSlug + "." + orgSlug + ".deno.net" : "");

Deno.env.set("NODE_ENV", nodeEnv);
Deno.env.set("HOST", host);
Deno.env.set("PORT", port);
if (publicUrl) Deno.env.set("PUBLIC_URL", publicUrl);

console.log("[Movyz/Deno] DENO_DEPLOY:", getEnv("DENO_DEPLOY") || "unknown");
console.log("[Movyz/Deno] App/Org:", appSlug || "missing", "/", orgSlug || "missing");
console.log("[Movyz/Deno] PUBLIC_URL:", publicUrl || "missing");

// Use a dynamic import so all runtime environment overrides are applied
// before CinePro constructs its OMSS server.
await import("./.deno-cinepro/core/dist/server.js");
