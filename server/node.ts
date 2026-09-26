import 'dotenv/config';
import { createServer } from 'node:http';
import { app } from './index';

const port = Number(process.env.PORT || 8787);

createServer(async (req, res) => {
  const protocol = (req.headers['x-forwarded-proto'] as string) || 'http';
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `${protocol}://${host}`);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const request = new Request(url, {
    method: req.method || 'GET',
    headers: Object.entries(req.headers).flatMap(([key, value]) => {
      if (Array.isArray(value)) return value.map((v) => [key, v] as [string, string]);
      if (value === undefined) return [];
      return [[key, value] as [string, string]];
    }),
    body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : Buffer.concat(chunks),
  });
  const response = await app.handle(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}).listen(port, () => console.log(`Movyz API listening on port ${port}`));
