# Releasing

1. Branch, bump the version in **both** `package.json` and `src-tauri/Cargo.toml` (they must match), merge to `main`.
2. Tag the merge commit and push the tag:
   ```
   git tag v1.0.1 && git push origin v1.0.1
   ```
3. The **Release** workflow tests the game, builds the apps and creates a **draft** GitHub release. Review it and click Publish.

To rehearse without a tag: Actions → Release → Run workflow (builds everything, creates no release).

## What a release contains

| File | For |
|------|-----|
| `15-Steps-X-mac-universal.dmg` | Mac (Apple Silicon and Intel) |
| `15-Steps-X-windows-portable.exe` | Windows, standalone: one file, no install |
| `15-Steps-X-windows-setup.exe` | Windows installer |
| `15-Steps-X-source.zip` | Source |
| `SHA256SUMS.txt` | Checksums |

## Unsigned builds

The apps are not code-signed yet, so the first launch shows a warning.
- **Mac:** right-click the app → Open (once), or System Settings → Privacy & Security → Open Anyway.
- **Windows:** SmartScreen says "Windows protected your PC": More info → Run anyway.
Signing needs an Apple Developer account and a Windows code-signing certificate; both can be added to the workflow later with secrets.

Windows needs the WebView2 runtime, which is built into Windows 10/11.

## Android (planned)

The desktop apps are [Tauri 2](https://tauri.app) shells around the web UI, and Tauri 2 also builds Android from the same code (`src-tauri/src/lib.rs` is already laid out for it). Steps when we get there: install the Android SDK/NDK and Rust, run `npm run tauri android init`, make the table layout work on a phone-sized screen, then add an Android job to `release.yml` that attaches a signed `.apk`.
