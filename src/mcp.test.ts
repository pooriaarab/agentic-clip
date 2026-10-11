import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createMcpServer, type McpDeps } from "./mcp.js";

const SPEC = JSON.stringify({
  title: "Teaser",
  scenes: [{ image: "https://example.com/f.png", lengthSec: 2 }],
});

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content[0].text;
}

async function linked(deps: McpDeps = {}): Promise<{ client: Client; stop: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(deps);
  await server.connect(serverTransport);
  const client = new Client({ name: "probe", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    stop: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("mcp server", () => {
  test("serves four tools over a client link", async () => {
    const { client, stop } = await linked();
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "clip_status",
        "get_cost_report",
        "render_clip",
        "upload_clip",
      ]);
    } finally {
      await stop();
    }
  });

  test("render_clip previews by default with no network", async () => {
    const { client, stop } = await linked();
    try {
      const preview = await client.callTool({
        name: "render_clip",
        arguments: { specJson: SPEC, vendor: "shotstack" },
      });
      expect(JSON.parse(textOf(preview))).toMatchObject({
        dryRun: true,
        vendor: "shotstack",
        spec: { title: "Teaser", scenes: 1, durationSec: 2 },
      });
    } finally {
      await stop();
    }
  });

  test("render_clip rejects bad JSON as a tool error", async () => {
    const { client, stop } = await linked();
    try {
      const result = await client.callTool({
        name: "render_clip",
        arguments: { specJson: "{oops" },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(textOf(result)).toContain("not valid JSON");
    } finally {
      await stop();
    }
  });

  test("render_clip honors injected deps", async () => {
    const { client, stop } = await linked({
      renderFn: () => Promise.resolve({ dryRun: false, vendor: "shotstack", id: "r-9" }),
    });
    try {
      const result = await client.callTool({
        name: "render_clip",
        arguments: { specJson: SPEC, dryRun: false },
      });
      expect(JSON.parse(textOf(result))).toEqual({
        dryRun: false,
        vendor: "shotstack",
        id: "r-9",
      });
    } finally {
      await stop();
    }
  });

  test("a blocklisted title returns a tool error", async () => {
    const { createGuards } = await import("./core.js");
    const { client, stop } = await linked({
      guards: createGuards({ blocklist: ["Teaser"] }),
    });
    try {
      const result = await client.callTool({
        name: "render_clip",
        arguments: { specJson: SPEC },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(textOf(result)).toContain("blocklisted");
    } finally {
      await stop();
    }
  });

  test("clip_status and upload_clip use injected deps", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-mcp-"));
    const file = join(dir, "a.mp4");
    writeFileSync(file, new Uint8Array([1, 2, 3]));
    const { client, stop } = await linked({
      statusFn: (vendor, id) => Promise.resolve({ vendor, id, status: "rendering" }),
      uploadStreamFn: () => Promise.resolve({ uid: "uid-7" }),
    });
    try {
      const status = await client.callTool({
        name: "clip_status",
        arguments: { vendor: "shotstack", id: "r-1" },
      });
      expect(JSON.parse(textOf(status))).toMatchObject({ status: "rendering" });
      const upload = await client.callTool({
        name: "upload_clip",
        arguments: { filePath: file, to: "stream" },
      });
      expect(JSON.parse(textOf(upload))).toEqual({ uid: "uid-7" });
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("get_cost_report returns a report", async () => {
    const { client, stop } = await linked();
    try {
      const report = await client.callTool({ name: "get_cost_report", arguments: {} });
      expect(JSON.parse(textOf(report))).toHaveProperty("entries");
    } finally {
      await stop();
    }
  });
});
