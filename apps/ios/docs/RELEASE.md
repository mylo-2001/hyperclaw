# iOS App Release Checklist

Native iOS node release checklist for HyperClaw.

## Pre-release

- [ ] Generate the Xcode project: `xcodegen generate`
- [ ] Build the simulator target from `apps/ios`
- [ ] Verify Connect: Bonjour discovery, manual URL, gateway token auth
- [ ] Verify node registration: gateway shows the device as an `ios` node
- [ ] Verify Chat: send message, receive response, session restore after reconnect
- [ ] Verify Voice: microphone + speech recognition permissions and transcription
- [ ] Verify Canvas: `/dashboard#canvas` loads from the paired gateway

## Signing

1. Set `DEVELOPMENT_TEAM` in `project.yml`
2. Open `HyperClaw.xcodeproj` in Xcode
3. Configure signing for Debug/Release
4. Archive via Xcode Organizer for TestFlight or Ad Hoc distribution

## Notes

- The app stores gateway URL, auth token, agent name, and last session locally.
- Pairing works against a protected gateway when the shared auth token is set.
