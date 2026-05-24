# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the Shorties Downloader native host.

Uses --onedir layout (EXE + COLLECT) instead of --onefile because the
single-file mode embeds Python3.framework as a runtime-extracted blob
that ends up with NO codesign signature — and macOS Gatekeeper then
rejects it as "damaged". In onedir mode the framework is a real on-disk
sibling that can be ad-hoc-signed alongside the main executable.

yt-dlp is consumed as an IMPORTED LIBRARY here (collect_all('yt_dlp')),
not a sibling binary. The official yt-dlp_macos build is itself a
PyInstaller --onefile that extracts its own unsigned Python.framework at
runtime — when launched as a child of our Hardened-Runtime'd host the
inner framework fails library validation and macOS pops up
"Python.framework is damaged". Linking yt_dlp into our own Python avoids
the second bootloader entirely.

Run via the build_host.py wrapper:
    python3 build_host.py
"""

import os
import platform

from PyInstaller.utils.hooks import collect_all

block_cipher = None

SYSTEM = platform.system()
IS_WINDOWS = SYSTEM == "Windows"

PLATFORM_DIR = {
    "Windows": "windows",
    "Darwin": "macos",
    "Linux": "linux",
}[SYSTEM]

VENDOR_DIR = os.path.abspath(os.path.join("vendor", PLATFORM_DIR))

EXE_SUFFIX = ".exe" if IS_WINDOWS else ""
ffmpeg_src = os.path.join(VENDOR_DIR, "ffmpeg" + EXE_SUFFIX)
if not os.path.exists(ffmpeg_src):
    raise SystemExit(
        f"Missing vendor binary: {ffmpeg_src}\n"
        "Run build_host.py — it downloads it before invoking PyInstaller."
    )

# Pull in every submodule + data file yt-dlp needs (extractors, postprocessors).
yt_datas, yt_binaries, yt_hidden = collect_all("yt_dlp")

a = Analysis(
    ["native_host.py"],
    pathex=[],
    binaries=yt_binaries + [(ffmpeg_src, ".")],
    datas=yt_datas,
    hiddenimports=yt_hidden,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "test", "unittest"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# onedir mode: EXE() with exclude_binaries=True + COLLECT() to assemble
# the directory layout that ships to users.
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="shorties_host",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,           # native messaging hosts MUST keep stdio attached
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="shorties_host",
)
