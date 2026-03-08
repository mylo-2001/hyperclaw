<a name="top">
# Android App Release Checklist

<div align="center">

[🏠 Main README](../../../README.md) &nbsp;•&nbsp; [📚 Docs](docs/README.md)

</div>

---


Native Android node release checklist for HyperClaw.

## Pre-release

- [ ] Run unit tests from `apps/android`
- [ ] Build debug and release APK/AAB
- [ ] Verify Connect: gateway URL, token auth, reconnect
- [ ] Verify Chat: send/receive and transcript persistence
- [ ] Verify Voice: speech-to-text permission flow
- [ ] Verify Canvas: dashboard loads in WebView
- [ ] Verify node commands: location, notify, SMS, contacts, calendar, motion

## Build

```bash
cd apps/android
./gradlew assembleDebug
./gradlew assembleRelease
./gradlew bundleRelease
```

## Signing

1. Configure a signing config in `app/build.gradle`
2. Provide a release keystore via Gradle properties or CI secrets
3. Publish the generated AAB to Play Console if distributing through Google Play

## Notes

- The app already advertises mobile-node capabilities to the gateway.
- `ConnectionService` can be used for a persistent foreground connection when needed.

---

<div align="center">

[🏠 Main README](../../../README.md) &nbsp;•&nbsp; [📚 Docs](docs/README.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>
