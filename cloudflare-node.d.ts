declare module 'cloudflare:node' {
  export function httpServerHandler(options: { port: number }): (request: Request) => Promise<Response>;
}
