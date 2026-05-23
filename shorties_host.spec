# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the Shorties Downloader native host.

Run via the build_host.py wrapper:
    python3 build_host.py

The spec resolves yt-dlp / ffmpeg binaries from ./vendor/<platform>/
(prepared by build_host.py) and bundles them next to native_host.py
into a single executable named `shorties_host[.exe]`.
"""

import os
import sys
import platform

block_cipher = None

SYSTEM = platform.system()
IS_WINDOWS = SYSTEM == "Windows"
IS_MACOS = SYSTEM == "Darwin"

PLATFORM_DIR = {
    "Windows": "windows",
    "Darwin": "macos",
    "Linux": "linux",
}[SYSTEM]

VENDOR_DIR = os.path.abspath(os.path.join("vendor", PLATFORM_DIR))

EXE_SUFFIX = ".exe" if IS_WINDOWS else ""
yt_dlp_src = os.path.join(VENDOR_DIR, "yt-dlp" + EXE_SUFFIX)
ffmpeg_src = os.path.join(VENDOR_DIR, "ffmpeg" + EXE_SUFFIX)

binaries = []
for src in (yt_dlp_src, ffmpeg_src):
    if not os.path.exists(src):
        raise SystemExit(
            f"Missing vendor binary: {src}\n"
            "Run build_host.py — it downloads them before invoking PyInstaller."
        )
    # ('.', dest='.') puts the file at the root of _MEIPASS.
    binaries.append((src, "."))

a = Analysis(
    ["native_host.py"],
    pathex=[],
    binaries=binaries,
    datas=[],
    hiddenimports=[],
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "test", "unittest"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="shorties_host",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,           # native-messaging hosts MUST keep stdio attached
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
