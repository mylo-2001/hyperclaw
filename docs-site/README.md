# HyperClaw Docs Site (Mintlify)

This folder contains the Mintlify documentation structure for HyperClaw.

## Setup

1. Install [Mintlify](https://mintlify.com) CLI:
   ```bash
   npm install -g mintlify
   ```

2. Run the dev server:
   ```bash
   mintlify dev
   ```

3. Build for production:
   ```bash
   mintlify build
   ```

## Structure

- `docs.json` — Mintlify config (navigation, theme, anchors)
- `intro.mdx` — Landing page
- `guides/` — How-to guides
- `reference/` — CLI, API, configuration reference

## Deploy to Mintlify

Connect this repo to [Mintlify](https://mintlify.com) and point to the `docs-site` folder.
