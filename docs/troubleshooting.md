# Troubleshooting
---

<div align="center">

[← Managed Hosting](managed-hosting.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [FAQ →](faq.md)

</div>

---

Start with the fast triage flow below, then go to the relevant section for deep runbook guidance.

---

## Command Ladder (Run These First, In Order)

```bash
hyperclaw status
hyperclaw gateway status
hyperclaw logs --follow
hyperclaw doctor
hyperclaw channels status --probe
```

**Expected healthy signals:**
- `hyperclaw gateway status` shows `Runtime: running` and `RPC probe: ok`
- `hyperclaw doctor` reports no blocking config/service issues
- `hyperclaw channels status --probe` shows connected/ready channels

---

## Anthropic 429 — Extra Usage Required for Long Context

**Trigger:** Logs/errors include `HTTP 429: rate_limit_error: Extra usage is required for long context requests`

```bash
hyperclaw logs --follow
hyperclaw models status
hyperclaw config get agents.defaults.models
```

**Look for:**
- Selected Anthropic Opus/Sonnet model has `params.context1m: true`
- Current Anthropic credential is not eligible for long-context usage
- Requests fail only on long sessions/model runs that need the 1M beta path

**Fix options:**
- Disable `context1m` for that model to fall back to the normal context window
- Use an Anthropic API key with billing, or enable Anthropic Extra Usage on the subscription account
- Configure fallback models so runs continue when Anthropic long-context requests are rejected

---

## No Replies

If channels are up but nothing answers, check routing and policy before reconnecting anything.

```bash
hyperclaw status
hyperclaw channels status --probe
hyperclaw pairing list --channel <channel> [--account <id>]
hyperclaw config get channels
hyperclaw logs --follow
```

**Look for:**
- Pairing pending for DM senders
- Group mention gating (`requireMention`, `mentionPatterns`)
- Channel/group allowlist mismatches

**Common signatures:**

| Log message | Cause |
|-------------|-------|
| `drop guild message (mention required)` | Group message ignored until mention |
| `pairing request` | Sender needs approval |
| `blocked / allowlist` | Sender/channel filtered by policy |

---

## Dashboard / Control UI Connectivity

When dashboard/control UI will not connect, validate URL, auth mode, and secure context assumptions.

```bash
hyperclaw gateway status
hyperclaw status
hyperclaw logs --follow
hyperclaw doctor
hyperclaw gateway status --json
```

**Look for:**
- Correct probe URL and dashboard URL
- Auth mode/token mismatch between client and gateway
- HTTP usage where device identity is required

**Common signatures:**

| Log message | Cause |
|-------------|-------|
| `device identity required` | Non-secure context or missing device auth |
| `device nonce required / device nonce mismatch` | Client not completing challenge-based device auth flow |
| `device signature invalid / device signature expired` | Client signed wrong payload (or stale timestamp) |
| `unauthorized / reconnect loop` | Token/password mismatch |
| `gateway connect failed:` | Wrong host/port/URL target |

**Device auth v2 migration check:**
```bash
hyperclaw --version
hyperclaw doctor
hyperclaw gateway status
```
If logs show nonce/signature errors, update the connecting client and verify it:
1. Waits for `connect.challenge`
2. Signs the challenge-bound payload
3. Sends `connect.params.device.nonce` with the same challenge nonce

---

## Gateway Service Not Running

Use this when service is installed but process does not stay up.

```bash
hyperclaw gateway status
hyperclaw status
hyperclaw logs --follow
hyperclaw doctor
hyperclaw gateway status --deep
```

**Look for:**
- `Runtime: stopped` with exit hints
- Service config mismatch (`Config (cli)` vs `Config (service)`)
- Port/listener conflicts

**Common signatures:**

| Log message | Cause | Fix |
|-------------|-------|-----|
| `Gateway start blocked: set gateway.mode=local` | Local gateway mode not enabled | Set `gateway.mode: "local"` in config |
| `refusing to bind gateway ... without auth` | Non-loopback bind without token/password | Add `gateway.auth.token` or `gateway.auth.password` |
| `another gateway instance is already listening` / `EADDRINUSE` | Port conflict | Free the port or choose another: `hyperclaw gateway --port <port>` |

See: [Gateway Lock](./gateway-lock.md), [Multiple Gateways](./multiple-gateways.md)

---

## Channel Connected — Messages Not Flowing

If channel state is connected but message flow is dead, focus on policy, permissions, and channel-specific delivery rules.

```bash
hyperclaw channels status --probe
hyperclaw pairing list --channel <channel> [--account <id>]
hyperclaw status --deep
hyperclaw logs --follow
hyperclaw config get channels
```

**Look for:**
- DM policy (`pairing`, `allowlist`, `open`, `disabled`)
- Group allowlist and mention requirements
- Missing channel API permissions/scopes

**Common signatures:**

| Log message | Cause |
|-------------|-------|
| `mention required` | Message ignored by group mention policy |
| `pairing / pending approval traces` | Sender not approved |
| `missing_scope, not_in_channel, Forbidden, 401/403` | Channel auth/permissions issue |

---

## Cron and Heartbeat Delivery

If cron or heartbeat did not run or did not deliver, verify scheduler state first, then delivery target.

```bash
hyperclaw cron status
hyperclaw cron list
hyperclaw cron runs --id <jobId> --limit 20
hyperclaw system heartbeat last
hyperclaw logs --follow
```

**Look for:**
- Cron enabled and next wake present
- Job run history status (`ok`, `skipped`, `error`)
- Heartbeat skip reasons (`quiet-hours`, `requests-in-flight`, `alerts-disabled`)

**Common signatures:**

| Log message | Cause |
|-------------|-------|
| `cron: scheduler disabled; jobs will not run automatically` | Cron disabled |
| `cron: timer tick failed` | Scheduler tick failed; check file/log/runtime errors |
| `heartbeat skipped with reason=quiet-hours` | Outside active hours window |
| `heartbeat: unknown accountId` | Invalid account ID for heartbeat delivery target |
| `heartbeat skipped with reason=dm-blocked` | Heartbeat target is DM-style while `directPolicy` is set to block |

---

## Node Paired — Tool Fails

If a node is paired but tools fail, isolate foreground, permission, and approval state.

```bash
hyperclaw nodes status
hyperclaw nodes describe --node <idOrNameOrIp>
hyperclaw approvals get --node <idOrNameOrIp>
hyperclaw logs --follow
hyperclaw status
```

**Common signatures:**

| Log message | Cause |
|-------------|-------|
| `NODE_BACKGROUND_UNAVAILABLE` | Node app must be in foreground |
| `*_PERMISSION_REQUIRED / LOCATION_PERMISSION_REQUIRED` | Missing OS permission |
| `SYSTEM_RUN_DENIED: approval required` | exec approval pending |
| `SYSTEM_RUN_DENIED: allowlist miss` | Command blocked by allowlist |

---

## Browser Tool Fails

Use this when browser tool actions fail even though the gateway itself is healthy.

```bash
hyperclaw browser status
hyperclaw browser start --browser-profile hyperclaw
hyperclaw browser profiles
hyperclaw logs --follow
hyperclaw doctor
```

**Common signatures:**

| Log message | Cause |
|-------------|-------|
| `Failed to start Chrome CDP on port` | Browser process failed to launch |
| `browser.executablePath not found` | Configured path is invalid |
| `Chrome extension relay is running, but no tab is connected` | Extension relay not attached |
| `Browser attachOnly is enabled ... not reachable` | Attach-only profile has no reachable target |

---

## Post-Upgrade Breakage

Most post-upgrade breakage is config drift or stricter defaults now being enforced.

### Auth and URL Override Behavior Changed

```bash
hyperclaw gateway status
hyperclaw config get gateway.mode
hyperclaw config get gateway.remote.url
hyperclaw config get gateway.auth.mode
```

- If `gateway.mode=remote`, CLI calls may be targeting remote while your local service is fine
- Explicit `--url` calls do not fall back to stored credentials

**Common signatures:**
- `gateway connect failed:` → wrong URL target
- `unauthorized` → endpoint reachable but wrong auth

### Bind and Auth Guardrails Are Stricter

```bash
hyperclaw config get gateway.bind
hyperclaw config get gateway.auth.token
hyperclaw gateway status
hyperclaw logs --follow
```

- Non-loopback binds (`lan`, `tailnet`, `custom`) need auth configured
- Old keys like `gateway.token` do not replace `gateway.auth.token`

**Common signatures:**
- `refusing to bind gateway ... without auth` → bind+auth mismatch
- `RPC probe: failed` while runtime is running → gateway alive but inaccessible

### Pairing and Device Identity State Changed

```bash
hyperclaw devices list
hyperclaw pairing list --channel <channel> [--account <id>]
hyperclaw logs --follow
hyperclaw doctor
```

**Common signatures:**
- `device identity required` → device auth not satisfied
- `pairing required` → sender/device must be approved

If the service config and runtime still disagree after checks, reinstall service metadata:
```bash
hyperclaw gateway install --force
hyperclaw gateway restart
```

---

## Background Exec / Process Tool Issues

**exec sessions not backgrounding:**
- Check `tools.exec.backgroundMs` (default: 10000ms)
- Use `background: true` to force immediate backgrounding

**Process output not appearing:**
```bash
# List all background sessions
{ "tool": "process", "action": "list" }

# Poll for new output
{ "tool": "process", "action": "poll", "sessionId": "<id>" }

# Read aggregated output (last 200 lines)
{ "tool": "process", "action": "log", "sessionId": "<id>" }
```

**Session not found after restart:**
Sessions are in-memory only and lost on process restart. This is by design (no disk persistence).

---

## Gateway Lock / Port Conflicts

```bash
# See what's using the port
lsof -i :18789

# Run on a different port
hyperclaw gateway --port 19001

# For multi-gateway setups, use profiles
hyperclaw --profile rescue gateway --port 19001
```

See: [Gateway Lock](./gateway-lock.md), [Multiple Gateways](./multiple-gateways.md)

---

## Security Audit Failures

```bash
hyperclaw security audit
hyperclaw security audit --deep
hyperclaw security audit --fix
hyperclaw security audit --json
```

High-priority findings to fix first:
1. Anything "open" + tools enabled → lock down DMs/groups, tighten tool policy
2. Public network exposure → fix immediately
3. Browser control remote exposure → tailnet-only, pair nodes deliberately
4. Permissions → lock down `~/.hyperclaw` (700 on dirs, 600 on files)
5. Plugins → only load what you explicitly trust

See: [Security](./security.md)

---

<div align="center">

[← Managed Hosting](managed-hosting.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [FAQ →](faq.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>