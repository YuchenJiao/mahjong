import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};
const within = (root: string, p: string) =>
  p === root || p.startsWith(root + sep);
export async function serveStatic(
  request: Request,
  dist: string,
): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method))
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  let path: string;
  try {
    path = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response("Bad URL", { status: 400 });
  }
  if (path.includes("\0") || path.includes("\\"))
    return new Response("Bad path", { status: 400 });
  if (path.startsWith("/api/"))
    return new Response("API not found", { status: 404 });
  const root = resolve(dist);
  let file = resolve(root, "." + (path === "/" ? "/index.html" : path));
  if (!within(root, file)) return new Response("Forbidden", { status: 403 });
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("Not a file");
  } catch {
    if (request.headers.get("accept")?.includes("text/html") && !extname(path))
      file = resolve(root, "index.html");
    else
      return new Response("File not found. Run npm run build first.", {
        status: 404,
      });
  }
  try {
    if (!within(await realpath(root), await realpath(file)))
      return new Response("Forbidden", { status: 403 });
    const bytes = await readFile(file);
    return new Response(
      request.method === "HEAD" ? null : new Uint8Array(bytes),
      {
        headers: {
          "Content-Type": mime[extname(file)] ?? "application/octet-stream",
          "Content-Length": String(bytes.length),
          "Cache-Control": file.endsWith("index.html")
            ? "no-cache"
            : path.startsWith("/assets/")
              ? "public, max-age=31536000, immutable"
              : "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return new Response("File not found. Run npm run build first.", {
      status: 404,
    });
  }
}
