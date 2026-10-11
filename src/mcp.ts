import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  clipStatus,
  parseClipSpec,
  renderClip,
  type ClipVendor,
  type RenderClipOptions,
} from "./clip.js";
import {
  createLogger,
  getCostReport,
  GuardError,
  VendorError,
  type Guards,
  type Logger,
} from "./core.js";
import { DEFAULT_BRAND } from "./index.js";
import { uploadToR2, uploadToStream } from "./storage.js";

export interface McpDeps {
  guards?: Guards;
  logger?: Logger;
  renderFn?: (spec: unknown, opts: RenderClipOptions) => Promise<unknown>;
  statusFn?: (vendor: ClipVendor, id: string) => Promise<unknown>;
  uploadR2Fn?: (bytes: Uint8Array, key: string) => Promise<unknown>;
  uploadStreamFn?: (bytes: Uint8Array, filename: string) => Promise<unknown>;
}

const remotionShape = z
  .object({
    serveUrl: z.string().optional(),
    entryPoint: z.string().optional(),
    composition: z.string(),
    outputLocation: z.string(),
    inputProps: z.record(z.unknown()).optional(),
  })
  .optional()
  .describe("Remotion config. Needs serveUrl or entryPoint plus composition and outputLocation.");

function errorResult(error: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

function okResult(value: unknown): {
  content: { type: "text"; text: string }[];
} {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function createMcpServer(deps: McpDeps = {}): McpServer {
  const guards = deps.guards;
  const logger = deps.logger ?? createLogger({ quiet: true });
  const renderOne =
    deps.renderFn ?? ((spec, opts) => renderClip(spec, { ...opts, guards, logger }));
  const statusOne =
    deps.statusFn ?? ((vendor, id) => clipStatus(vendor, id));
  const uploadR2 =
    deps.uploadR2Fn ??
    ((bytes, key) => uploadToR2({ bytes, bucket: process.env.R2_BUCKET ?? "clips", key }));
  const uploadStream =
    deps.uploadStreamFn ?? ((bytes, filename) => uploadToStream({ bytes, filename }));
  const server = new McpServer({
    name: DEFAULT_BRAND.command,
    version: DEFAULT_BRAND.version,
  });

  server.registerTool(
    "render_clip",
    {
      description: "Render one short clip with Remotion, Shotstack, or Creatomate. Dry run is the default.",
      inputSchema: {
        specJson: z.string().describe("The clip spec as a JSON string."),
        vendor: z
          .enum(["auto", "remotion", "shotstack", "creatomate"])
          .optional()
          .describe("Which vendor renders. Defaults to auto."),
        dryRun: z.boolean().optional().describe("Preview only. Defaults to true."),
        templateId: z.string().optional().describe("Creatomate template id."),
        remotion: remotionShape,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ specJson, vendor, dryRun, templateId, remotion }) => {
      try {
        let raw: unknown;
        try {
          raw = JSON.parse(specJson) as unknown;
        } catch {
          return errorResult(new Error("specJson is not valid JSON"));
        }
        return okResult(
          await renderOne(parseClipSpec(raw), {
            vendor: vendor ?? "auto",
            dryRun: dryRun ?? true,
            templateId,
            remotion,
          }),
        );
      } catch (error) {
        if (error instanceof GuardError || error instanceof VendorError) {
          return errorResult(error);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "clip_status",
    {
      description: "Read a live render status by vendor and id.",
      inputSchema: {
        vendor: z.enum(["remotion", "shotstack", "creatomate"]).describe("The vendor."),
        id: z.string().describe("The render id."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ vendor, id }) => {
      try {
        return okResult(await statusOne(vendor, id));
      } catch (error) {
        if (error instanceof VendorError) return errorResult(error);
        throw error;
      }
    },
  );

  server.registerTool(
    "upload_clip",
    {
      description: "Store a finished clip file in R2 or Cloudflare Stream.",
      inputSchema: {
        filePath: z.string().describe("Local path of the finished file."),
        to: z.enum(["r2", "stream"]).describe("Where the file goes."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ filePath, to }) => {
      try {
        const bytes = new Uint8Array(readFileSync(filePath));
        const name = basename(filePath);
        return okResult(
          to === "r2" ? await uploadR2(bytes, name) : await uploadStream(bytes, name),
        );
      } catch (error) {
        if (error instanceof VendorError) return errorResult(error);
        throw error;
      }
    },
  );

  server.registerTool(
    "get_cost_report",
    {
      description: "Read the cost report for this session.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => okResult(getCostReport()),
  );

  return server;
}

export async function startMcp(deps: McpDeps = {}): Promise<void> {
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
