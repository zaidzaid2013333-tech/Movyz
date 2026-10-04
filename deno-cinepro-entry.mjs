// Deno Deploy entrypoint for Movyz CinePro.
import process from "node:process";
import { MOVYZ_PUBLIC_URL } from "./.deno-cinepro-env.mjs";

process.env.NODE_ENV = process.env.NODE_ENV?.trim() || "production";
process.env.HOST = process.env.HOST?.trim() || "0.0.0.0";
process.env.PORT = process.env.PORT?.trim() || "8000";

const configuredPublicUrl = process.env.PUBLIC_URL?.trim() || MOVYZ_PUBLIC_URL?.trim() || "";
if (configuredPublicUrl) {
  process.env.PUBLIC_URL = configuredPublicUrl.replace(/\/+$/, "");
}

console.log("[Movyz/Deno] PUBLIC_URL:", process.env.PUBLIC_URL || "missing");

// Use a dynamic import so all runtime environment overrides are applied
// before CinePro constructs its OMSS server.
await import("./.deno-cinepro/core/dist/server.js");
