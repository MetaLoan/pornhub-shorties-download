#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_host.py — Cross-platform builder for the Shorties Downloader native host.

What this does:
  1. Detects the current OS / CPU arch.
  2. Downloads the matching yt-dlp + ffmpeg binaries into ./vendor/<platform>/
     if they're not already there.
  3. Invokes PyInstaller with shorties_host.spec to produce a single-file
     `dist/shorties_host[.exe]`.

You must run this on EACH target platform separately — there is no
single-machine cross-compile path for PyInstaller. Suggested matrix:
  - Windows 10/11 (x64)         -> shorties_host.exe
  - macOS Apple Silicon (arm64) -> shorties_host-macos-arm64
  - macOS Intel (x86_64)        -> shorties_host-macos-x64
  - Linux x86_64                -> shorties_host-linux-x64
"""

import argparse
import io
import os
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
DIST = ROOT / "dist"


# ----------- Platform detection ----------- #

def detect_platform():
    sysname = platform.system()
    machine = platform.machine().lower()

    if sysname == "Windows":
        return "windows", "x64"
    if sysname == "Darwin":
        return "macos", "arm64" if machine in ("arm64", "aarch64") else "x64"
    if sysname == "Linux":
        return "linux", "arm64" if machine in ("aarch64", "arm64") else "x64"
    raise SystemExit(f"Unsupported platform: {sysname} / {machine}")


# Each value is a list of mirrors. We try them in order.
YT_DLP_URLS = {
    ("windows", "x64"): [
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
    ],
    ("macos", "arm64"): [
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
    ],
    ("macos", "x64"): [
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos_legacy",
    ],
    ("linux", "x64"): [
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
    ],
    ("linux", "arm64"): [
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64",
    ],
}

# ffmpeg static-build mirrors. We download an archive and pull out a single
# `ffmpeg(.exe)`.
FFMPEG_ARCHIVES = {
    ("windows", "x64"): {
        "url": "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip",
        "kind": "zip",
        "member_glob": "bin/ffmpeg.exe",
    },
    ("macos", "arm64"): {
        "url": "https://www.osxexperts.net/ffmpeg7arm.zip",
        "kind": "zip",
        "member_glob": "ffmpeg",
    },
    ("macos", "x64"): {
        "url": "https://www.osxexperts.net/ffmpeg7intel.zip",
        "kind": "zip",
        "member_glob": "ffmpeg",
    },
    ("linux", "x64"): {
        "url": "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz",
        "kind": "tar.xz",
        "member_glob": "ffmpeg",
    },
    ("linux", "arm64"): {
        "url": "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz",
        "kind": "tar.xz",
        "member_glob": "ffmpeg",
    },
}


# ----------- Helpers ----------- #

def log(msg):
    print(f"[build] {msg}", flush=True)


def download(url: str, dest: Path):
    log(f"download {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "shorties-build/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    log(f"  -> {dest} ({dest.stat().st_size:,} bytes)")


def make_executable(p: Path):
    if platform.system() != "Windows":
        p.chmod(p.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def extract_member(archive_bytes: bytes, kind: str, member_glob: str, dest: Path):
    """Extract a single matching file from an archive into `dest`."""
    if kind == "zip":
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as zf:
            names = zf.namelist()
            match = next((n for n in names if n.endswith(member_glob) or os.path.basename(n) == member_glob),
                         None)
            if not match:
                raise SystemExit(f"No member matching {member_glob} in zip ({names[:5]}…)")
            log(f"  extracting {match}")
            with zf.open(match) as src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out)
    elif kind == "tar.xz":
        with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:xz") as tf:
            members = tf.getmembers()
            match = next((m for m in members if m.name.endswith(member_glob) or os.path.basename(m.name) == member_glob),
                         None)
            if not match:
                raise SystemExit(f"No member matching {member_glob} in tar")
            log(f"  extracting {match.name}")
            src = tf.extractfile(match)
            with open(dest, "wb") as out:
                shutil.copyfileobj(src, out)
    else:
        raise SystemExit(f"Unknown archive kind: {kind}")
    make_executable(dest)


def ensure_yt_dlp(platform_key, vendor_dir: Path):
    exe = vendor_dir / ("yt-dlp.exe" if platform_key[0] == "windows" else "yt-dlp")
    if exe.exists():
        log(f"yt-dlp already present at {exe}")
        return
    urls = YT_DLP_URLS.get(platform_key)
    if not urls:
        raise SystemExit(f"No yt-dlp URL configured for {platform_key}")
    last_err = None
    for url in urls:
        try:
            download(url, exe)
            make_executable(exe)
            return
        except Exception as e:
            last_err = e
            log(f"  failed: {e}")
    raise SystemExit(f"All yt-dlp downloads failed for {platform_key}: {last_err}")


def ensure_ffmpeg(platform_key, vendor_dir: Path):
    exe = vendor_dir / ("ffmpeg.exe" if platform_key[0] == "windows" else "ffmpeg")
    if exe.exists():
        log(f"ffmpeg already present at {exe}")
        return
    cfg = FFMPEG_ARCHIVES.get(platform_key)
    if not cfg:
        raise SystemExit(f"No ffmpeg archive configured for {platform_key}")
    log(f"download ffmpeg archive {cfg['url']}")
    req = urllib.request.Request(cfg["url"], headers={"User-Agent": "shorties-build/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read()
    log(f"  archive {len(data):,} bytes")
    extract_member(data, cfg["kind"], cfg["member_glob"], exe)
    log(f"  -> {exe} ({exe.stat().st_size:,} bytes)")


# ----------- Build ----------- #

def _is_mach_o(path: Path) -> bool:
    """Return True iff `path` looks like a Mach-O file we should sign."""
    try:
        with open(path, "rb") as f:
            head = f.read(4)
    except (OSError, PermissionError):
        return False
    # Mach-O magic numbers (LE/BE, 32/64-bit) + universal "fat" archive
    return head in (
        b"\xcf\xfa\xed\xfe",  # MH_MAGIC_64 (LE)
        b"\xce\xfa\xed\xfe",  # MH_MAGIC (LE)
        b"\xfe\xed\xfa\xcf",  # MH_MAGIC_64 (BE)
        b"\xfe\xed\xfa\xce",  # MH_MAGIC (BE)
        b"\xca\xfe\xba\xbe",  # FAT_MAGIC
        b"\xbe\xba\xfe\xca",  # FAT_CIGAM
    )


ENTITLEMENTS_PLIST = ROOT / "macos_entitlements.plist"


def _codesign(path: Path, with_entitlements: bool = False):
    cmd = ["codesign", "--force", "--sign", "-", "--timestamp=none",
           "--options", "runtime"]
    if with_entitlements and ENTITLEMENTS_PLIST.exists():
        cmd.extend(["--entitlements", str(ENTITLEMENTS_PLIST)])
    cmd.append(str(path))
    subprocess.check_call(cmd, stderr=subprocess.STDOUT)


def _codesign_macos_bundle(bundle_dir: Path):
    """Ad-hoc sign every Mach-O inside the onedir bundle (bottom-up).

    Order matters: child binaries first, then frameworks/dylibs, then the
    entry exe. codesign refuses to operate on a plain directory, so we
    can't `--deep` the whole bundle in one shot.
    """
    log(f"ad-hoc signing macOS bundle: {bundle_dir}")
    entry_exe = bundle_dir / "shorties_host"

    # 1. Sign all plain Mach-O files first (deepest paths first). These
    #    don't need entitlements — only the entry exe whose Hardened Runtime
    #    is what Gatekeeper actually evaluates needs them.
    mach_o_files = []
    for root, _, files in os.walk(bundle_dir):
        for fname in files:
            p = Path(root) / fname
            if p == entry_exe:
                continue
            if _is_mach_o(p):
                mach_o_files.append(p)
    mach_o_files.sort(key=lambda p: (-len(str(p)), str(p)))  # deepest first
    log(f"  signing {len(mach_o_files)} Mach-O leaves")
    for p in mach_o_files:
        try:
            _codesign(p)
        except subprocess.CalledProcessError as e:
            log(f"  WARNING: codesign failed for {p}: {e}")

    # 2. Frameworks are bundles — codesign accepts them directly. Use --deep
    #    so any internal binaries (e.g. inside Python3.framework/Versions)
    #    are signed too.
    for root, dirs, _ in os.walk(bundle_dir):
        for d in dirs:
            if d.endswith(".framework"):
                fw = Path(root) / d
                log(f"  signing framework {fw}")
                try:
                    subprocess.check_call(
                        ["codesign", "--force", "--deep", "--sign", "-",
                         "--timestamp=none", "--options", "runtime", str(fw)]
                    )
                except subprocess.CalledProcessError as e:
                    log(f"  WARNING: framework codesign failed for {fw}: {e}")

    # 3. Entry exe LAST, WITH Hardened Runtime entitlements that permit
    #    loading our ad-hoc-signed Python3.framework. Without these,
    #    library-validation would still reject the framework at launch.
    log(f"  signing entry exe {entry_exe} (hardened + entitlements)")
    try:
        _codesign(entry_exe, with_entitlements=True)
    except subprocess.CalledProcessError as e:
        log(f"  WARNING: entry codesign failed: {e}")
        return

    # 4. Verify.
    try:
        subprocess.check_call(["codesign", "--verify", "--verbose=2", str(entry_exe)])
        log("  codesign verify: OK")
    except subprocess.CalledProcessError as e:
        log(f"  WARNING: codesign verify failed: {e}")


def run_pyinstaller(platform_key, bundle_name: str):
    # Make sure PyInstaller is available
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        log("PyInstaller not installed. Install it first: pip install pyinstaller")
        raise SystemExit(1)

    spec = ROOT / "shorties_host.spec"
    # PyInstaller writes work files in build/<spec stem>, so wipe both
    # build/ and dist/<bundle name>/ for a clean rerun.
    if (DIST / "shorties_host").exists():
        shutil.rmtree(DIST / "shorties_host")
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
           "--distpath", str(DIST), str(spec)]
    log("running: " + " ".join(cmd))
    subprocess.check_call(cmd, cwd=ROOT)

    produced_dir = DIST / "shorties_host"
    if not produced_dir.is_dir():
        raise SystemExit(f"PyInstaller didn't produce {produced_dir}")

    # Rename the dir to be platform/arch-tagged so a single dist/ can hold
    # artifacts from multiple platforms during release prep.
    final_dir = DIST / bundle_name
    if final_dir.is_dir():
        shutil.rmtree(final_dir)
    elif final_dir.exists():
        final_dir.unlink()  # leftover onefile binary from older builds
    produced_dir.rename(final_dir)

    # macOS Gatekeeper rejects unsigned Mach-O files inside the bundle
    # (it'd report "Python3.framework damaged"). codesign can't recurse
    # into a plain directory, so we sign every Mach-O leaf bottom-up,
    # then the framework, then the entry exe. Ad-hoc identity (`-`) is
    # enough for user-installed hosts; for a public release, swap for a
    # Developer ID and notarize.
    if platform_key[0] == "macos":
        _codesign_macos_bundle(final_dir)

    # Roll a single archive for distribution.
    if platform_key[0] == "windows":
        archive_path = shutil.make_archive(str(final_dir), "zip", root_dir=str(DIST), base_dir=bundle_name)
    else:
        archive_path = shutil.make_archive(str(final_dir), "gztar", root_dir=str(DIST), base_dir=bundle_name)
    log(f"archive: {archive_path}")

    log(f"OK — bundle dir: {final_dir}")
    log(f"     entry exe:  {final_dir / ('shorties_host.exe' if platform_key[0] == 'windows' else 'shorties_host')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-vendor", action="store_true",
                    help="Don't (re)download yt-dlp / ffmpeg; assume vendor/ is populated.")
    ap.add_argument("--vendor-only", action="store_true",
                    help="Only download yt-dlp / ffmpeg; don't run PyInstaller.")
    args = ap.parse_args()

    plat = detect_platform()
    log(f"platform = {plat[0]}-{plat[1]}")

    vendor_dir = VENDOR / plat[0]
    vendor_dir.mkdir(parents=True, exist_ok=True)

    if not args.skip_vendor:
        ensure_yt_dlp(plat, vendor_dir)
        ensure_ffmpeg(plat, vendor_dir)

    if args.vendor_only:
        return

    bundle_name = f"shorties_host-{plat[0]}-{plat[1]}"
    DIST.mkdir(parents=True, exist_ok=True)
    run_pyinstaller(plat, bundle_name)


if __name__ == "__main__":
    main()
