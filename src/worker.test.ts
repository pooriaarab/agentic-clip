import { describe, expect, test } from "vitest";
import worker from "./worker.js";

const SPEC = {
  title: "Teaser",
  scenes: [{ image: "https://example.com/f.png", lengthSec: 2 }],
};

function post(path: string, body: unknown): Request {
  return new Request(`https://pack.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("worker", () => {
  test("GET /health reports ok", async () => {
    const response = await worker.fetch(new Request("https://pack.test/health"), {
      PACK_NAME: "probe",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, pack: "probe" });
  });

  test("POST /render previews a clip", async () => {
    const response = await worker.fetch(
      post("/render", { spec: SPEC, vendor: "creatomate", templateId: "t-1" }),
      {},
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      dryRun: true,
      vendor: "creatomate",
      spec: { title: "Teaser", durationSec: 2 },
    });
  });

  test("POST /render rejects a missing spec", async () => {
    const response = await worker.fetch(post("/render", { vendor: "shotstack" }), {});
    expect(response.status).toBe(400);
  });

  test("POST /render rejects a bad spec", async () => {
    const response = await worker.fetch(
      post("/render", { spec: { title: "", scenes: [] } }),
      {},
    );
    expect(response.status).toBe(400);
  });

  test("POST /render rejects a non-JSON body", async () => {
    const response = await worker.fetch(post("/render", "{oops"), {});
    expect(response.status).toBe(400);
  });

  test("unknown routes return 404", async () => {
    const response = await worker.fetch(new Request("https://pack.test/nowhere"), {});
    expect(response.status).toBe(404);
  });
});
