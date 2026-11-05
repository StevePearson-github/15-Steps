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

## Android (in progress)

The Android project is generated into `src-tauri/gen/android` (committed; build output is ignored). It is locked to landscape and fullscreen (system bars hidden; a swipe from the edge shows them), with content kept clear of the camera cut-out (`MainActivity.kt`). The phone layout is the "Compact" section at the end of `src/ui/styles.css` (see CLAUDE.md); on a phone there is room for 4 players (3 opponents, or 4 when watching). Tested on a Samsung Galaxy S22 (touch, dragging, dialogs). Not yet done: a signed release build and a CI job.

One-time setup on a Mac (Homebrew):
```
brew install --cask temurin@17 android-commandlinetools
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;28.2.13676358"
export NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```
(With Homebrew's `rustup`, also put `/opt/homebrew/opt/rustup/bin` on your PATH.)

Build a debug APK: `npm run tauri android build -- --debug --apk --target aarch64`, then `adb install` the file under `src-tauri/gen/android/app/build/outputs/apk/`. Live on a connected phone: `npm run tauri android dev`.
