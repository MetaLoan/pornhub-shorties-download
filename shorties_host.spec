# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the Shorties Downloader native host.

Uses --onedir layout (EXE + COLLECT) instead of --onefile because the
single-file mode embeds Python3.framework as a runtime-extracted blob
that ends up with NO codesign signature — and macOS Gatekeeper then
rejects it as "damaged". In onedir mode the framework is a real on-disk
sibling that can be ad-hoc-signed alongside the main executable.

Run via the build_host.py wrapper:
    python3 build_host.py
"""

import os
import platform

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
yt_dlp_src = os.path.join(VENDOR_DIR, "yt-dlp" + EXE_SUFFIX)
ffmpeg_src = os.path.join(VENDOR_DIR, "ffmpeg" + EXE_SUFFIX)

binaries = []
for src in (yt_dlp_src, ffmpeg_src):
    if not os.path.exists(src):
        raise SystemExit(
            f"Missing vendor binary: {src}\n"
            "Run build_host.py — it downloads them before invoking PyInstaller."
        )
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
