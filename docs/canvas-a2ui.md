# Canvas + A2UI v0.8

Το HyperClaw canvas εκθέτει A2UI v0.8-compatible API για AI-driven UI streaming.

## Endpoints

- **GET /api/canvas/state** — Raw canvas state (JSON)
- **GET /api/canvas/a2ui** — A2UI JSONL (application/x-ndjson)

## A2UI format

Ένα beginRendering message περιέχει surfaceId, surfaces (flat list), dataModel.

Τύποι: chart, table, form, markdown, image, custom, script.

Ref: https://a2ui.org/specification/v0.8-a2ui/
