# macOS App Release & Auto-Update

## Release Checklist (OpenClaw-level hardening)

### Pre-release

- [ ] Run `npm run macos:test` — unit tests pass
- [ ] Run `npm run macos:build` — build succeeds locally
- [ ] Verify Connect tab: gateway URL, auth token, pairing
- [ ] Verify Chat tab: send message, receive response, session restore
- [ ] Verify Devices tab: shows paired nodes (if any)
- [ ] Verify Settings: launch at login, notifications toggle

### Versioning

1. **Bump version** in `apps/macos/package.json`
2. **Commit and tag**: `git tag v5.0.0`
3. **Push tag**: `git push origin v5.0.0`
4. **GitHub Action** `.github/workflows/macos-release.yml` runs:
   - Builds the app
   - Creates a GitHub Release
   - Uploads `.dmg`, `.zip`, and `appcast.xml` artifacts

## Auto-Update

The app uses `electron-updater` with GitHub provider. When packaged:

- On launch, it checks `https://github.com/{owner}/{repo}/releases` for newer versions
- Infers `owner`/`repo` from the git remote used to build
- `GITHUB_TOKEN` is not needed for *checking* updates (public API)
- For *publishing* from CI, `GITHUB_TOKEN` is used automatically
- The release workflow also emits `appcast.xml` for Sparkle-style metadata / parity tooling

## Code Signing & Notarization (macOS)

For distribution outside the Mac App Store:

1. **Apple Developer Account** – required
2. **Certificates**: `Developer ID Application`
3. **Export before build**:
   ```bash
   export CSC_LINK=/path/to/certificate.p12
   export CSC_KEY_PASSWORD=your_password
   export APPLE_ID=your@email.com
   export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
   ```
4. electron-builder will sign and notarize when these are set

## Device / Node Management

The macOS app acts as a desktop node. Paired mobile nodes (iOS/Android) register via WebSocket:

- **Connect tab**: Configure gateway URL and auth token. After connecting, the app registers as a node.
- **Devices tab**: Lists connected nodes (from gateway `presence:list` or node registry).
- **Agent commands**: The agent can send `node_command` to mobile nodes (location, sms_send, contacts_list, calendar_events, notify, etc.).

For deeper node management (run gateway locally):

```bash
cd /path/to/hyperclaw
hyperclaw gateway start
# Then set Connect URL to ws://localhost:18789
```
