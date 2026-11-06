# Releasing

1. Branch, bump the version in **both** `package.json` and `src-tauri/Cargo.toml` (they must match), merge to `main`.
2. Tag the merge commit and push the tag:
   ```
   git tag v1.0.1 && git push origin v1.0.1
   ```
3. The **Release** workflow tests the game, builds the apps (Mac, Windows and a signed Android APK) and creates a **draft** GitHub release. Review it and click Publish.

To rehearse without a tag: Actions → Release → Run workflow (builds everything, creates no release).

## What a release contains

| File | For |
|------|-----|
| `15-Steps-X-mac-universal.dmg` | Mac (Apple Silicon and Intel) |
| `15-Steps-X-windows-portable.exe` | Windows, standalone: one file, no install |
| `15-Steps-X-windows-setup.exe` | Windows installer |
| `15-Steps-X-android.apk` | Android phones (64-bit), signed |
| `15-Steps-X-source.zip` | Source |
| `SHA256SUMS.txt` | Checksums |

## Unsigned builds

The apps are not code-signed yet, so the first launch shows a warning.
- **Mac:** right-click the app → Open (once), or System Settings → Privacy & Security → Open Anyway.
- **Windows:** SmartScreen says "Windows protected your PC": More info → Run anyway.
Signing needs an Apple Developer account and a Windows code-signing certificate; both can be added to the workflow later with secrets.

Windows needs the WebView2 runtime, which is built into Windows 10/11.

## Android

The Android project is generated into `src-tauri/gen/android` (committed; build output is ignored). It is locked to landscape and fullscreen (system bars hidden; a swipe from the edge shows them), with content kept clear of the camera cut-out (`MainActivity.kt`). The phone layout is the "Compact" section at the end of `src/ui/styles.css` (see CLAUDE.md); on a phone there is room for 4 players (3 opponents, or 4 when watching). Tested on a Samsung Galaxy S22. The release APK is 64-bit ARM only (`--target aarch64`), which covers essentially every phone made since about 2017.

### Signing key

An APK must be signed, and **every update must be signed with the same key**, or phones refuse to install it over the old version. The key was made once with `keytool` and lives outside the repository (`~/.android-keys/15-steps-release.jks`, with its passwords in `15-steps-keystore.properties`). **Back both files up somewhere safe (a password manager); if the key is lost, existing installs can never be updated.** Never commit them.

Gradle (`app/build.gradle.kts`) signs the release build when it finds a key, from either place, and otherwise leaves the APK unsigned:
- **Your machine:** copy the properties file to `src-tauri/gen/android/keystore.properties` (git-ignored).
- **CI:** four repository secrets (Settings → Secrets and variables → Actions):
  ```
  P=~/.android-keys/15-steps-keystore.properties
  get() { sed -n "s/^$1=//p" "$P"; }
  gh secret set ANDROID_KEYSTORE_BASE64   --body "$(base64 -i ~/.android-keys/15-steps-release.jks)"
  gh secret set ANDROID_KEYSTORE_PASSWORD --body "$(get storePassword)"
  gh secret set ANDROID_KEY_ALIAS         --body "$(get keyAlias)"
  gh secret set ANDROID_KEY_PASSWORD      --body "$(get keyPassword)"
  gh secret list
  ```
  (`--body` gives each value on the command line; without it `gh secret set` waits for you to type the value, which swallows the following pasted lines.)
The **Release** workflow's `android` job decodes the key on a tag push, builds, checks the signature with `apksigner verify`, and attaches `15-Steps-X-android.apk`. On a dry run (no tag) it builds an unsigned APK and attaches nothing. A tag build fails if the secrets are missing.

The version code is derived from the version in `tauri.conf.json`/`package.json` (1.1.0 → 1001000), so each release bump is automatically an upgrade.

### Building

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

Build a signed release APK: `npm run tauri android build -- --apk --target aarch64` (the file is `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`). Build a debug APK: `npm run tauri android build -- --debug --apk --target aarch64`, then `adb install` the file under `src-tauri/gen/android/app/build/outputs/apk/`. Live on a connected phone: `npm run tauri android dev`.
