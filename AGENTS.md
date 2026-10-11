# AGENTS.md for agentic-clip

One spec in, one clip out. The pack maps the spec to a vendor
request, polls the render, and stores the file.

## The three faces

- SDK: `import { renderClip } from "agentic-clip"`.
- CLI: `npx agentic-clip render --spec-file clip.json`.
- MCP: `npx agentic-clip mcp`, then call the tools below.

## MCP tools

| Tool | Use it for |
|---|---|
| render_clip | Render one clip. Dry run is the default. |
| clip_status | Read a live render status by vendor and id. |
| upload_clip | Store a finished file in R2 or Stream. |
| get_cost_report | Read render costs for this session. |

## The loop

1. Write the spec. Keep one title, one aspect, short scenes.
2. Preview with dry run. Read the vendor edit.
3. Render live only after the preview looks right.
4. Store the file with upload_clip when you need a URL.
5. Read the cost report before you close the task.

## Rules

- Preview each render with dry run first.
- Report guard denials and vendor errors as failures.
- Never claim a render worked without an id or URL.
- Remotion renders locally and needs serveUrl or entryPoint.
- Shotstack needs SHOTSTACK_API_KEY. Creatomate needs
  CREATOMATE_API_KEY plus a templateId.
