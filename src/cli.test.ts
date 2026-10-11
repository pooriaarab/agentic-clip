import { describe, expect, test, vi } from "vitest";
import { parseArgs, runCli, type CliIo } from "./cli.js";

const SPEC = JSON.stringify({
  title: "Teaser",
  scenes: [{ image: "https://example.com/f.png", lengthSec: 2 }],
});

function makeIo(overrides: Partial<CliIo> = {}): CliIo & { outLines: string[]; errLines: string[] } {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    outLines,
    errLines,
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
    readText: () => SPEC,
    readBytes: () => new Uint8Array([1, 2]),
    runRender: () =>
      Promise.resolve({
        dryRun: true as const,
        vendor: "shotstack" as const,
        spec: { title: "Teaser", aspect: "9:16", scenes: 1, durationSec: 2 },
        edit: {},
      }),
    runStatus: (vendor, id) => Promise.resolve({ vendor, id, status: "done" }),
    runUploadR2: () => Promise.resolve({ url: "r2://clips/f.mp4" }),
    runUploadStream: () => Promise.resolve({ uid: "uid-1" }),
    ...overrides,
  };
}

describe("parseArgs", () => {
  test("help is the default", () => {
    expect(parseArgs([]).command).toBe("help");
    expect(parseArgs(["--help"]).command).toBe("help");
  });

  test("version flag", () => {
    expect(parseArgs(["--version"]).command).toBe("version");
  });

  test("unknown command throws", () => {
    expect(() => parseArgs(["frobnicate"])).toThrow('unknown command "frobnicate"');
  });

  test("render parses flags", () => {
    const request = parseArgs([
      "render",
      "--spec",
      SPEC,
      "--vendor",
      "shotstack",
      "--live",
      "--store",
      "r2",
      "--template-id",
      "t-1",
    ]);
    expect(request).toMatchObject({
      command: "render",
      specText: SPEC,
      vendor: "shotstack",
      live: true,
      store: "r2",
      templateId: "t-1",
    });
  });

  test("render needs a spec", () => {
    expect(() => parseArgs(["render", "--live"])).toThrow("render needs --spec or --spec-file");
  });

  test("render rejects a bad vendor", () => {
    expect(() => parseArgs(["render", "--spec", SPEC, "--vendor", "nope"])).toThrow(
      "--vendor takes",
    );
  });

  test("store needs live", () => {
    expect(() => parseArgs(["render", "--spec", SPEC, "--store", "r2"])).toThrow(
      "--store needs --live",
    );
  });

  test("remotion flags parse", () => {
    const request = parseArgs([
      "render",
      "--spec",
      SPEC,
      "--serve-url",
      "https://static.example/b",
      "--composition",
      "Main",
      "--out",
      "/tmp/o.mp4",
    ]);
    expect(request).toMatchObject({
      serveUrl: "https://static.example/b",
      composition: "Main",
      out: "/tmp/o.mp4",
    });
  });

  test("status needs vendor and id", () => {
    expect(() => parseArgs(["status", "--id", "x"])).toThrow("status needs --vendor");
    expect(() => parseArgs(["status", "--vendor", "shotstack"])).toThrow("status needs --id");
  });

  test("upload needs file and target", () => {
    expect(() => parseArgs(["upload", "--to", "r2"])).toThrow("upload needs --file");
    expect(() => parseArgs(["upload", "--file", "f"])).toThrow("upload needs --to");
    expect(() => parseArgs(["upload", "--file", "f", "--to", "nope"])).toThrow("--to takes");
  });

  test("unknown flag throws", () => {
    expect(() => parseArgs(["costs", "--bogus"])).toThrow('unknown flag "--bogus"');
  });
});

describe("runCli", () => {
  test("help prints usage", async () => {
    const io = makeIo();
    expect(await runCli([], io)).toBe(0);
    expect(io.outLines.join("\n")).toContain("Usage: agentic-clip");
  });

  test("unknown command exits 2", async () => {
    const io = makeIo();
    expect(await runCli(["nope"], io)).toBe(2);
    expect(io.errLines[0]).toContain("unknown command");
  });

  test("render dry run prints the preview", async () => {
    const runRender = vi.fn(makeIo().runRender);
    const io = makeIo({ runRender });
    expect(await runCli(["render", "--spec", SPEC], io)).toBe(0);
    expect(runRender).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Teaser" }),
      expect.objectContaining({ dryRun: true, vendor: "auto" }),
    );
    expect(JSON.parse(io.outLines[0]).dryRun).toBe(true);
  });

  test("render reads the spec file", async () => {
    const readText = vi.fn(() => SPEC);
    const io = makeIo({ readText });
    expect(await runCli(["render", "--spec-file", "clip.json"], io)).toBe(0);
    expect(readText).toHaveBeenCalledWith("clip.json");
  });

  test("render rejects invalid JSON", async () => {
    const io = makeIo();
    expect(await runCli(["render", "--spec", "{oops"], io)).toBe(1);
    expect(io.errLines[0]).toContain("not valid JSON");
  });

  test("render passes remotion config through", async () => {
    const runRender = vi.fn(makeIo().runRender);
    const io = makeIo({ runRender });
    await runCli(
      ["render", "--spec", SPEC, "--composition", "Main", "--out", "/tmp/o.mp4", "--live"],
      io,
    );
    expect(runRender).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dryRun: false,
        remotion: expect.objectContaining({ composition: "Main", outputLocation: "/tmp/o.mp4" }),
      }),
    );
  });

  test("render with store uploads the file", async () => {
    const runRender = vi.fn(() =>
      Promise.resolve({
        dryRun: false as const,
        vendor: "remotion" as const,
        id: "/tmp/o.mp4",
        file: "/tmp/o.mp4",
      }),
    );
    const runUploadR2 = vi.fn(() => Promise.resolve({ url: "r2://clips/o.mp4" }));
    const io = makeIo({ runRender, runUploadR2 });
    expect(
      await runCli(["render", "--spec", SPEC, "--live", "--store", "r2"], io),
    ).toBe(0);
    expect(runUploadR2).toHaveBeenCalledWith(expect.any(Uint8Array), "o.mp4");
    expect(JSON.parse(io.outLines[0]).stored).toEqual({ url: "r2://clips/o.mp4" });
  });

  test("status prints the result", async () => {
    const io = makeIo();
    expect(await runCli(["status", "--vendor", "shotstack", "--id", "r-1"], io)).toBe(0);
    expect(JSON.parse(io.outLines[0])).toEqual({
      vendor: "shotstack",
      id: "r-1",
      status: "done",
    });
  });

  test("upload routes by target", async () => {
    const io = makeIo();
    expect(await runCli(["upload", "--file", "/tmp/a.mp4", "--to", "stream"], io)).toBe(0);
    expect(JSON.parse(io.outLines[0])).toEqual({ uid: "uid-1" });
  });

  test("costs prints a report", async () => {
    const io = makeIo();
    expect(await runCli(["costs"], io)).toBe(0);
    expect(JSON.parse(io.outLines[0])).toHaveProperty("entries");
  });

  test("vendor errors exit 1", async () => {
    const io = makeIo({
      runStatus: () => Promise.reject(new Error("boom")),
    });
    const { VendorError } = await import("./core.js");
    const io2 = makeIo({
      runStatus: () => Promise.reject(new VendorError("down", { status: 500 })),
    });
    expect(await runCli(["status", "--vendor", "shotstack", "--id", "r"], io2)).toBe(1);
    expect(io2.errLines[0]).toContain("VendorError: down");
    await expect(runCli(["status", "--vendor", "shotstack", "--id", "r"], io)).rejects.toThrow(
      "boom",
    );
  });
});
