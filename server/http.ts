import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApi, MAX_BODY_BYTES } from "./api";

export async function apiFromNode(req: IncomingMessage, handler = handleApi, origin = "http://localhost"): Promise<Response> {
  const method = req.method ?? "GET";
  const parts: Uint8Array[] = [];
  let length = 0;
  // Returning a 413 must not destroy the HTTP socket before the response is sent.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_BODY_BYTES) {
      req.resume();
      return new Response(JSON.stringify({ error: "Request body too large" }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    }
    parts.push(bytes);
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers))
    if (typeof value === "string") headers.set(key, value);
  // Vercel can supply a parsed body after consuming the IncomingMessage stream.
  const supplied = (req as IncomingMessage & { body?: unknown }).body;
  if (length === 0 && supplied !== undefined) {
    const bytes = Buffer.isBuffer(supplied)
      ? supplied
      : Buffer.from(
          typeof supplied === "string" ? supplied : JSON.stringify(supplied),
        );
    if (bytes.length > MAX_BODY_BYTES)
      return new Response(JSON.stringify({ error: "Request body too large" }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    parts.push(bytes);
  }
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : new Uint8Array(Buffer.concat(parts));
  return handler(
    new Request(new URL(req.url ?? "/", origin), {
      method,
      headers,
      body,
    }),
  );
}
export async function sendResponse(
  response: Response,
  res: ServerResponse,
  head = false,
) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (head) res.end();
  else res.end(Buffer.from(await response.arrayBuffer()));
}
export async function serveApi(req: IncomingMessage, res: ServerResponse) {
  try {
    await sendResponse(await apiFromNode(req), res, req.method === "HEAD");
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end('{"error":"Request failed"}');
  }
}
