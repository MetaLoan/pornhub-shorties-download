# Pornhub Shorties Downloader Helper

A Chromium-based browser extension that adds a one-click "download via
yt-dlp" button to Pornhub Shorties pages. The actual download is performed
by a tiny **native messaging host** that bundles `yt-dlp` + `ffmpeg`, so
users don't need to install anything by hand.

| Component | Where it runs | Built with |
|---|---|---|
| Browser extension (`manifest.json`, `background.js`, `popup.*`, `content.*`) | Chrome / Edge / Brave / Vivaldi / Opera / Chromium | MV3 + vanilla JS |
| Native host (`native_host.py`) | OS process talking stdio with the browser | Python, packaged with PyInstaller |

The extension has a **stable ID** (`dnhlkggbdnpljeii`) baked in via the
`key` field in `manifest.json`, so the native host's `allowed_origins`
matches on every machine, no matter how the extension was loaded.

---

## Supported platforms

| OS / Arch | Status |
|---|---|
| Windows 10 / 11 (x64) | ✅ |
| macOS Apple Silicon (arm64) | ✅ |
| macOS Intel (x86_64) | ✅ |
| Linux x86_64 | ✅ |
| Linux arm64 | ⚠️ Build works; not regularly tested |

---

## For end users — Install

1. Download the right `shorties_host-<platform>-<arch>[.exe]` from Releases.
2. Run `python3 install_host.py --host-binary path/to/shorties_host…`
   (or double-click the bundled installer when distributed).
   This:
   - copies the host to `~/Library/Application Support/ShortiesDownloader/` (mac),
     `~/.local/share/ShortiesDownloader/` (Linux), or
     `%LOCALAPPDATA%\ShortiesDownloader\` (Windows);
   - registers it with Chrome / Edge / Brave / Vivaldi / Opera / Chromium.
3. Install the extension in your browser (load unpacked, or from the
   web store once published). Because the `key` is fixed, the ID will
   always be `dnhlkggbdnpljeii`.

To uninstall: `python3 install_host.py --uninstall`.

---

## For developers — Build the native host

```sh
# 1. One-time: install PyInstaller
python3 -m pip install pyinstaller

# 2. Build (also downloads yt-dlp + ffmpeg for the current platform)
python3 build_host.py
# → produces ./dist/shorties_host-<platform>-<arch>[.exe]

# 3. Install it for the local browsers
python3 install_host.py

# 4. Load ./ as an unpacked extension in edge://extensions or
#    chrome://extensions, refresh a Shorties page, and try downloading.
```

`build_host.py` must be run **separately on each target OS** — PyInstaller
doesn't cross-compile. Use GitHub Actions or a VM matrix for releases.

### What ships inside the bundle

- The Python runtime (statically linked by PyInstaller bootloader).
- `yt-dlp` (latest GitHub release for that OS/arch).
- `ffmpeg` (static build pulled from BtbN on Windows, johnvansickle on
  Linux, osxexperts on macOS).

The `native_host.py` discovery logic looks first in
`sys._MEIPASS` / next to the exe, then falls back to `PATH` for
developer convenience when running un-frozen.

---

## Project layout

```
.
├── manifest.json              # extension manifest (with fixed "key")
├── background.js              # service worker: task queue, native bridge
├── content.js, content.css    # in-page floating panel + queue UI
├── popup.html / popup.js / popup.css  # toolbar popup + queue UI
├── icons/                     # extension icons
├── native_host.py             # native messaging host (Python)
├── shorties_host.spec         # PyInstaller recipe
├── build_host.py              # downloads vendor binaries + invokes PyInstaller
├── install_host.py            # cross-platform installer/uninstaller
├── vendor/<platform>/         # cached yt-dlp + ffmpeg per platform (gitignored)
├── dist/                      # PyInstaller output (gitignored)
└── extension.key.pem          # PRIVATE key for the extension ID — gitignored
```

### Signing key

`extension.key.pem` was generated with `openssl genrsa -out extension.key.pem 2048`
and the corresponding public key (base64-encoded SPKI DER) lives in
`manifest.json`'s `key` field. Treat the `.pem` file as a secret — anyone
who has it can publish an update signed as this extension.

When you eventually publish to Chrome Web Store / Edge Add-ons, repackage
with the same key (`chrome.exe --pack-extension=./ --pack-extension-key=extension.key.pem`)
so the published extension keeps the same ID.

---

## Architecture notes

- **Task queue** in `background.js` deduplicates by full URL, runs up to
  3 yt-dlp processes in parallel, and persists state to
  `chrome.storage.session` so re-opening the popup re-renders the queue.
- Tasks have a 60 s watchdog: if the host produces no progress / success /
  error for 60 s the task is force-failed so the UI never freezes.
- Both the popup *and* the in-page floating panel show the same queue,
  driven by `queue-update` broadcasts. The fan-out uses both
  `chrome.runtime.sendMessage` (for extension pages) and
  `chrome.tabs.sendMessage` (for content scripts).
- The native host exits after each download to avoid zombie processes;
  the next download spawns a fresh host via `connectNative`.
