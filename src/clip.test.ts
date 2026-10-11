import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildCreatomateBody,
  buildShotstackEdit,
  clipStatus,
  parseClipSpec,
  pollStatus,
  renderClip,
  selectVendor,
  totalDuration,
  type ClipSpec,
} from "./clip.js";
import { VendorError, createGuards, getCostReport, resetCosts } from "./core.js";

function spec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Launch teaser",
    aspect: "9:16",
    scenes: [
      {
        image: "https://example.com/frame.png",
        texts: [{ text: "Hello", startSec: 0, lengthSec: 2 }],
        lengthSec: 3,
      },
      { video: "https://example.com/cut.mp4", lengthSec: 4 },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetCosts();
});

describe("parseClipSpec", () => {
  test("accepts a valid spec with defaults", () => {
    const parsed = parseClipSpec(spec());
    expect(parsed.aspect).toBe("9:16");
    expect(parsed.scenes).toHaveLength(2);
    expect(parsed.scenes[1].texts).toEqual([]);
  });

  test("rejects an empty title", () => {
    expect(() => parseClipSpec(spec({ title: "" }))).toThrow("Invalid clip spec");
  });

  test("rejects a scene with no media", () => {
    expect(() =>
      parseClipSpec(spec({ scenes: [{ lengthSec: 2 }] })),
    ).toThrow("Scene needs an image, video, or text");
  });

  test("rejects a bad url", () => {
    expect(() =>
      parseClipSpec(spec({ scenes: [{ image: "nope", lengthSec: 2 }] })),
    ).toThrow("Invalid clip spec");
  });

  test("rejects a run over the cap", () => {
    expect(() => parseClipSpec(spec({ durationSecCap: 5 }))).toThrow("over the 5s cap");
  });
});

describe("totalDuration", () => {
  test("sums scene lengths", () => {
    expect(totalDuration(parseClipSpec(spec()))).toBe(7);
  });
});

describe("buildShotstackEdit", () => {
  test("maps scenes to tracks with offsets", () => {
    const edit = buildShotstackEdit(parseClipSpec(spec()));
    expect(edit.output).toEqual({ format: "mp4", resolution: "hd", aspectRatio: "9:16" });
    expect(edit.timeline.tracks).toHaveLength(3);
    expect(edit.timeline.tracks[0].clips[0]).toMatchObject({
      asset: { type: "image", src: "https://example.com/frame.png" },
      start: 0,
      length: 3,
    });
    expect(edit.timeline.tracks[1].clips[0]).toMatchObject({
      asset: { type: "video", src: "https://example.com/cut.mp4" },
      start: 3,
      length: 4,
    });
    expect(edit.timeline.tracks[2].clips[0]).toMatchObject({
      asset: { type: "text", text: "Hello" },
      start: 0,
      length: 2,
    });
  });

  test("adds a soundtrack when audio is set", () => {
    const edit = buildShotstackEdit(
      parseClipSpec(spec({ audioUrl: "https://example.com/bed.mp3" })),
    );
    expect(edit.timeline.soundtrack).toEqual({
      src: "https://example.com/bed.mp3",
      effect: "fadeInOut",
    });
  });
});

describe("buildCreatomateBody", () => {
  test("maps scenes to modifications", () => {
    const body = buildCreatomateBody(parseClipSpec(spec()), "tpl-1");
    expect(body).toEqual({
      template_id: "tpl-1",
      modifications: { title: "Launch teaser", "scene-1": "Hello", "scene-2": "" },
    });
  });

  test("rejects an empty template id", () => {
    expect(() => buildCreatomateBody(parseClipSpec(spec()), "  ")).toThrow(
      "templateId must be nonempty",
    );
  });
});

describe("pollStatus", () => {
  test("returns the first wanted result", async () => {
    let n = 0;
    const slept: number[] = [];
    const result = await pollStatus(
      () => {
        n += 1;
        return Promise.resolve(n < 3 ? "working" : "ready");
      },
      (found) => found === "ready",
      { intervalMs: 5, timeoutMs: 1000, sleepFn: (ms) => { slept.push(ms); return Promise.resolve(); } },
    );
    expect(result).toBe("ready");
    expect(n).toBe(3);
    expect(slept).toEqual([5, 5]);
  });

  test("throws on timeout", async () => {
    await expect(
      pollStatus(() => Promise.resolve("working"), (found) => found === "ready", {
        intervalMs: 10,
        timeoutMs: 25,
        sleepFn: () => Promise.resolve(),
      }),
    ).rejects.toThrow("polling timed out");
  });
});

describe("selectVendor", () => {
  test("explicit vendor wins", () => {
    expect(selectVendor({ vendor: "creatomate" })).toBe("creatomate");
  });

  test("remotion config wins auto", () => {
    expect(
      selectVendor({ remotion: { composition: "C", outputLocation: "o.mp4" } }),
    ).toBe("remotion");
  });

  test("env keys pick the vendor in order", () => {
    vi.stubEnv("SHOTSTACK_API_KEY", "s");
    vi.stubEnv("CREATOMATE_API_KEY", "c");
    expect(selectVendor({})).toBe("shotstack");
    vi.stubEnv("SHOTSTACK_API_KEY", "");
    expect(selectVendor({})).toBe("creatomate");
  });

  test("passed keys count without env", () => {
    expect(selectVendor({ shotstack: { apiKey: "s" } })).toBe("shotstack");
  });

  test("throws with no vendor", () => {
    expect(() => selectVendor({})).toThrow("No vendor configured");
  });
});

describe("renderClip", () => {
  test("dry run is the default and makes no fetch calls", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const preview = await renderClip(spec(), {
      vendor: "shotstack",
      fetchFn,
      shotstack: { apiKey: "s" },
    });
    expect(preview.dryRun).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
    if (preview.dryRun) {
      expect(preview.vendor).toBe("shotstack");
      expect(preview.spec).toMatchObject({ scenes: 2, durationSec: 7 });
      expect(preview.edit).toHaveProperty("timeline");
    }
  });

  test("live shotstack submits and polls to done", async () => {
    const seen: string[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (url) => {
      seen.push(String(url));
      if (seen.length === 1) return jsonResponse({ success: true, response: { id: "r-1" } });
      if (seen.length === 2) return jsonResponse({ response: { status: "rendering" } });
      return jsonResponse({ response: { status: "done", url: "https://cdn.example/r.mp4" } });
    });
    const receipt = await renderClip(spec(), {
      vendor: "shotstack",
      dryRun: false,
      fetchFn,
      shotstack: { apiKey: "s" },
      poll: { intervalMs: 1, sleepFn: () => Promise.resolve() },
    });
    expect(receipt).toEqual({
      dryRun: false,
      vendor: "shotstack",
      id: "r-1",
      url: "https://cdn.example/r.mp4",
    });
    expect(seen[0]).toBe("https://api.shotstack.io/edit/v1/render");
    const report = getCostReport();
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({ kind: "render", adapter: "shotstack", units: 7 });
    expect(report.units).toBe(7);
  });

  test("live creatomate needs a template id", async () => {
    await expect(
      renderClip(spec(), { vendor: "creatomate", dryRun: false }),
    ).rejects.toThrow("needs a templateId");
  });

  test("live remotion uses injected fns", async () => {
    const receipt = await renderClip(spec(), {
      vendor: "remotion",
      dryRun: false,
      remotion: { entryPoint: "/src/video.ts", composition: "Main", outputLocation: "/tmp/out.mp4" },
      remotionFns: {
        bundleFn: () => Promise.resolve("/tmp/bundle"),
        selectFn: () => Promise.resolve({ id: "Main" } as never),
        renderFn: () => Promise.resolve({} as never),
      },
    });
    expect(receipt).toEqual({
      dryRun: false,
      vendor: "remotion",
      id: "/tmp/out.mp4",
      file: "/tmp/out.mp4",
    });
  });

  test("remotion without config throws", async () => {
    await expect(renderClip(spec(), { vendor: "remotion" })).rejects.toThrow(
      "needs a remotion config",
    );
  });

  test("guards run and cost is skipped on dry run", async () => {
    const guards = createGuards({ caps: { maxDispatches: 0 } });
    await expect(
      renderClip(spec(), { vendor: "shotstack", guards, shotstack: { apiKey: "s" } }),
    ).rejects.toThrow();
    expect(getCostReport().dispatches).toBe(0);
  });

  test("vendor failure surfaces as VendorError", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: "bad key" }, 401),
    );
    await expect(
      renderClip(spec(), {
        vendor: "shotstack",
        dryRun: false,
        fetchFn,
        shotstack: { apiKey: "bad" },
      }),
    ).rejects.toBeInstanceOf(VendorError);
  });
});

describe("clipStatus", () => {
  test("remotion is done at once", async () => {
    await expect(clipStatus("remotion", "/tmp/out.mp4")).resolves.toEqual({
      vendor: "remotion",
      id: "/tmp/out.mp4",
      status: "done",
    });
  });

  test("shotstack reads status", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse({ response: { status: "rendering" } }),
    );
    await expect(
      clipStatus("shotstack", "r-1", { fetchFn, shotstack: { apiKey: "s" } }),
    ).resolves.toEqual({ vendor: "shotstack", id: "r-1", status: "rendering" });
  });
});
