import { afterEach, describe, expect, test, vi } from "vitest";
import { ShotstackAdapter } from "./shotstack.js";
import { CreatomateAdapter } from "./creatomate.js";
import { RemotionAdapter } from "./remotion.js";
import { VendorError } from "../core.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ShotstackAdapter", () => {
  test("submits the edit with the api key header", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
      seenUrl = String(url);
      seenInit = init ?? {};
      return jsonResponse({ success: true, response: { id: "shot-1" } });
    });
    const id = await new ShotstackAdapter({ apiKey: "key-1", fetchFn }).submit({
      timeline: {},
    });
    expect(id).toBe("shot-1");
    expect(seenUrl).toBe("https://api.shotstack.io/edit/v1/render");
    expect(seenInit.method).toBe("POST");
    expect((seenInit.headers as Record<string, string>)["x-api-key"]).toBe("key-1");
    expect(String(seenInit.body)).toContain("timeline");
  });

  test("stage env changes the host path", async () => {
    let seenUrl = "";
    const fetchFn = vi.fn<typeof fetch>(async (url) => {
      seenUrl = String(url);
      return jsonResponse({ success: true, response: { id: "shot-2" } });
    });
    await new ShotstackAdapter({ apiKey: "k", env: "stage", fetchFn }).submit({});
    expect(seenUrl).toBe("https://api.shotstack.io/edit/stage/render");
  });

  test("reads the key from env", async () => {
    vi.stubEnv("SHOTSTACK_API_KEY", "env-key");
    let seenKey = "";
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      seenKey = (init?.headers as Record<string, string>)["x-api-key"];
      return jsonResponse({ success: true, response: { id: "x" } });
    });
    await new ShotstackAdapter({ fetchFn }).submit({});
    expect(seenKey).toBe("env-key");
  });

  test("missing key throws before fetch", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(new ShotstackAdapter({ fetchFn }).submit({})).rejects.toThrow(
      "Missing SHOTSTACK_API_KEY",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("non-2xx throws VendorError with status", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: "nope" }, 403),
    );
    const error = await new ShotstackAdapter({ apiKey: "k", fetchFn })
      .submit({})
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(VendorError);
    expect((error as VendorError).status).toBe(403);
  });

  test("status returns state and url", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse({ response: { status: "done", url: "https://cdn.example/v.mp4" } }),
    );
    await expect(
      new ShotstackAdapter({ apiKey: "k", fetchFn }).status("shot-1"),
    ).resolves.toEqual({ status: "done", url: "https://cdn.example/v.mp4" });
  });

  test("failed status throws", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse({ response: { status: "failed" } }),
    );
    await expect(
      new ShotstackAdapter({ apiKey: "k", fetchFn }).status("shot-1"),
    ).rejects.toThrow("failed");
  });
});

describe("CreatomateAdapter", () => {
  test("submits with a bearer token", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
      seenUrl = String(url);
      seenInit = init ?? {};
      return jsonResponse([{ id: "cr-1", status: "planned" }]);
    });
    const id = await new CreatomateAdapter({ apiKey: "key-1", fetchFn }).submit({
      template_id: "t",
    });
    expect(id).toBe("cr-1");
    expect(seenUrl).toBe("https://api.creatomate.com/v2/renders");
    expect((seenInit.headers as Record<string, string>).authorization).toBe(
      "Bearer key-1",
    );
  });

  test("missing key throws before fetch", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(new CreatomateAdapter({ fetchFn }).submit({})).rejects.toThrow(
      "Missing CREATOMATE_API_KEY",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("status maps succeeded to url", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse([{ id: "cr-1", status: "succeeded", url: "https://cdn.example/c.mp4" }]),
    );
    await expect(
      new CreatomateAdapter({ apiKey: "k", fetchFn }).status("cr-1"),
    ).resolves.toEqual({ status: "succeeded", url: "https://cdn.example/c.mp4" });
  });

  test("status accepts a single object body", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse({ id: "cr-1", status: "rendering" }),
    );
    await expect(
      new CreatomateAdapter({ apiKey: "k", fetchFn }).status("cr-1"),
    ).resolves.toEqual({ status: "rendering" });
  });

  test("failed status throws VendorError", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse([{ id: "cr-1", status: "failed" }]),
    );
    await expect(
      new CreatomateAdapter({ apiKey: "k", fetchFn }).status("cr-1"),
    ).rejects.toBeInstanceOf(VendorError);
  });
});

describe("RemotionAdapter", () => {
  test("validation errors name the missing field", async () => {
    const adapter = new RemotionAdapter();
    await expect(adapter.render({ composition: "", outputLocation: "o" })).rejects.toThrow(
      "serveUrl or entryPoint",
    );
    await expect(
      adapter.render({ serveUrl: "s", composition: " ", outputLocation: "o" }),
    ).rejects.toThrow("composition must be nonempty");
    await expect(
      adapter.render({ serveUrl: "s", composition: "C", outputLocation: " " }),
    ).rejects.toThrow("outputLocation must be nonempty");
  });

  test("injected fns render without chrome", async () => {
    const calls: string[] = [];
    const adapter = new RemotionAdapter({
      bundleFn: (options) => {
        calls.push(`bundle:${options.entryPoint}`);
        return Promise.resolve("/tmp/bundle");
      },
      selectFn: (options) => {
        calls.push(`select:${options.serveUrl}:${options.id}`);
        return Promise.resolve({ id: options.id } as never);
      },
      renderFn: (options) => {
        calls.push(`render:${options.outputLocation}:${options.codec}`);
        return Promise.resolve({} as never);
      },
    });
    const receipt = await adapter.render({
      entryPoint: "/src/video.ts",
      composition: "Main",
      outputLocation: "/tmp/out.mp4",
    });
    expect(receipt).toEqual({ file: "/tmp/out.mp4" });
    expect(calls).toEqual([
      "bundle:/src/video.ts",
      "select:/tmp/bundle:Main",
      "render:/tmp/out.mp4:h264",
    ]);
  });

  test("uses serveUrl directly when given", async () => {
    const adapter = new RemotionAdapter({
      bundleFn: () => Promise.reject(new Error("must not bundle")),
      selectFn: () => Promise.resolve({} as never),
      renderFn: () => Promise.resolve({} as never),
    });
    await expect(
      adapter.render({ serveUrl: "https://static.example/bundle", composition: "C", outputLocation: "o.mp4" }),
    ).resolves.toEqual({ file: "o.mp4" });
  });

  test("render failure maps to VendorError with cause", async () => {
    const adapter = new RemotionAdapter({
      selectFn: () => Promise.reject(new Error("no chrome")),
    });
    const error = await adapter
      .render({ serveUrl: "s", composition: "C", outputLocation: "o.mp4" })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(VendorError);
    expect((error as Error).message).toContain("no chrome");
  });
});
