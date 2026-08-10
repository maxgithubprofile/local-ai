# device-e2e

**Not part of `npm test`** (TZ §13.5) — everything here requires a real Android/iOS device or
emulator/simulator: the actual Capacitor native bridge, `@capgo/capacitor-device-info` sensor
readings, `@capgo/capacitor-downloader` backgrounding/process-kill behavior, and end-to-end
`checkSupport → checkDeviceEligibility → download → load → generate`.

- Not wired into `vitest.config.ts`'s default include; `package.json`'s `test` script never touches
  this directory.
- Runner/tooling choice (Appium/Detox vs. a manual checklist) is open — TZ §16.12, §13.5.
- Until Phase 0/7 pick a runner, treat this as a manual QA checklist per phase — see `ROADMAP.md`.
