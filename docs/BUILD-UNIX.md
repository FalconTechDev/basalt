# Linux and macOS builds

`node build-unix.mjs [--version 0.3.9] [--targets linux-x64,mac-arm64,mac-x64]` writes, into `dist/`:

| File | Contents |
| --- | --- |
| `Basalt-<version>-linux-x64.tar.gz` | folder `basalt-linux-x64/`: stock Electron 39.8.6 with `electron` renamed to `basalt`, `resources/app` (the launcher from `stub/`), `resources/app-src` (the app from `src/`), `basalt.sh`, `install-desktop.sh`, `basalt.desktop`, `icon.png` |
| `Basalt-<version>-mac-arm64.zip`, `Basalt-<version>-mac-x64.zip` | `Basalt.app` (Electron.app renamed; executable, helper apps, `Info.plist` and bundle id `com.falcontech.basalt` changed; `basalt.icns` made from `branding/icon.png`) |

The script has no dependencies. It reads the stock Electron zips (`electron-v39.8.6-<platform>-<arch>.zip` from github.com/electron/electron/releases) from `--electron-dir`, `dist/unix-cache` or `%LOCALAPPDATA%\electron\Cache`, checks each against `SHASUMS256.txt` when that file lies beside it, edits the entries in memory and writes the archive itself, so symlinks (the macOS frameworks) and executable bits survive on Windows too. It packages `src/` and `stub/` exactly as they are (like `build-installer.mjs --skip-build`); it never runs `brand.mjs` or `build-canvas.mjs`.

## Per-OS helpers

The terminal (`basalt-pty`, `pty-helper/`) and the command line (`basalt-cli`, `cli/`) are Rust programs built per OS. `build-unix.mjs` copies whatever is in `dist/unix-bin/<os>-<arch>/` (`linux-x64`, `mac-arm64`, `mac-x64`) into `resources/app-src/bin/`. To make the Linux ones, on Linux or in WSL2:

```bash
(cd pty-helper && cargo build --release) && (cd cli && cargo build --release)
mkdir -p dist/unix-bin/linux-x64 && cp pty-helper/target/release/basalt-pty cli/target/release/basalt-cli dist/unix-bin/linux-x64/
```

The macOS archives ship **without** them (they need a Mac or a cross toolchain). Without `basalt-pty` the terminal card and tab show "no basalt-pty helper for this platform, terminal disabled" and nothing else breaks. To add them, build on a Mac and put them in `dist/unix-bin/mac-<arch>/` before running the script.

## Linux

```
tar xzf Basalt-0.3.9-linux-x64.tar.gz && cd basalt-linux-x64
./basalt.sh               # starts Basalt
./install-desktop.sh      # optional: menu entry and ~/.local/bin/basalt
```

Chromium needs a sandbox. `basalt.sh` checks that `chrome-sandbox` is owned by root with mode 4755 or that user namespaces work; if neither is true it prints a note and starts with `--no-sandbox`. To keep the sandbox: `sudo chown root chrome-sandbox && sudo chmod 4755 chrome-sandbox` (Ubuntu 24.04 and later restrict user namespaces, so this is the usual fix there). Needs glibc, GTK 3, NSS, libgbm and ALSA, as any Electron app does.

## macOS

The app is **not signed and not notarized**, and it has not been run on a Mac by the author of this build script (only checked statically: archive, symlinks, plists and Mach-O headers). After unzipping, move `Basalt.app` to Applications and then either right-click it, choose Open and confirm, or run

```
xattr -cr /Applications/Basalt.app
```

to remove the quarantine flag. If macOS still says the app is damaged or will not start on Apple silicon, sign it ad hoc: `codesign --force --deep --sign - /Applications/Basalt.app`. The `basalt://` URL scheme is not registered in `Info.plist` yet. The in-app updater only installs on Windows; elsewhere it opens the release page.

## What was checked, and how

Linux: the tar.gz was extracted and run in WSL2 (Ubuntu) with `--ozone-platform=headless`, a temporary profile and `--remote-debugging-port`; `tools/app-smoke.mjs` then ran against a temporary vault. The macOS builds were only inspected (see above).
