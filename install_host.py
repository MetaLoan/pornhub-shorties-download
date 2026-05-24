#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
install_host.py — Cross-platform installer for the Shorties Downloader
native messaging host.

Registers `com.shorties.downloader` so that the browser extension (with
the fixed ID baked into manifest.json) can invoke the bundled host.

Supported targets:
  - Windows: writes HKCU registry values for Chrome and Edge
  - macOS  : drops the JSON manifest into the per-user NativeMessagingHosts dirs
  - Linux  : same idea, into ~/.config/google-chrome/NativeMessagingHosts/ etc.

Usage (after running build_host.py and producing dist/shorties_host[.exe]):
    python3 install_host.py            # auto-detect platform, install for all browsers
    python3 install_host.py --uninstall
    python3 install_host.py --host-binary /custom/path/to/shorties_host
"""

import argparse
import json
import os
import platform
import shutil
import sys
from pathlib import Path

HOST_NAME = "com.shorties.downloader"
# Stable extension ID derived from the public key baked into manifest.json's
# "key" field. The algorithm: SHA-256(SPKI-DER), take first 16 bytes, then
# map each nibble (4 bits) to a-p — yielding 32 characters.
EXTENSION_ID = "djnbhglpkggbgibmdnngpklojeepikil"
ALLOWED_ORIGINS = [f"chrome-extension://{EXTENSION_ID}/"]

ROOT = Path(__file__).resolve().parent
SYSTEM = platform.system()
IS_WINDOWS = SYSTEM == "Windows"
IS_MACOS = SYSTEM == "Darwin"
IS_LINUX = SYSTEM == "Linux"


# ---------------- Browser locations ---------------- #

def manifest_dirs():
    """Per-user directories where browsers look for native-messaging manifests."""
    home = Path.home()
    if IS_MACOS:
        base = home / "Library" / "Application Support"
        return {
            "Google Chrome": base / "Google" / "Chrome" / "NativeMessagingHosts",
            "Microsoft Edge": base / "Microsoft Edge" / "NativeMessagingHosts",
            "Chromium": base / "Chromium" / "NativeMessagingHosts",
            "Brave": base / "BraveSoftware" / "Brave-Browser" / "NativeMessagingHosts",
            "Vivaldi": base / "Vivaldi" / "NativeMessagingHosts",
            "Opera": base / "com.operasoftware.Opera" / "NativeMessagingHosts",
        }
    if IS_LINUX:
        base = home / ".config"
        return {
            "Google Chrome": base / "google-chrome" / "NativeMessagingHosts",
            "Chromium": base / "chromium" / "NativeMessagingHosts",
            "Microsoft Edge": base / "microsoft-edge" / "NativeMessagingHosts",
            "Brave": base / "BraveSoftware" / "Brave-Browser" / "NativeMessagingHosts",
            "Vivaldi": base / "vivaldi" / "NativeMessagingHosts",
            "Opera": base / "opera" / "NativeMessagingHosts",
        }
    # On Windows there is no flat directory — the manifest path is stored as a
    # registry value, and we point that value at a JSON file we drop here.
    raise NotImplementedError("manifest_dirs() is filesystem-only — Windows uses registry")


WINDOWS_REGISTRY_KEYS = {
    # browser display -> (HKCU subkey, manifest JSON file basename anchor)
    "Google Chrome": r"Software\Google\Chrome\NativeMessagingHosts",
    "Microsoft Edge": r"Software\Microsoft\Edge\NativeMessagingHosts",
    "Chromium": r"Software\Chromium\NativeMessagingHosts",
    "Brave": r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
    "Vivaldi": r"Software\Vivaldi\NativeMessagingHosts",
    "Opera": r"Software\Opera Software\Opera Stable\NativeMessagingHosts",
}


# ---------------- Install location for the binary ---------------- #

def install_root() -> Path:
    """Per-user directory where we copy the host binary + JSON manifest."""
    if IS_WINDOWS:
        base = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
    elif IS_MACOS:
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share")))
    return base / "ShortiesDownloader"


def default_bundle_dir() -> Path:
    """Guess where build_host.py left the onedir bundle."""
    sysname, arch = _plat_tags()
    tagged = ROOT / "dist" / f"shorties_host-{sysname}-{arch}"
    plain = ROOT / "dist" / "shorties_host"
    if tagged.is_dir():
        return tagged
    return plain


def bundle_entry_exe(bundle_dir: Path) -> Path:
    return bundle_dir / ("shorties_host.exe" if IS_WINDOWS else "shorties_host")


def _plat_tags():
    if IS_WINDOWS:
        return "windows", "x64"
    if IS_MACOS:
        return "macos", "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
    if IS_LINUX:
        return "linux", "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
    return SYSTEM.lower(), platform.machine().lower()


# ---------------- Manifest writing ---------------- #

def build_manifest(host_binary_path: Path) -> dict:
    return {
        "name": HOST_NAME,
        "description": "Shorties Downloader Native Helper",
        "path": str(host_binary_path),
        "type": "stdio",
        "allowed_origins": list(ALLOWED_ORIGINS),
    }


def write_manifest_file(target_dir: Path, manifest: dict) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    p = target_dir / f"{HOST_NAME}.json"
    with open(p, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    return p


# ---------------- Installers per OS ---------------- #

def install_unix(host_binary: Path) -> list:
    """Drop a copy of the manifest into each browser's NativeMessagingHosts dir."""
    out = []
    for browser, d in manifest_dirs().items():
        try:
            p = write_manifest_file(d, build_manifest(host_binary))
            out.append((browser, str(p), "ok"))
        except Exception as e:
            out.append((browser, str(d), f"skip: {e}"))
    return out


def install_windows(manifest_json_path: Path) -> list:
    """Write HKCU registry values pointing at the manifest JSON file."""
    import winreg  # type: ignore  # Windows-only

    # The manifest file path goes into the registry; the JSON content goes
    # to a stable filesystem location managed by install_root().
    out = []
    for browser, subkey in WINDOWS_REGISTRY_KEYS.items():
        try:
            full_key = subkey + "\\" + HOST_NAME
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, full_key) as k:
                winreg.SetValueEx(k, "", 0, winreg.REG_SZ, str(manifest_json_path))
            out.append((browser, f"HKCU\\{full_key}", "ok"))
        except Exception as e:
            out.append((browser, subkey, f"skip: {e}"))
    return out


def uninstall_unix() -> list:
    out = []
    for browser, d in manifest_dirs().items():
        p = d / f"{HOST_NAME}.json"
        if p.exists():
            try:
                p.unlink()
                out.append((browser, str(p), "removed"))
            except Exception as e:
                out.append((browser, str(p), f"error: {e}"))
        else:
            out.append((browser, str(p), "missing"))
    return out


def uninstall_windows() -> list:
    import winreg  # type: ignore

    out = []
    for browser, subkey in WINDOWS_REGISTRY_KEYS.items():
        full_key = subkey + "\\" + HOST_NAME
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, full_key)
            out.append((browser, f"HKCU\\{full_key}", "removed"))
        except FileNotFoundError:
            out.append((browser, full_key, "missing"))
        except Exception as e:
            out.append((browser, full_key, f"error: {e}"))
    return out


# ---------------- Top-level ---------------- #

def install(bundle_arg):
    """Install the host bundle.

    `bundle_arg` may be either the bundle directory itself or the entry
    executable inside it; both are accepted for convenience. If omitted,
    we look for the platform-tagged bundle that build_host.py emits.
    """
    if bundle_arg:
        candidate = Path(bundle_arg).expanduser().resolve()
        if candidate.is_dir():
            src_bundle = candidate
        elif candidate.is_file():
            src_bundle = candidate.parent
        else:
            print(f"ERROR: not found: {candidate}", file=sys.stderr)
            sys.exit(1)
    else:
        src_bundle = default_bundle_dir()

    if not src_bundle.is_dir() or not bundle_entry_exe(src_bundle).exists():
        print(f"ERROR: host bundle not found: {src_bundle}", file=sys.stderr)
        print("Run `python3 build_host.py` first to produce dist/shorties_host-<plat>-<arch>/.",
              file=sys.stderr)
        sys.exit(1)

    root = install_root()
    root.mkdir(parents=True, exist_ok=True)

    # Replace the bundle dir wholesale so stale files don't linger.
    bundle_dir_name = "host"
    dst_bundle = root / bundle_dir_name
    if dst_bundle.exists():
        shutil.rmtree(dst_bundle)
    shutil.copytree(src_bundle, dst_bundle, symlinks=True)
    dst_bin = bundle_entry_exe(dst_bundle)
    if not IS_WINDOWS:
        os.chmod(dst_bin, 0o755)
    print(f"installed bundle -> {dst_bundle}")
    print(f"  entry exe     -> {dst_bin}")

    manifest_json = write_manifest_file(root, build_manifest(dst_bin))
    print(f"installed manifest -> {manifest_json}")

    print()
    print("Registering with browsers …")
    if IS_WINDOWS:
        results = install_windows(manifest_json)
    else:
        results = install_unix(dst_bin)

    for browser, where, status in results:
        print(f"  [{status:>10}] {browser}: {where}")

    print()
    print("Done. Reload the extension in your browser, then test a download.")


def uninstall():
    print("Removing browser registrations …")
    if IS_WINDOWS:
        results = uninstall_windows()
    else:
        results = uninstall_unix()
    for browser, where, status in results:
        print(f"  [{status:>10}] {browser}: {where}")

    root = install_root()
    if root.exists():
        try:
            for p in root.iterdir():
                if p.is_dir():
                    shutil.rmtree(p)
                else:
                    p.unlink()
            root.rmdir()
            print(f"removed install dir: {root}")
        except Exception as e:
            print(f"  warn: could not fully remove {root}: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uninstall", action="store_true",
                    help="Remove the host registration instead of installing.")
    ap.add_argument("--bundle", default=None,
                    help="Path to the prebuilt host bundle directory (or the "
                         "entry exe inside it). Default: ./dist/shorties_host-<plat>-<arch>/.")
    args = ap.parse_args()

    if args.uninstall:
        uninstall()
    else:
        install(args.bundle)


if __name__ == "__main__":
    main()
