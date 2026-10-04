declare module 'cloudflare:node' {
  export function httpServerHandler(
    options: { port: number } | any,
  ): (request: Request) => Promise<Response>;

  export function handleAsNodeRequest(
    port: number,
    request: Request,
  ): Promise<Response>;
}
