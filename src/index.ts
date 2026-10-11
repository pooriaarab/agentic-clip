export { VERSION } from "./version.js";
export {
  defineBrand,
  createLogger,
  GuardError,
  VendorError,
  createGuards,
  LocalRouterAdapter,
  HttpRouterAdapter,
  recordCost,
  getCostReport,
  resetCosts,
  createDryRunResult,
  dispatchText,
  summarizeText,
} from "./core.js";
export type {
  BrandConfig,
  LogLevel,
  Logger,
  LoggerOptions,
  CapsConfig,
  QuietHoursConfig,
  GuardsConfig,
  Guards,
  DispatchReceipt,
  RouterAdapter,
  HttpRouterOptions,
  CostEntry,
  CostReport,
  DispatchOptions,
  DispatchResult,
  TopWord,
  TextSummary,
  SummarizeOptions,
} from "./core.js";

export {
  parseClipSpec,
  totalDuration,
  buildShotstackEdit,
  buildCreatomateBody,
  pollStatus,
  selectVendor,
  renderClip,
  clipStatus,
} from "./clip.js";
export type {
  ClipText,
  ClipScene,
  ClipSpec,
  ClipVendor,
  PollOptions,
  RenderClipOptions,
  DryRunPreview,
  LiveReceipt,
} from "./clip.js";

export { ShotstackAdapter, type ShotstackOptions } from "./vendors/shotstack.js";
export { CreatomateAdapter, type CreatomateOptions } from "./vendors/creatomate.js";
export {
  RemotionAdapter,
  type RemotionConfig,
  type RemotionFunctions,
  type SelectedComposition,
} from "./vendors/remotion.js";

export { signS3Put, uploadToR2, uploadToStream } from "./storage.js";
export type { S3PutOptions, R2UploadOptions, StreamUploadOptions } from "./storage.js";

import { defineBrand, type BrandConfig } from "./core.js";
import { VERSION } from "./version.js";

export const DEFAULT_BRAND: BrandConfig = defineBrand({
  name: "agentic-clip",
  command: "agentic-clip",
  description: "Render short clips with Remotion, Shotstack, or Creatomate.",
  keywords: ["short-video", "remotion", "reels", "agentic-suite", "claude-code", "codex", "cli", "mcp"],
  version: VERSION,
});
