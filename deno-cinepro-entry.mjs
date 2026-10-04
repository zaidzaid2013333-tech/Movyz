// Deno Deploy entrypoint for Movyz CinePro.
//
// CinePro Core is a Node-style HTTP server and defaults to localhost:3000.
// Deno Deploy's dynamic runtime needs the server exposed on the runtime
// interface, so normalize the network settings before loading CinePro.
//
// Use a dynamic import deliberately: a static import is evaluated before
// these environment assignments and would start CinePro with its defaults.
import process from "node:process";

process.env.HOST = process.env.HOST?.trim() || "0.0.0.0";
process.env.PORT = process.env.PORT?.trim() || "8000";

await import("./.deno-cinepro/core/dist/server.js");
