# OSINT / Ethical Hacking Mode
---

<div align="center">

[← SkillHub](skillhub.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Voice →](voice.md)

</div>

---

HyperClaw includes a dedicated OSINT mode that pre-configures the agent for security research, bug bounty hunting, and penetration testing.

> **Legal notice**: Always have explicit written authorization before testing any target. HyperClaw is a tool — you are responsible for how you use it.

## Quick start

```bash
hyperclaw osint           # show available workflows
hyperclaw osint setup     # interactive setup wizard
hyperclaw osint --show    # view current profile
hyperclaw osint --reset   # clear OSINT mode
```

## Workflow presets

| Workflow | Description | MCP Tools Enabled |
|----------|-------------|-------------------|
| `recon` | Passive reconnaissance — WHOIS, DNS, public info | browser, filesystem |
| `bugbounty` | Bug bounty — scope analysis, vuln research, report drafting | browser, filesystem, github |
| `pentest` | Penetration testing — active recon, enumeration | browser, filesystem, terminal, github |
| `footprint` | Digital footprint — social media, email leaks, usernames | browser, filesystem |
| `custom` | Custom — choose your own tools | browser, filesystem |

## What OSINT mode does

When you run `hyperclaw osint setup`, it:

1. **Sets a security-tuned system prompt** — the AI becomes a professional security researcher with the right mindset for your workflow
2. **Registers MCP servers** — `mcp-browser`, `mcp-filesystem`, `mcp-github`, and/or `mcp-terminal` depending on the workflow
3. **Saves a session profile** — your target, mode, and notes are saved to `~/.hyperclaw/osint-profile.json`

## OSINT via Telegram

Once set up, send messages to your Telegram bot:

**Recon mode:**
```
"Perform passive recon on example.com: WHOIS, DNS records, subdomains"
"Search for email addresses associated with example.com"
"Find the GitHub presence of the organization 'ExampleCorp'"
```

**Bug bounty mode:**
```
"Analyze the login page at https://example.com/login for common vulnerabilities"
"Draft a bug bounty report for an XSS vulnerability I found"
"What OWASP Top 10 vulnerabilities should I check first on a web app?"
```

**Pentest mode:**
```
"Create a pentest report template for a web application assessment"
"Explain how to safely test for SQL injection in an authorized test environment"
"What ports and services are typically exposed on a web server?"
```

**Footprint mode:**
```
"Build a digital footprint profile for the username 'target_user'"
"What public information is available about the email domain example.com?"
"Check if there are any data breaches associated with example.com"
```

## Available MCP tools in OSINT mode

### mcp-browser (always enabled)

| Tool | OSINT use |
|------|-----------|
| `web_fetch` | Fetch any public URL |
| `web_search` | DuckDuckGo search |
| `dns_lookup` | A, MX, NS, TXT, CNAME records |
| `whois_lookup` | Registrar, nameservers, creation date |
| `extract_links` | Map a site's link structure |
| `get_page_title` | Quick page identification |

### mcp-filesystem (always enabled)

| Tool | OSINT use |
|------|-----------|
| `write_file` | Save findings and reports |
| `read_file` | Load existing notes |
| `search_files` | Find previously saved data |

### mcp-github (bugbounty, pentest)

| Tool | OSINT use |
|------|-----------|
| `search_code` | Find leaked secrets, API keys in public repos |
| `list_repos` | Enumerate organization's public repos |
| `get_file` | Read specific files (e.g. README, configs) |

### mcp-terminal (pentest only)

| Tool | OSINT use |
|------|-----------|
| `run_command` | Execute recon tools (nmap, curl, dig) |
| `get_system_info` | Check your own system |
| `list_processes` | Process enumeration |

> Set `ALLOWED_COMMANDS` env var to restrict which tools the terminal MCP can run.

## Example session workflow (Bug Bounty)

```bash
# 1. Set up OSINT mode
hyperclaw osint setup
# → choose: bugbounty
# → target type: domain
# → target: targets.example.com
# → notes: "HackerOne program #12345"

# 2. Start the assistant
hyperclaw daemon start

# 3. Start researching via Telegram or CLI
hyperclaw agent --message "What is the attack surface of targets.example.com?"

# 4. Save findings
# Ask the AI: "Save these findings to ~/bugbounty-example-findings.md"

# 5. Draft report
# Ask the AI: "Draft a professional bug bounty report for the XSS I found"
```

## Profile file

Your OSINT session is saved to `~/.hyperclaw/osint-profile.json`:

```json
{
  "mode": "bugbounty",
  "target": "example.com",
  "targetType": "domain",
  "notes": "HackerOne program #12345",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "mcpServers": ["mcp-browser", "mcp-filesystem", "mcp-github"]
}
```

## Reset / cleanup

```bash
hyperclaw osint --reset   # clear OSINT profile
```

This removes the system prompt override and OSINT target from your config.

## Tips

- **Telegram is ideal** for OSINT — send a target and get results on your phone while mobile
- **Save everything** — ask the AI to write findings to files as you go
- **Use Docker sandbox** for pentest commands — see [sandboxing.md](sandboxing.md)
- **Combine with web-search skill** for AI-powered Google dorking

## Legal & ethical guidelines

- Only test targets you have **explicit written authorization** to test
- Never exfiltrate real user data — only demonstrate access
- Follow **responsible disclosure** — report vulnerabilities to the vendor before publishing
- Know your jurisdiction's computer crime laws
- Keep detailed logs of your testing for legal protection

## See also

- [MCP servers](mcp.md) — detailed MCP documentation
- [Security](security.md) — HyperClaw's own security model
- [Sandboxing](sandboxing.md) — run tools in Docker containers
- [Bounty tools](../packages/core/src/agent/bounty-tools.ts) — HackerOne/Bugcrowd/Synack API integration

---

<div align="center">

[← SkillHub](skillhub.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Voice →](voice.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>