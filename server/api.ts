import { initCore, fanReference } from "../src/engine/core";
import { advise } from "../src/engine/ai";
import { rules } from "../src/engine/rules";
import { InputError, scoreInput, viewInput, object, styleInput, difficultyInput } from "./validation";

export const MAX_BODY_BYTES = 65536;
let ready: Promise<void> | undefined;
function ensureCore() {
  return (ready ??= initCore());
}
function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
export async function handleApi(request: Request, capabilities: { onlineRooms?: boolean } = {}): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const route = (
    {
      "/api/health": "GET",
      "/api/rules": "GET",
      "/api/score": "POST",
      "/api/analyze": "POST",
    } as Record<string, string>
  )[path];
  if (!route) return json({ error: "API route not found" }, 404);
  if (request.method !== route)
    return json({ error: `Use ${route}` }, 405, { Allow: route });
  if (path === "/api/health")
    return json({
      status: "ok",
      service: "quiet-mahjong",
      version: "2.2.0",
      storage: capabilities.onlineRooms ? "persistent-room-store" : "browser-local",
      persistentServerState: !!capabilities.onlineRooms,
      onlineRooms: !!capabilities.onlineRooms,
    });
  try {
    if (path === "/api/rules") {
      await ensureCore();
      return json({
        modes: Object.values(rules).map((r) => ({
          id: r.id,
          title: r.title,
          tileTypes: r.tiles,
          multiWin: r.multiWin,
          canChow: r.canChow,
        })),
        mcrFans: fanReference(),
      });
    }
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      return json({ error: "Content-Type must be application/json" }, 415);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES)
      return json({ error: "Request body too large" }, 413);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    // Validate before loading/calculating; limits also constrain recursion/input complexity.
    if (path === "/api/score") {
      const input = scoreInput(data);
      await ensureCore();
      return json(
        rules[input.config.mode].score(
          input.player,
          input.config,
          input.context,
        ),
      );
    }
    const view = viewInput(data);
    await ensureCore();
    return json({
      recommendations: advise(view, { style: styleInput(object(data).style), difficulty: object(data).difficulty === undefined ? "advanced" : difficultyInput(object(data).difficulty) }),
      informationPolicy: "own-hand-and-public-information-only",
    });
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, 400);
    return json({ error: "Calculation failed" }, 500);
  }
}
