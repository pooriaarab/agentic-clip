import { z } from "zod";
import { VendorError, recordCost, type Guards, type Logger } from "./core.js";
import { ShotstackAdapter } from "./vendors/shotstack.js";
import { CreatomateAdapter } from "./vendors/creatomate.js";
import {
  RemotionAdapter,
  type RemotionConfig,
  type RemotionFunctions,
} from "./vendors/remotion.js";

export const ClipTextSchema = z.object({
  text: z.string().min(1).max(280),
  startSec: z.number().min(0).default(0),
  lengthSec: z.number().positive(),
});

export const ClipSceneSchema = z
  .object({
    image: z.string().url().optional(),
    video: z.string().url().optional(),
    texts: z.array(ClipTextSchema).default([]),
    lengthSec: z.number().positive().max(60),
  })
  .refine(
    (scene) => Boolean(scene.image || scene.video || scene.texts.length > 0),
    "Scene needs an image, video, or text",
  );

export const ClipSpecSchema = z.object({
  title: z.string().min(1).max(140),
  aspect: z.enum(["16:9", "9:16", "1:1"]).default("9:16"),
  scenes: z.array(ClipSceneSchema).min(1).max(20),
  audioUrl: z.string().url().optional(),
  durationSecCap: z.number().positive().optional(),
});

export type ClipText = z.infer<typeof ClipTextSchema>;
export type ClipScene = z.infer<typeof ClipSceneSchema>;
export type ClipSpec = z.infer<typeof ClipSpecSchema>;

export function parseClipSpec(input: unknown): ClipSpec {
  const result = ClipSpecSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid clip spec: ${details}`);
  }
  const spec = result.data;
  if (
    spec.durationSecCap !== undefined &&
    totalDuration(spec) > spec.durationSecCap
  ) {
    throw new Error(
      `Clip runs ${totalDuration(spec)}s, over the ${spec.durationSecCap}s cap`,
    );
  }
  return spec;
}

export function totalDuration(spec: ClipSpec): number {
  return spec.scenes.reduce((sum, scene) => sum + scene.lengthSec, 0);
}

export interface ShotstackClip {
  asset: { type: string; src?: string; text?: string };
  start: number;
  length: number;
}

export function buildShotstackEdit(spec: ClipSpec): {
  timeline: {
    tracks: { clips: ShotstackClip[] }[];
    soundtrack?: { src: string; effect: string };
  };
  output: { format: string; resolution: string; aspectRatio: string };
} {
  const tracks: { clips: ShotstackClip[] }[] = [];
  const texts: ShotstackClip[] = [];
  let offset = 0;
  for (const scene of spec.scenes) {
    if (scene.video || scene.image) {
      tracks.push({
        clips: [
          {
            asset: {
              type: scene.video ? "video" : "image",
              src: scene.video ?? scene.image,
            },
            start: offset,
            length: scene.lengthSec,
          },
        ],
      });
    }
    for (const text of scene.texts) {
      texts.push({
        asset: { type: "text", text: text.text },
        start: offset + text.startSec,
        length: text.lengthSec,
      });
    }
    offset += scene.lengthSec;
  }
  if (texts.length > 0) tracks.push({ clips: texts });
  return {
    timeline: {
      tracks,
      ...(spec.audioUrl
        ? { soundtrack: { src: spec.audioUrl, effect: "fadeInOut" } }
        : {}),
    },
    output: { format: "mp4", resolution: "hd", aspectRatio: spec.aspect },
  };
}

export function buildCreatomateBody(
  spec: ClipSpec,
  templateId: string,
): { template_id: string; modifications: Record<string, string> } {
  if (!templateId.trim()) throw new Error("Creatomate templateId must be nonempty");
  const modifications: Record<string, string> = { title: spec.title };
  spec.scenes.forEach((scene, index) => {
    modifications[`scene-${index + 1}`] = scene.texts
      .map((text) => text.text)
      .join("\n");
  });
  if (spec.audioUrl) modifications.audio = spec.audioUrl;
  return { template_id: templateId, modifications };
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export async function pollStatus<T>(
  load: () => Promise<T>,
  want: (result: T) => boolean,
  {
    intervalMs = 2000,
    timeoutMs = 600000,
    sleepFn = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: PollOptions = {},
): Promise<T> {
  const started = Date.now();
  let waited = 0;
  for (;;) {
    const result = await load();
    if (want(result)) return result;
    const elapsed = Math.max(Date.now() - started, waited);
    if (elapsed >= timeoutMs) {
      throw new VendorError("Render status polling timed out");
    }
    const delay = Math.min(Math.max(1, intervalMs), timeoutMs - elapsed);
    await sleepFn(delay);
    waited += delay;
  }
}

export type ClipVendor = "remotion" | "shotstack" | "creatomate";

export interface RenderClipOptions {
  vendor?: ClipVendor | "auto";
  dryRun?: boolean;
  guards?: Guards;
  logger?: Logger;
  fetchFn?: typeof fetch;
  templateId?: string;
  remotion?: RemotionConfig;
  remotionFns?: RemotionFunctions;
  shotstack?: { apiKey?: string; env?: "stage" | "v1" };
  creatomate?: { apiKey?: string };
  poll?: PollOptions;
}

export interface DryRunPreview {
  dryRun: true;
  vendor: ClipVendor;
  spec: { title: string; aspect: string; scenes: number; durationSec: number };
  edit: unknown;
}

export interface LiveReceipt {
  dryRun: false;
  vendor: ClipVendor;
  id: string;
  url?: string;
  file?: string;
}

export function selectVendor(opts: RenderClipOptions): ClipVendor {
  if (opts.vendor !== undefined && opts.vendor !== "auto") return opts.vendor;
  if (opts.remotion) return "remotion";
  if (opts.shotstack?.apiKey ?? process.env.SHOTSTACK_API_KEY) return "shotstack";
  if (opts.creatomate?.apiKey ?? process.env.CREATOMATE_API_KEY) return "creatomate";
  throw new VendorError(
    "No vendor configured: pass remotion config or set SHOTSTACK_API_KEY or CREATOMATE_API_KEY",
  );
}

export async function renderClip(
  specInput: unknown,
  opts: RenderClipOptions = {},
): Promise<DryRunPreview | LiveReceipt> {
  const spec = parseClipSpec(specInput);
  opts.guards?.checkDispatch(spec.title);
  const vendor = selectVendor(opts);
  if (vendor === "remotion" && !opts.remotion) {
    throw new VendorError("Remotion vendor needs a remotion config");
  }
  if (vendor === "creatomate" && !opts.templateId) {
    throw new VendorError("Creatomate vendor needs a templateId");
  }
  const edit =
    vendor === "shotstack"
      ? buildShotstackEdit(spec)
      : vendor === "creatomate"
        ? buildCreatomateBody(spec, opts.templateId as string)
        : opts.remotion;
  if (opts.dryRun ?? true) {
    return {
      dryRun: true as const,
      vendor,
      spec: {
        title: spec.title,
        aspect: spec.aspect,
        scenes: spec.scenes.length,
        durationSec: totalDuration(spec),
      },
      edit,
    };
  }
  opts.logger?.info(`Rendering clip with ${vendor}`);
  let receipt: { id: string; url?: string; file?: string };
  if (vendor === "remotion") {
    const file = await new RemotionAdapter(opts.remotionFns).render(
      opts.remotion as RemotionConfig,
    );
    receipt = { id: file.file, file: file.file };
  } else {
    const adapter =
      vendor === "shotstack"
        ? new ShotstackAdapter({ ...opts.shotstack, fetchFn: opts.fetchFn })
        : new CreatomateAdapter({ ...opts.creatomate, fetchFn: opts.fetchFn });
    const id = await adapter.submit(edit);
    const status = await pollStatus(
      () => adapter.status(id),
      (found) => found.status === "done" || found.status === "succeeded",
      opts.poll,
    );
    receipt = { id, ...(status.url ? { url: status.url } : {}) };
  }
  opts.guards?.recordDispatch();
  recordCost({ kind: "render", adapter: vendor, units: Math.ceil(totalDuration(spec)) });
  return { dryRun: false as const, vendor, ...receipt };
}

export async function clipStatus(
  vendor: ClipVendor,
  id: string,
  opts: RenderClipOptions = {},
): Promise<{ vendor: ClipVendor; id: string; status: string; url?: string }> {
  if (vendor === "remotion") return { vendor, id, status: "done" };
  const adapter =
    vendor === "shotstack"
      ? new ShotstackAdapter({ ...opts.shotstack, fetchFn: opts.fetchFn })
      : new CreatomateAdapter({ ...opts.creatomate, fetchFn: opts.fetchFn });
  const status = await adapter.status(id);
  return { vendor, id, ...status };
}
