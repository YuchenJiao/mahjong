export async function withCors(request: Request, allowed: string[], handler: (r: Request) => Promise<Response>) {
  const origin = request.headers.get("origin"), own = new URL(request.url).origin;
  const permitted = !origin || origin === own || allowed.includes(origin);
  if (!permitted) return new Response(JSON.stringify({ error: "Origin not allowed" }), { status: 403, headers: { "Content-Type": "application/json" } });
  const r = request.method === "OPTIONS" ? new Response(null, { status: 204 }) : await handler(request);
  if (origin) {
    r.headers.set("Access-Control-Allow-Origin", origin);
    r.headers.set("Vary", "Origin");
    r.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    r.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  return r;
}
