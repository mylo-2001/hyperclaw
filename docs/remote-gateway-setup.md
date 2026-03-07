# Remote Gateway Setup

Use SSH tunneling to connect HyperClaw to a remote gateway. This guide shows you how.

---

## Overview

```
┌─────────────────┐         ┌─────────────────┐
│  Client Machine │         │  Remote Machine │
│                 │  SSH    │                 │
│  HyperClaw CLI  │◄───────►│  Gateway        │
│  or App         │  Tunnel │  WebSocket      │
│                 │         │  127.0.0.1:18789│
│  localhost:18789│         │                 │
└─────────────────┘         └─────────────────┘
```

---

## Quick Setup

### Step 1: Add SSH config

Edit `~/.ssh/config` and add:

```
Host remote-gateway
    HostName <REMOTE_IP>          # e.g., 172.27.187.184
    User <REMOTE_USER>            # e.g., myuser
    LocalForward 18789 127.0.0.1:18789
    IdentityFile ~/.ssh/id_rsa
```

Replace `<REMOTE_IP>` and `<REMOTE_USER>` with your values.

### Step 2: Copy SSH key

Copy your public key to the remote machine (enter password once):

```bash
ssh-copy-id -i ~/.ssh/id_rsa <REMOTE_USER>@<REMOTE_IP>
```

### Step 3: Set gateway token (optional)

If the remote gateway requires auth, set the token on the client:

**macOS/Linux:**
```bash
export HYPERCLAW_GATEWAY_TOKEN="your-token"
```

Or add to `~/.hyperclaw/hyperclaw.json`:
```json
{
  "gateway": {
    "mode": "remote",
    "remote": {
      "url": "http://127.0.0.1:18789",
      "token": "your-token"
    }
  }
}
```

### Step 4: Start SSH tunnel

```bash
ssh -N remote-gateway &
```

### Step 5: Verify

```bash
hyperclaw status --deep
hyperclaw health
```

The CLI will connect to the remote gateway through the tunnel.

---

## Auto-Start Tunnel on Login

Create a Launch Agent so the tunnel starts when you log in.

### Create the plist file

Save as `~/Library/LaunchAgents/ai.hyperclaw.ssh-tunnel.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.hyperclaw.ssh-tunnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/ssh</string>
        <string>-N</string>
        <string>remote-gateway</string>
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

### Load the Launch Agent

```bash
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/ai.hyperclaw.ssh-tunnel.plist
```

The tunnel will:

- Start automatically when you log in
- Restart if it crashes
- Run in the background

### Unload (stop auto-start)

```bash
launchctl bootout gui/$UID/ai.hyperclaw.ssh-tunnel
```

---

## Linux (systemd user service)

Create `~/.config/systemd/user/hyperclaw-ssh-tunnel.service`:

```ini
[Unit]
Description=HyperClaw SSH tunnel to remote gateway
After=network.target

[Service]
ExecStart=/usr/bin/ssh -N remote-gateway
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Enable and start:

```bash
systemctl --user enable hyperclaw-ssh-tunnel
systemctl --user start hyperclaw-ssh-tunnel
```

---

## Troubleshooting

**Check if tunnel is running:**
```bash
ps aux | grep "ssh -N remote-gateway" | grep -v grep
lsof -i :18789
```

**Restart the tunnel (macOS):**
```bash
launchctl kickstart -k gui/$UID/ai.hyperclaw.ssh-tunnel
```

**Stop the tunnel (macOS):**
```bash
launchctl bootout gui/$UID/ai.hyperclaw.ssh-tunnel
```

---

## How It Works

| Component | What it does |
|-----------|--------------|
| `LocalForward 18789 127.0.0.1:18789` | Forwards local port 18789 to remote port 18789 |
| `ssh -N` | SSH without executing remote commands (port forwarding only) |
| `KeepAlive` | Restarts tunnel if it crashes |
| `RunAtLoad` | Starts tunnel when the agent loads |

HyperClaw connects to `http://127.0.0.1:18789` on your client. The SSH tunnel forwards that to the remote gateway.

---

## Related

- [Remote Access](remote-access.md) — Overview and credential precedence
- [Tailscale](tailscale.md) — Alternative to SSH for tailnet access
