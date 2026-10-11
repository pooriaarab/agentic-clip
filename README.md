# agentic-clip

<p align="center">Render short clips with Remotion, Shotstack, or Creatomate.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/agentic-clip"><img src="https://img.shields.io/npm/v/agentic-clip" alt="npm version"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License MIT"/></a>
</p>

```text
$ agentic-clip render --spec '{"title":"Teaser","scenes":[{"image":"https://example.com/f.png","lengthSec":2}]}' --vendor shotstack
{"dryRun":true,"vendor":"shotstack","spec":{"title":"Teaser","aspect":"9:16","scenes":1,"durationSec":2},"edit":{"timeline":{"tracks":[{"clips":[{"asset":{"type":"image","src":"https://example.com/f.png"},"start":0,"length":2}]}]},"output":{"format":"mp4","resolution":"hd","aspectRatio":"9:16"}}}
```

<p align="center"><em><code>render</code> previews a Shotstack edit. Dry run costs nothing.</em></p>

## Install

```bash
npm install agentic-clip
npx agentic-clip --help
```

One line to install, one line to run.

## Quick start

Write one spec. Pick a vendor. Preview first, then render.

```bash
agentic-clip render --spec-file clip.json --vendor shotstack
agentic-clip render --spec-file clip.json --vendor shotstack --live
agentic-clip costs
```

The first command prints a preview and spends nothing. The second
command renders for real. The third command shows the cost report.

## Why

For makers who ship short video and switch vendors often. One spec
describes the clip. Each vendor gets its own native request. Not for
long-form edits or live streams.

## Render

The invocation people actually type.

```bash
agentic-clip render --spec-file clip.json --vendor auto --live --store stream --template-id tpl_123
```

```
{"dryRun":false,"vendor":"creatomate","id":"cr-1","url":"https://cdn.creatomate.com/r/cr-1.mp4"}
```

Auto picks the first vendor with credentials. Store uploads the
finished file after a local render.

## Status

```bash
agentic-clip status --vendor shotstack --id abc123
```

```
{"vendor":"shotstack","id":"abc123","status":"rendering"}
```

Poll this id until the status reads done or succeeded.

## Upload

```bash
agentic-clip upload --file out/clip.mp4 --to r2
```

```
{"bucket":"clips","key":"clip.mp4","url":"r2://clips/clip.mp4"}
```

Use r2 for files. Use stream for playback URLs.

## How it works

A clip spec holds a title, an aspect, and scenes. Each scene holds an
image or a video plus timed texts. The pack maps the spec to the
vendor request, polls the render, and returns the file or URL.
Finished files go to R2. Stream serves playback.

Set the keys you use. Leave the rest unset.

| Key | Vendor |
|---|---|
| SHOTSTACK_API_KEY | Shotstack |
| CREATOMATE_API_KEY | Creatomate |
| R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET | R2 |
| STREAM_ACCOUNT_ID, STREAM_API_TOKEN, STREAM_CUSTOMER_SUBDOMAIN | Stream |

Remotion needs no key. It renders on your machine with your project.
Pass --serve-url or --entry-point plus --composition and --out.

## Use it as a library

```js
import { renderClip } from "agentic-clip";

const spec = {
  title: "Teaser",
  scenes: [{ image: "https://example.com/f.png", lengthSec: 2 }],
};
await renderClip(spec, { vendor: "shotstack", dryRun: true });
```

## Use it from an agent

```json
{ "mcpServers": { "agentic-clip": { "command": "npx", "args": ["-y", "agentic-clip", "mcp"] } } }
```

The server exposes render_clip, clip_status, upload_clip, and
get_cost_report. Read AGENTS.md for the agent loop.

## Contributing

See [CONTRIBUTING.md](https://github.com/pooriaarab/.github/blob/main/CONTRIBUTING.md).

## License

[MIT](LICENSE)
