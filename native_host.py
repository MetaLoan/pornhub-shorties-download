#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
native_host.py — Chromium Native Messaging host for Shorties Downloader.

Designed to run in two modes:
  1. Source mode: `python3 native_host.py`. Looks up yt-dlp/ffmpeg in PATH
     and common per-OS install locations.
  2. PyInstaller bundle: a single executable produced by build_host.py.
     The bundled yt-dlp/ffmpeg sit next to (or inside) the executable;
     we find them via sys._MEIPASS or the executable's directory.
"""

import sys
import json
import struct
import subprocess
import os
import platform
import logging

IS_WINDOWS = platform.system() == "Windows"
IS_MACOS = platform.system() == "Darwin"
IS_FROZEN = bool(getattr(sys, "frozen", False))

EXE_SUFFIX = ".exe" if IS_WINDOWS else ""


def host_data_dir():
    """Per-user dir for logs etc. — works in both frozen and source mode."""
    if IS_WINDOWS:
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~\\AppData\\Local")
    elif IS_MACOS:
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    d = os.path.join(base, "ShortiesDownloader")
    os.makedirs(d, exist_ok=True)
    return d


LOG_FILE = os.path.join(host_data_dir(), "native_debug.log")
logging.basicConfig(
    filename=LOG_FILE,
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s: %(message)s",
)
logging.info("Native host loaded (frozen=%s, platform=%s)", IS_FROZEN, platform.system())


# ---------- Native messaging framing ----------

def read_message():
    raw = sys.stdin.buffer.read(4)
    if not raw or len(raw) < 4:
        sys.exit(0)
    length = struct.unpack("@I", raw)[0]
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send_message(d):
    encoded = json.dumps(d).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("@I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


# ---------- Binary discovery ----------

def _bundled_dirs():
    """Directories where bundled yt-dlp/ffmpeg may live (frozen mode first)."""
    dirs = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        dirs.append(meipass)
        dirs.append(os.path.join(meipass, "bin"))
    if IS_FROZEN:
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        dirs.append(exe_dir)
        dirs.append(os.path.join(exe_dir, "bin"))
    # Source mode dev fallback: a local vendor/ next to this script.
    here = os.path.dirname(os.path.abspath(__file__))
    dirs.append(os.path.join(here, "vendor"))
    return dirs


def _system_search_paths():
    if IS_WINDOWS:
        candidates = []
        for v in ("LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"):
            base = os.environ.get(v)
            if base:
                candidates.append(os.path.join(base, "yt-dlp"))
                candidates.append(os.path.join(base, "ffmpeg", "bin"))
        return candidates
    if IS_MACOS:
        return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin",
                os.path.expanduser("~/.local/bin")]
    return ["/usr/local/bin", "/usr/bin", os.path.expanduser("~/.local/bin"),
            "/snap/bin"]


def _find_executable(name):
    exe_name = name + EXE_SUFFIX
    # 1. bundled
    for d in _bundled_dirs():
        cand = os.path.join(d, exe_name)
        if os.path.isfile(cand) and (IS_WINDOWS or os.access(cand, os.X_OK)):
            logging.info("found bundled %s at %s", name, cand)
            return cand
    # 2. PATH
    path_env = os.environ.get("PATH", "")
    extra = _system_search_paths()
    augmented_path = os.pathsep.join([p for p in extra if p] + [path_env])
    os.environ["PATH"] = augmented_path
    for d in augmented_path.split(os.pathsep):
        if not d:
            continue
        cand = os.path.join(d, exe_name)
        if os.path.isfile(cand) and (IS_WINDOWS or os.access(cand, os.X_OK)):
            logging.info("found %s on PATH at %s", name, cand)
            return cand
    logging.warning("could not locate %s anywhere", name)
    return None


def find_yt_dlp():
    return _find_executable("yt-dlp") or ("yt-dlp" + EXE_SUFFIX)


def find_ffmpeg():
    return _find_executable("ffmpeg")


# ---------- Main loop ----------

def downloads_dir():
    # Cross-platform Downloads folder
    if IS_WINDOWS:
        # Most reliable: USERPROFILE\Downloads
        return os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), "Downloads")
    return os.path.expanduser("~/Downloads")


def main():
    logging.info("main() started")
    yt_dlp_path = find_yt_dlp()
    logging.info("Resolved yt-dlp: %s", yt_dlp_path)
    ffmpeg_path = find_ffmpeg()
    logging.info("Resolved ffmpeg: %s", ffmpeg_path)

    import re
    progress_re = re.compile(r"\[download\]\s+([0-9.]+)%")

    while True:
        try:
            logging.info("Waiting for message from Chrome...")
            msg = read_message()
            logging.info("Received message: %s", msg)
            action = msg.get("action")

            if action != "download":
                logging.warning("Unknown action: %s", action)
                send_message({"status": "error", "message": f"Unknown action: {action}"})
                continue

            url = msg.get("url")
            proxy = msg.get("proxy")
            bypass_ssl = msg.get("bypassSsl", True)

            if not url:
                send_message({"status": "error", "message": "Missing URL parameter"})
                continue

            target_dir = downloads_dir()
            os.makedirs(target_dir, exist_ok=True)

            cmd = [yt_dlp_path, "-P", target_dir, "--newline"]
            if proxy:
                cmd.extend(["--proxy", proxy])
            if bypass_ssl:
                cmd.append("--no-check-certificate")
            cmd.extend(["--remux-video", "mp4"])
            if ffmpeg_path:
                cmd.extend(["--ffmpeg-location", os.path.dirname(ffmpeg_path)])
            cmd.append(url)

            logging.info("Starting process: %s", " ".join(cmd))

            # On Windows, hide the console window of the spawned yt-dlp process
            popen_kwargs = dict(
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                universal_newlines=True,
            )
            if IS_WINDOWS:
                popen_kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW

            process = subprocess.Popen(cmd, **popen_kwargs)

            while True:
                line = process.stdout.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                logging.debug("yt-dlp: %s", line)
                m = progress_re.search(line)
                if m:
                    send_message({"status": "progress", "percentage": m.group(1)})

            _stdout, stderr = process.communicate()
            return_code = process.returncode
            logging.info("Process exited with code: %s", return_code)

            if return_code == 0:
                send_message({
                    "status": "success",
                    "message": "视频已下载并保存到 Downloads 文件夹。",
                    "path": target_dir,
                })
            else:
                err_msg = (stderr or "").strip() or "下载器遇到错误"
                logging.error("Download failed: %s", err_msg)
                send_message({"status": "error", "message": f"yt-dlp 报错: {err_msg}"})

            logging.info("Exiting after download finished.")
            sys.stdout.buffer.flush()
            sys.exit(0)

        except SystemExit:
            raise
        except Exception as e:
            logging.exception("Exception in main loop:")
            try:
                send_message({"status": "error", "message": f"宿主服务异常: {e}"})
            except Exception:
                pass
            sys.exit(0)


if __name__ == "__main__":
    main()
