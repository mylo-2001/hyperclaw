# Canvas + A2UI v0.8

HyperClaw canvas exposes an A2UI v0.8-compatible API for AI-driven UI streaming.

## Endpoints

- **GET /api/canvas/state** — Raw canvas state (JSON)
- **GET /api/canvas/a2ui** — A2UI JSONL (application/x-ndjson)

## A2UI format

A `beginRendering` message contains `surfaceId`, `surfaces` (flat list), `dataModel`.

Types: `chart`, `table`, `form`, `markdown`, `image`, `custom`, `script`.

Ref: https://a2ui.org/specification/v0.8-a2ui/
