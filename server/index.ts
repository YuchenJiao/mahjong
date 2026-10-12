import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { apiFromNode, sendResponse } from "./http";
import { serveStatic } from "./static";
import { handleApi } from "./api";
import { createRoomsApi } from "./rooms";
import { SqliteRoomStore } from "./store-sqlite";
import { withCors } from "./cors";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const roomStore = new SqliteRoomStore(process.env.ONLINE_DB_PATH ?? ".data/rooms.sqlite");
const roomsApi = createRoomsApi(roomStore);
const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PORT");
export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api" || url.pathname.startsWith("/api/"))
      return void (await sendResponse(await apiFromNode(req,
        request => withCors(request, allowed, r => new URL(r.url).pathname.startsWith("/api/rooms") ? roomsApi(r) : handleApi(r, { onlineRooms: true })),
        `${req.headers["x-forwarded-proto"] === "https" ? "https" : "http"}://${req.headers.host ?? "localhost"}`), res));
    await sendResponse(
      await serveStatic(
        new Request(url, {
          method: req.method ?? "GET",
          headers: { accept: String(req.headers.accept ?? "") },
        }),
        dist,
      ),
      res,
      req.method === "HEAD",
    );
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Server error");
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, "0.0.0.0", () =>
  console.log(`Quiet Mahjong server: http://localhost:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    server.close();
    setTimeout(() => process.exit(0), 5000).unref();
  });
