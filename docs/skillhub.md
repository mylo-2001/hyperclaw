# SkillHub & Skills

Skills extend the agent with new capabilities. HyperClaw supports three ways to get skills:

1. **Bundled skills** — shipped with HyperClaw (`skills/` directory)
2. **Install from URL** — one-step install from clawhub.ai or any SKILL.md URL
3. **Self-writing** — agent creates custom skills on demand via `create_skill`

---

## Install from URL (`install_skill_from_hub`)

Give the agent a clawhub.ai link and it fetches, extracts, and installs the skill automatically:

```
"Install this skill: https://clawhub.ai/b0tresch/stealth-browser"
```

The agent calls the built-in `install_skill_from_hub` tool which tries three strategies:

### Strategy 1 — REST API

Tries `https://clawhub.ai/api/skills/{owner}/{slug}` for a JSON response with all files:

```json
{
  "skill": {
    "skillId": "stealth-browser",
    "name": "Stealth Browser",
    "skillMd": "# Stealth Browser\n...",
    "files": {
      "scripts/browser.js": "import puppeteer...",
      "package.json": "{\"dependencies\":{...}}"
    }
  }
}
```

### Strategy 2 — Raw SKILL.md URL

Tries predictable raw file paths:

```
https://clawhub.ai/{owner}/{slug}/raw/SKILL.md
https://clawhub.ai/skills/{owner}/{slug}/SKILL.md
```

### Strategy 3 — HTML page scraping

Fetches the page HTML and extracts the SKILL.md frontmatter block (`---\nname: ...`).

If all strategies fail, the agent returns a page preview and asks you to paste the SKILL.md content directly.

### What gets installed

```
~/.hyperclaw/workspace/skills/{skillId}/
  SKILL.md          ← instructions loaded into agent context
  scripts/          ← any extra files from the skill
  package.json      ← npm dependencies (if skill has them)
  node_modules/     ← installed automatically if npmInstall ran
```

The skill is available on the **next message** after installation.

### Source

```typescript
// packages/core/src/agent/inference.ts — install_skill_from_hub tool
// Strategies: REST API → raw SKILL.md URL → HTML scraping
// Security: path traversal protection on all extra files
```

---

## Self-writing skills (`create_skill`)

The agent can write and install a fully custom skill during a conversation:

```
"Create a skill that monitors my Telegram group and sends a daily digest"
```

The `create_skill` tool supports multi-file skills with npm dependencies:

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `skillId` | string | Unique slug, e.g. `"daily-digest"` |
| `name` | string | Human-readable name |
| `description` | string | When to use this skill |
| `content` | string | Full SKILL.md body (markdown) |
| `files` | string | JSON object: `{"path/to/file": "content", ...}` |
| `npmInstall` | string | `"true"` to run `npm install` after writing files |

### Simple skill (instructions only)

```
create_skill:
  skillId: "daily-digest"
  name: "Daily Digest"
  description: "Summarizes activity and sends a daily briefing"
  content: |
    # Daily Digest
    When the user asks for a daily digest or summary, ...
```

Saved to: `~/.hyperclaw/workspace/skills/daily-digest/SKILL.md`

### Multi-file skill (with npm packages)

```
create_skill:
  skillId: "stealth-browser"
  name: "Stealth Browser"
  content: "# Stealth Browser\n..."
  files: {
    "package.json": "{\"dependencies\":{\"puppeteer-extra\":\"^3.3.6\",\"puppeteer-extra-plugin-stealth\":\"^2.11.2\",\"puppeteer\":\"^22.0.0\"}}",
    "scripts/browser.js": "import puppeteer from 'puppeteer-extra';\n..."
  }
  npmInstall: "true"
```

Result:

```
~/.hyperclaw/workspace/skills/stealth-browser/
  SKILL.md
  package.json
  scripts/browser.js
  node_modules/          ← npm install ran automatically
```

### Security

- Extra files cannot escape the skill directory (path traversal blocked)
- `npm install --omit=dev` is used (no devDependencies installed)
- Timeout: 120 seconds for npm install

### Source

```typescript
// packages/core/src/agent/inference.ts — create_skill tool
// packages/core/src/agent/skill-loader.ts — writeSkill() function
// Skills stored at: ~/.hyperclaw/workspace/skills/{id}/
```

---

## Bundled skills

Shipped with HyperClaw and always available:

| Skill | Description |
|-------|-------------|
| `web-search` | Search the web and summarize results |
| `file-manager` | Browse and manage local files |
| `code-runner` | Execute code snippets |
| `github-tools` | GitHub integration helpers |
| `calendar-tools` | Calendar event management |
| `summarizer` | Summarize long content |

Install via CLI:

```bash
hyperclaw skills install web-search
hyperclaw skills list
```

---

## Skill file format (SKILL.md)

Every skill is a markdown file with an optional YAML frontmatter:

```markdown
---
name: My Skill
description: Short description of when to use this skill
---

# My Skill

## When to Use

- User asks about X
- User wants to do Y

## Instructions

Step 1: ...
Step 2: ...

## Examples

"Do X for me"
"Help me with Y"
```

The frontmatter fields (`name`, `description`) are read by the skill loader and displayed in `hyperclaw skills list`.

---

## Skill directories

| Path | Contents |
|------|----------|
| `skills/` | Bundled skills (shipped with HyperClaw) |
| `~/.hyperclaw/workspace/skills/` | User-installed + self-written skills |

Both directories are scanned on startup. Workspace skills take precedence over bundled ones with the same ID.
