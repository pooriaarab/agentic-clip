---
name: agentic-clip
description: Render short clips with Remotion, Shotstack, or Creatomate. Keywords: short-video, remotion, reels, agentic-suite, claude-code, codex, cli, mcp.
---

# agentic-clip

Render short clips with Remotion, Shotstack, or Creatomate.

## Use the SDK

```js
import { renderClip } from "agentic-clip";

const spec = {
  title: "Teaser",
  scenes: [{ image: "https://example.com/f.png", lengthSec: 2 }],
};
await renderClip(spec, { vendor: "shotstack", dryRun: true });
```

## Use the CLI

```sh
agentic-clip render --spec-file clip.json --dry-run
agentic-clip render --spec-file clip.json --live
```

## Use the MCP server

Start the server with `agentic-clip mcp`. Call `render_clip`
for renders, `clip_status` for status, `upload_clip` for
storage, `get_cost_report` for costs.

## Rules

- Preview each render with dry run first.
- Report guard denials and adapter errors as failures.
- Read the cost report at the end.
