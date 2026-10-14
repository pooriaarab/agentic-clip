# agentic-clip

[![npm version](https://img.shields.io/npm/v/agentic-clip)](https://www.npmjs.com/package/agentic-clip) [![Downloads/month](https://img.shields.io/npm/dm/agentic-clip)](https://www.npmjs.com/package/agentic-clip) [![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/license/mit)

[Setup](#send-your-first-preview) · [API and commands](#runtime-surfaces) · [Integrations](#integration-guides) · [Comparisons](#compare)

agentic-clip is an open-source video rendering SDK for developers who use Remotion, Shotstack, or Creatomate. It validates clip specifications and previews vendor requests before live rendering. It also uploads local files to Cloudflare R2 or Cloudflare Stream.

## Install

```bash
npm install agentic-clip
```

Node.js 18 or later is required. TypeScript declarations are included.

## Send your first preview

Save this as `preview.mjs`, then run `node preview.mjs`.

```js
import { renderClip } from 'agentic-clip';

const preview = await renderClip({
  title: 'Hello',
  scenes: [{ texts: [{ text: 'Hello', lengthSec: 2 }], lengthSec: 2 }],
}, { vendor: 'shotstack', dryRun: true });
console.log(JSON.stringify(preview, null, 2));
```

Success prints `dryRun: true`, `vendor: "shotstack"`, and an edit with a two-second text clip. No credentials or network calls are needed.

For a live Shotstack render, export `SHOTSTACK_API_KEY` and change `dryRun` to `false` after reviewing the preview.
The SDK polls until completion and returns a render `id` with a `url` when available.
Environment variables must exist in the process; the package does not load `.env` files.

## How it works

```text
Clip spec -> validation -> dry-run preview
                       -> render adapter -> poll -> id / URL / local file
Local file -> upload -> Cloudflare R2 or Cloudflare Stream
```

## Why it exists

Direct Remotion and Shotstack APIs expose different render inputs. agentic-clip adds one entry point, request previews, and file upload helpers.
Vendor behavior still differs; a clip specification does not produce identical output across adapters.

## Compare

Scope checked on 2026-10-14 against [Remotion renderer documentation](https://www.remotion.dev/docs/renderer) and [Shotstack edit concepts](https://shotstack.io/docs/guide/getting-started/core-concepts/).

| Surface | agentic-clip | Remotion renderer | Shotstack API |
|---|---|---|---|
| Scope | Adapter orchestration | Programmatic video rendering | Cloud video editing |
| Render configuration | Clip spec plus vendor options | Composition and render options | JSON timeline, tracks, clips |
| Execution | Node.js; vendor-dependent rendering | Server-side rendering | Cloud API |

## Coverage

| Integration | Status | Implemented path |
|---|---|---|
| Remotion | ✓ | Bundle/select/render an existing composition |
| Shotstack | ✓ | Submit edit; poll render status |
| Creatomate | ✓ | Submit template modifications; poll status |
| Cloudflare R2 | ✓ | Signed S3-compatible PUT |
| Cloudflare Stream | ✓ | Direct upload; optional playback links |

The code contains three render adapters and two upload integrations. These are implemented paths, not scaffolds.
Tests use mocks or injected functions. This rewrite includes no credential-backed verification of the five integrations.

## Common use cases

1. Content developers: preview Shotstack timeline JSON before a paid render.
2. Template teams: fill Creatomate title and scene-text modifications from a script.
3. React video developers: render an existing Remotion composition on their own machine.
4. Media operators: upload local MP4 files to Cloudflare R2 or Cloudflare Stream.

## Features

- **Validation:** check titles, aspect ratios, scene lengths, and optional duration caps.
- **Preview:** inspect a vendor request before live rendering.
- **Polling:** wait for Shotstack or Creatomate completion.
- **Storage:** upload local files with the [storage setup](#integration-guides).
- **Cost records:** track render units in the current process, without invoice reconciliation.

## Runtime surfaces

The Node.js SDK exports `renderClip`, `clipStatus`, `parseClipSpec`, request builders, adapter classes, and upload helpers.
It also re-exports shared `agentic-core` utilities.

The command-line interface (CLI) provides `render`, `status`, `upload`, `costs`, and `mcp`.
Use `--help` or `-h` for usage, and `--version` or `-V` for the version.

```bash
npx agentic-clip render --spec-file clip.json --vendor shotstack
npx agentic-clip status --vendor shotstack --id YOUR_RENDER_ID
npx agentic-clip upload --file clip.mp4 --to r2
npx agentic-clip costs
```

The Model Context Protocol (MCP) server exposes four tools: `render_clip`, `clip_status`, `upload_clip`, and `get_cost_report`.
Start it with `npx agentic-clip mcp` or `npx agentic-clip-mcp`.

```json
{"mcpServers":{"agentic-clip":{"command":"npx","args":["-y","agentic-clip","mcp"]}}}
```

A Worker source entry provides `GET /health` and preview-only `POST /render`. It never performs live rendering.
The package does not provide a managed Worker deployment.

## Delivery and behavior limits

- Dry run is the default. Live rendering requires `dryRun: false` or CLI `--live`.
- The schema accepts 1–20 scenes, each at most 60 seconds. Text timing is not checked against scene boundaries.
- Creatomate maps title, scene text, and audio. It does not map scene image, video, timing, or aspect fields.
- Remotion uses your composition and `inputProps`; it does not build a composition from clip scenes.
- CLI Remotion input properties contain only the title. SDK callers can provide their own properties.
- Remote polling defaults to two-second intervals and a ten-minute timeout. HTTP render requests default to 30-second timeouts without retries.
- Remotion status returns `done` without checking the file. Remote status calls query the vendor.
- CLI `--store` uploads only local render files. It does not download remote render URLs.
- R2 returns an `r2://` identifier, not a public playback URL. Stream upload does not wait for video processing.
- Cost records live in memory. A separate CLI invocation starts a new report; records do not represent vendor bills.

## Integration guides

- Shotstack rendering: export `SHOTSTACK_API_KEY`; preview first, then use `--vendor shotstack --live`.
- Creatomate templates: export `CREATOMATE_API_KEY`; pass `--template-id` and use `--vendor creatomate`.
- Remotion local rendering: pass `--serve-url` or `--entry-point`, plus `--composition` and `--out`.
- Cloudflare R2 uploads: export `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET`.
- Cloudflare Stream uploads: export `STREAM_ACCOUNT_ID` and `STREAM_API_TOKEN`. Set `STREAM_CUSTOMER_SUBDOMAIN` for playback links.

## Status

Version 0.1.0 is an early release. APIs and vendor mappings can change before 1.0.
Use [GitHub issues](https://github.com/pooriaarab/agentic-clip/issues) for support. Public case studies are not yet published in this repository.

## FAQ

### What is agentic-clip?

agentic-clip is a Node.js video rendering SDK with CLI and MCP interfaces. It wraps three render adapters and two upload paths.

### Which integrations are verified?

agentic-clip has mocked adapter tests for the implemented integrations. Live credential-backed verification was not performed for this rewrite.

### Does agentic-clip provide a managed rendering service?

agentic-clip runs in your process. Remotion runs locally; Shotstack and Creatomate use your vendor accounts.

### How is agentic-clip different from Remotion?

agentic-clip wraps Remotion rendering and exposes other vendor adapters. Remotion supplies the composition renderer; you still create the composition.

### How is agentic-clip different from Shotstack?

agentic-clip converts a limited clip specification into Shotstack edit JSON. Shotstack provides the cloud rendering API and its wider edit format.

### Can I preview without API keys?

agentic-clip previews explicit Shotstack requests without credentials. Creatomate previews need a template ID, and Remotion previews need configuration.

### Does it load my .env file?

agentic-clip reads process environment variables. Export them before starting the process or load them with your application.

### Does it upload every finished render automatically?

agentic-clip uploads a local render file when CLI `--store r2` or `--store stream` is set. Remote URLs need a separate download.

### Does the cost report show my bill?

agentic-clip stores render cost records in process memory. Vendor invoices and earlier CLI sessions are not reconciled.

## Contributing

Follow the [fleet contribution guide](https://github.com/pooriaarab/.github/blob/main/CONTRIBUTING.md).

## License

[MIT](https://opensource.org/license/mit).
