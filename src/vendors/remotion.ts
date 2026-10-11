import { VendorError } from "../core.js";
import type {
  Codec,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";

export type SelectedComposition = Awaited<ReturnType<typeof selectComposition>>;
export type RenderMediaResult = Awaited<ReturnType<typeof renderMedia>>;

export interface RemotionConfig {
  serveUrl?: string;
  entryPoint?: string;
  composition: string;
  inputProps?: Record<string, unknown>;
  codec?: Codec;
  outputLocation: string;
}

export interface RemotionFunctions {
  bundleFn?: (options: { entryPoint: string }) => Promise<string>;
  selectFn?: (options: {
    serveUrl: string;
    id: string;
    inputProps?: Record<string, unknown>;
  }) => Promise<SelectedComposition>;
  renderFn?: (options: {
    composition: SelectedComposition;
    serveUrl: string;
    codec: Codec;
    outputLocation: string;
    inputProps?: Record<string, unknown>;
  }) => Promise<unknown>;
}

export class RemotionAdapter {
  private readonly functions: RemotionFunctions;

  constructor(functions: RemotionFunctions = {}) {
    this.functions = functions;
  }

  async render(config: RemotionConfig): Promise<{ file: string }> {
    try {
      if (!config.serveUrl && !config.entryPoint) {
        throw new Error("Remotion needs serveUrl or entryPoint");
      }
      if (!config.composition?.trim()) {
        throw new Error("Remotion composition must be nonempty");
      }
      if (!config.outputLocation?.trim()) {
        throw new Error("Remotion outputLocation must be nonempty");
      }
      const inputProps = config.inputProps ?? {};
      const bundleOne =
        this.functions.bundleFn ??
        (async (options: { entryPoint: string }): Promise<string> =>
          (await import("@remotion/bundler")).bundle(options));
      const selectOne =
        this.functions.selectFn ??
        (async (options: {
          serveUrl: string;
          id: string;
          inputProps?: Record<string, unknown>;
        }): Promise<SelectedComposition> =>
          (await import("@remotion/renderer")).selectComposition({
            serveUrl: options.serveUrl,
            id: options.id,
            inputProps: options.inputProps ?? {},
          }));
      const renderOne =
        this.functions.renderFn ??
        (async (options: {
          composition: SelectedComposition;
          serveUrl: string;
          codec: Codec;
          outputLocation: string;
          inputProps?: Record<string, unknown>;
        }): Promise<unknown> =>
          (await import("@remotion/renderer")).renderMedia({
            composition: options.composition,
            serveUrl: options.serveUrl,
            codec: options.codec,
            outputLocation: options.outputLocation,
            inputProps: options.inputProps ?? {},
          }));
      const serveUrl =
        config.serveUrl ??
        (await bundleOne({ entryPoint: config.entryPoint as string }));
      const composition = await selectOne({
        serveUrl,
        id: config.composition,
        inputProps,
      });
      await renderOne({
        composition,
        serveUrl,
        codec: config.codec ?? "h264",
        outputLocation: config.outputLocation,
        inputProps,
      });
      return { file: config.outputLocation };
    } catch (cause) {
      if (cause instanceof VendorError) throw cause;
      throw new VendorError(
        `Remotion render failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  }
}
