# Gateway Lock

**Last updated:** 2025-12-11

---

## Why

- Ensure only one gateway instance runs per base port on the same host; additional gateways must use isolated profiles and unique ports.
- Survive crashes/SIGKILL without leaving stale lock files.
- Fail fast with a clear error when the control port is already occupied.

---

## Mechanism

The gateway binds the WebSocket listener (default `ws://127.0.0.1:18789`) immediately on startup using an **exclusive TCP listener**.

- If the bind fails with `EADDRINUSE`, startup throws `GatewayLockError("another gateway instance is already listening on ws://127.0.0.1:<port>")`.
- The OS releases the listener automatically on any process exit, including crashes and SIGKILL — **no separate lock file or cleanup step is needed**.
- On shutdown, the gateway closes the WebSocket server and underlying HTTP server to free the port promptly.

---

## Error Surface

| Condition | Error message |
|-----------|--------------|
| Port already in use | `GatewayLockError: another gateway instance is already listening on ws://127.0.0.1:<port>` |
| Other bind failure | `GatewayLockError: failed to bind gateway socket on ws://127.0.0.1:<port>: <reason>` |

Both errors are instances of `GatewayLockError` (extends `Error`), with a `.code` property:
- `"EADDRINUSE"` — port conflict
- `"BIND_ERROR"` — other TCP bind failure

---

## Operational Notes

**Port occupied by another process:**
```bash
# Find what's using the port
lsof -i :18789
# Or choose another port
hyperclaw gateway --port 19001
```

**Running multiple gateways on one host:**
Use the `--profile` flag to isolate state and config automatically:
```bash
hyperclaw --profile rescue gateway --port 19001
```

See [Multiple Gateways](./multiple-gateways.md) for the full isolation checklist.

**macOS app:** Still maintains its own lightweight PID guard before spawning the gateway; the runtime lock is enforced by the WebSocket bind.

---

## Error Handling in Code

```typescript
import { startGateway, GatewayLockError } from 'hyperclaw/gateway';

try {
  await startGateway(config);
} catch (err) {
  if (err instanceof GatewayLockError) {
    if (err.code === 'EADDRINUSE') {
      console.error('Another gateway is already running. Use --port to choose another port.');
    } else {
      console.error(`Gateway bind failed: ${err.message}`);
    }
    process.exit(1);
  }
  throw err;
}
```
