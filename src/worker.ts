import { renderClip } from "./clip.js";
import { VERSION } from "./version.js";

export interface WorkerEnv {
  PACK_NAME?: string;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, pack: env.PACK_NAME ?? "agentic-clip", version: VERSION });
    }
    if (request.method === "POST" && url.pathname === "/render") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "body must be JSON" }, 400);
      }
      if (typeof body !== "object" || body === null || !("spec" in body)) {
        return json({ error: "body needs a spec object" }, 400);
      }
      const { spec, vendor, templateId } = body as {
        spec: unknown;
        vendor?: "auto" | "remotion" | "shotstack" | "creatomate";
        templateId?: string;
      };
      try {
        // The worker previews only. It never spends on a live render.
        return json(await renderClip(spec, { vendor, templateId, dryRun: true }));
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : String(error) },
          400,
        );
      }
    }
    return json({ error: "not found" }, 404);
  },
};
