#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  clipStatus,
  parseClipSpec,
  renderClip,
  type ClipVendor,
  type DryRunPreview,
  type LiveReceipt,
  type RenderClipOptions,
} from "./clip.js";
import { getCostReport, GuardError, VendorError } from "./core.js";
import { DEFAULT_BRAND } from "./index.js";
import { uploadToR2, uploadToStream } from "./storage.js";
import { VERSION } from "./version.js";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type CliCommand = "render" | "status" | "upload" | "costs" | "mcp" | "help" | "version";

export interface CliRequest {
  command: CliCommand;
  specText?: string;
  specFile?: string;
  vendor?: ClipVendor | "auto";
  live: boolean;
  store?: "r2" | "stream" | "none";
  templateId?: string;
  serveUrl?: string;
  entryPoint?: string;
  composition?: string;
  out?: string;
  id?: string;
  file?: string;
  to?: "r2" | "stream";
}

const VENDORS: (ClipVendor | "auto")[] = ["auto", "remotion", "shotstack", "creatomate"];

function takeValue(args: string[], flag: string): string {
  const value = args.shift();
  if (value === undefined || value === "") {
    throw new UsageError(`${flag} needs a value`);
  }
  return value;
}

export function parseArgs(argv: string[]): CliRequest {
  const request: CliRequest = { command: "help", live: false };
  const args = [...argv];
  const first = args.shift();
  if (first === undefined || first === "--help" || first === "-h") return request;
  if (first === "--version" || first === "-V") {
    request.command = "version";
    return request;
  }
  if (
    first !== "render" &&
    first !== "status" &&
    first !== "upload" &&
    first !== "costs" &&
    first !== "mcp"
  ) {
    throw new UsageError(`unknown command "${first}"`);
  }
  request.command = first;
  while (args.length > 0) {
    const flag = args.shift() as string;
    if (flag === "--live" && request.command === "render") {
      request.live = true;
      continue;
    }
    if (flag === "--dry-run" && request.command === "render") {
      request.live = false;
      continue;
    }
    if (flag === "--spec" && request.command === "render") {
      request.specText = takeValue(args, flag);
      continue;
    }
    if (flag === "--spec-file" && request.command === "render") {
      request.specFile = takeValue(args, flag);
      continue;
    }
    if (flag === "--vendor" && (request.command === "render" || request.command === "status")) {
      const vendor = takeValue(args, flag);
      if (!(VENDORS as string[]).includes(vendor)) {
        throw new UsageError(`--vendor takes ${VENDORS.join("|")}, got "${vendor}"`);
      }
      request.vendor = vendor as ClipVendor | "auto";
      continue;
    }
    if (flag === "--store" && request.command === "render") {
      const store = takeValue(args, flag);
      if (store !== "r2" && store !== "stream" && store !== "none") {
        throw new UsageError(`--store takes r2|stream|none, got "${store}"`);
      }
      request.store = store;
      continue;
    }
    if (flag === "--template-id" && request.command === "render") {
      request.templateId = takeValue(args, flag);
      continue;
    }
    if (flag === "--serve-url" && request.command === "render") {
      request.serveUrl = takeValue(args, flag);
      continue;
    }
    if (flag === "--entry-point" && request.command === "render") {
      request.entryPoint = takeValue(args, flag);
      continue;
    }
    if (flag === "--composition" && request.command === "render") {
      request.composition = takeValue(args, flag);
      continue;
    }
    if (flag === "--out" && request.command === "render") {
      request.out = takeValue(args, flag);
      continue;
    }
    if (flag === "--id" && request.command === "status") {
      request.id = takeValue(args, flag);
      continue;
    }
    if (flag === "--file" && request.command === "upload") {
      request.file = takeValue(args, flag);
      continue;
    }
    if (flag === "--to" && request.command === "upload") {
      const to = takeValue(args, flag);
      if (to !== "r2" && to !== "stream") {
        throw new UsageError(`--to takes r2|stream, got "${to}"`);
      }
      request.to = to;
      continue;
    }
    throw new UsageError(`unknown flag "${flag}" for "${request.command}"`);
  }
  if (request.command === "render") {
    if (request.specText === undefined && request.specFile === undefined) {
      throw new UsageError("render needs --spec or --spec-file");
    }
    if (request.store === undefined) request.store = "none";
    if (!request.live && request.store !== "none") {
      throw new UsageError("--store needs --live (dry run renders no file)");
    }
  }
  if (request.command === "status") {
    if (request.vendor === undefined || request.vendor === "auto") {
      throw new UsageError("status needs --vendor remotion|shotstack|creatomate");
    }
    if (request.id === undefined) throw new UsageError("status needs --id");
  }
  if (request.command === "upload") {
    if (request.file === undefined) throw new UsageError("upload needs --file");
    if (request.to === undefined) throw new UsageError("upload needs --to r2|stream");
  }
  return request;
}

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  readText(path: string): string;
  readBytes(path: string): Uint8Array;
  runRender(spec: unknown, opts: RenderClipOptions): Promise<DryRunPreview | LiveReceipt>;
  runStatus(vendor: ClipVendor, id: string): Promise<unknown>;
  runUploadR2(bytes: Uint8Array, key: string): Promise<unknown>;
  runUploadStream(bytes: Uint8Array, filename: string): Promise<unknown>;
}

function defaultIo(): CliIo {
  return {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    readText: (path) => readFileSync(path, "utf8"),
    readBytes: (path) => new Uint8Array(readFileSync(path)),
    runRender: (spec, opts) => renderClip(spec, opts),
    runStatus: (vendor, id) => clipStatus(vendor, id),
    runUploadR2: (bytes, key) =>
      uploadToR2({ bytes, bucket: process.env.R2_BUCKET ?? "clips", key }),
    runUploadStream: (bytes, filename) => uploadToStream({ bytes, filename }),
  };
}

function helpText(): string {
  const command = DEFAULT_BRAND.command;
  return [
    `${DEFAULT_BRAND.name} ${VERSION}`,
    `${DEFAULT_BRAND.description}`,
    "",
    `Usage: ${command} <command> [flags]`,
    "",
    "Commands:",
    "  render --spec <json> | --spec-file <p> [--vendor auto|remotion|shotstack|creatomate] [--live] [--store r2|stream|none] [--template-id <id>] [--serve-url <u> | --entry-point <p>] [--composition <id>] [--out <p>]",
    "    Render one clip. Dry run is the default; pass --live to spend.",
    "  status --vendor <v> --id <id>   Read a live render status.",
    "  upload --file <p> --to r2|stream  Store a finished file.",
    "  costs                          Print the cost report as JSON.",
    "  mcp                            Start the MCP server on stdio.",
    "",
    "Flags:",
    "  --help, -h       Print this help.",
    "  --version, -V    Print the version.",
  ].join("\n");
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export async function runCli(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  let request: CliRequest;
  try {
    request = parseArgs(argv);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    io.err(`Run "${DEFAULT_BRAND.command} --help" for usage.`);
    return 2;
  }
  try {
    switch (request.command) {
      case "help":
        io.out(helpText());
        return 0;
      case "version":
        io.out(VERSION);
        return 0;
      case "render": {
        const raw =
          request.specFile !== undefined ? io.readText(request.specFile) : (request.specText as string);
        let spec: unknown;
        try {
          spec = JSON.parse(raw) as unknown;
        } catch {
          throw new UsageError("spec is not valid JSON");
        }
        const parsed = parseClipSpec(spec);
        const remotion =
          request.serveUrl !== undefined ||
          request.entryPoint !== undefined ||
          request.composition !== undefined ||
          request.out !== undefined
            ? {
                serveUrl: request.serveUrl,
                entryPoint: request.entryPoint,
                composition: request.composition ?? "",
                outputLocation: request.out ?? "",
                inputProps: { title: parsed.title },
              }
            : undefined;
        const result = await io.runRender(parsed, {
          vendor: request.vendor ?? "auto",
          dryRun: !request.live,
          templateId: request.templateId,
          remotion,
        });
        if (!result.dryRun && request.store !== "none" && result.file) {
          const bytes = io.readBytes(result.file);
          const stored =
            request.store === "r2"
              ? await io.runUploadR2(bytes, basename(result.file))
              : await io.runUploadStream(bytes, basename(result.file));
          io.out(JSON.stringify({ ...result, stored }));
          return 0;
        }
        io.out(JSON.stringify(result));
        return 0;
      }
      case "status": {
        const result = await io.runStatus(request.vendor as ClipVendor, request.id as string);
        io.out(JSON.stringify(result));
        return 0;
      }
      case "upload": {
        const bytes = io.readBytes(request.file as string);
        const name = basename(request.file as string);
        const result =
          request.to === "r2"
            ? await io.runUploadR2(bytes, name)
            : await io.runUploadStream(bytes, name);
        io.out(JSON.stringify(result));
        return 0;
      }
      case "costs":
        io.out(JSON.stringify(getCostReport()));
        return 0;
      case "mcp": {
        const { startMcp } = await import("./mcp.js");
        await startMcp();
        return 0;
      }
    }
  } catch (error) {
    if (error instanceof GuardError || error instanceof VendorError || error instanceof UsageError) {
      io.err(`${error.name}: ${error.message}`);
      return 1;
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      io.err(`file not found: ${request.file ?? request.specFile ?? ""}`);
      return 1;
    }
    throw error;
  }
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (typeof invoked !== "string") return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(invoked)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      if (code !== 0) process.exit(code);
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
