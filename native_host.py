#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
native_host.py — Chromium Native Messaging host for Shorties Downloader.

Uses yt-dlp as an in-process Python library (NOT a subprocess), so we
don't end up with a second PyInstaller bootloader extracting its own
unsigned Python.framework into /tmp — which is what made macOS Gatekeeper
reject the download with "Python.framework is damaged".

ffmpeg is still kept as a sibling binary (it's a plain Mach-O, not a
PyInstaller bundle, so it doesn't have the embedded-framework problem).
"""

import sys
import json
import struct
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


# ---------- Bundled ffmpeg discovery ----------

def _bundled_dirs():
    dirs = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        dirs.append(meipass)
        dirs.append(os.path.join(meipass, "bin"))
    if IS_FROZEN:
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        dirs.append(exe_dir)
        dirs.append(os.path.join(exe_dir, "bin"))
        dirs.append(os.path.join(exe_dir, "_internal"))
    here = os.path.dirname(os.path.abspath(__file__))
    dirs.append(os.path.join(here, "vendor"))
    return dirs


def _system_search_paths_ffmpeg():
    if IS_WINDOWS:
        out = []
        for v in ("LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"):
            base = os.environ.get(v)
            if base:
                out.append(os.path.join(base, "ffmpeg", "bin"))
        return out
    if IS_MACOS:
        return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin",
                os.path.expanduser("~/.local/bin")]
    return ["/usr/local/bin", "/usr/bin", os.path.expanduser("~/.local/bin"),
            "/snap/bin"]


def find_ffmpeg():
    exe_name = "ffmpeg" + EXE_SUFFIX
    for d in _bundled_dirs():
        cand = os.path.join(d, exe_name)
        if os.path.isfile(cand) and (IS_WINDOWS or os.access(cand, os.X_OK)):
            logging.info("found bundled ffmpeg at %s", cand)
            return cand
    path_env = os.environ.get("PATH", "")
    augmented = os.pathsep.join(_system_search_paths_ffmpeg() + [path_env])
    os.environ["PATH"] = augmented
    for d in augmented.split(os.pathsep):
        if not d:
            continue
        cand = os.path.join(d, exe_name)
        if os.path.isfile(cand) and (IS_WINDOWS or os.access(cand, os.X_OK)):
            logging.info("found ffmpeg on PATH at %s", cand)
            return cand
    logging.warning("ffmpeg not found anywhere")
    return None


# ---------- Download driver ----------

def downloads_dir():
    if IS_WINDOWS:
        return os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), "Downloads")
    return os.path.expanduser("~/Downloads")


def detect_system_proxy():
    """Best-effort: return an http(s) proxy URL the user's OS is configured
    to use, or '' if none. This is what CLI yt-dlp gets for free; the
    library API doesn't pick it up automatically."""
    # 1. Standard env vars (set by some users / shells)
    for k in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
        v = os.environ.get(k)
        if v:
            return v
    # 2. Per-OS system settings
    try:
        if IS_MACOS:
            import subprocess
            r = subprocess.run(["scutil", "--proxy"], capture_output=True, text=True, timeout=2)
            host = port = None
            enabled = False
            for line in r.stdout.splitlines():
                line = line.strip()
                if line.startswith("HTTPEnable"):
                    enabled = line.endswith(": 1")
                elif line.startswith("HTTPProxy"):
                    host = line.split(":", 1)[1].strip()
                elif line.startswith("HTTPPort"):
                    port = line.split(":", 1)[1].strip()
            if enabled and host and port:
                return f"http://{host}:{port}"
        elif IS_WINDOWS:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r"Software\Microsoft\Windows\CurrentVersion\Internet Settings") as k:
                enabled, _ = winreg.QueryValueEx(k, "ProxyEnable")
                if enabled:
                    server, _ = winreg.QueryValueEx(k, "ProxyServer")
                    # ProxyServer may be host:port or "http=...;https=..."
                    if "=" in server:
                        for entry in server.split(";"):
                            if entry.lower().startswith("http="):
                                return "http://" + entry.split("=", 1)[1]
                    elif server:
                        return "http://" + server
        else:
            # Linux/other: rely on env vars only.
            pass
    except Exception as e:
        logging.warning("system proxy detection failed: %s", e)
    return ""


def run_download(url, proxy, bypass_ssl, ffmpeg_path):
    """Drive yt_dlp in-process and stream progress to the extension."""
    # Import lazily so a malformed install only kills the one request,
    # not the host's loop.
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    # If the caller didn't set an explicit proxy, fall back to whatever
    # the OS has configured — otherwise yt-dlp would go direct and fail
    # for users in geo-restricted regions.
    if not proxy:
        proxy = detect_system_proxy()
        if proxy:
            logging.info("auto-using system proxy: %s", proxy)

    target_dir = downloads_dir()
    os.makedirs(target_dir, exist_ok=True)

    last_pct = {"v": -1.0}

    def progress_hook(d):
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            downloaded = d.get("downloaded_bytes") or 0
            pct = (downloaded * 100.0 / total) if total else 0.0
            # Throttle: send only on >=0.5% change to avoid IPC flood
            if pct - last_pct["v"] >= 0.5 or pct >= 99.9:
                last_pct["v"] = pct
                try:
                    send_message({"status": "progress", "percentage": f"{pct:.1f}"})
                except Exception:
                    pass
        elif d.get("status") == "finished":
            try:
                send_message({"status": "progress", "percentage": "100.0"})
            except Exception:
                pass

    ydl_opts = {
        "paths": {"home": target_dir},
        "newline": True,
        "nocheckcertificate": bool(bypass_ssl),
        "noprogress": True,                # we use progress_hooks instead
        "progress_hooks": [progress_hook],
        # Match CLI default format selector. The library API's plain
        # "best" picks different formats than the CLI's
        # "bestvideo*+bestaudio/best" default, so align them.
        "format": "bestvideo*+bestaudio/best",
        # Match CLI retry behaviour. Pornhub HLS fragments transiently
        # 404; the CLI retries up to 10× per fragment and 10× per
        # request — the library API defaults to 0 retries and just
        # "skips unavailable fragments", which makes every Shorties
        # download fail with "The downloaded file is empty".
        "retries": 10,
        "fragment_retries": 10,
        "skip_unavailable_fragments": False,
        "quiet": True,
        "no_warnings": True,
        "logger": _make_logger(),
    }
    if proxy:
        ydl_opts["proxy"] = proxy
    if ffmpeg_path:
        ydl_opts["ffmpeg_location"] = os.path.dirname(ffmpeg_path)

    logging.info("yt_dlp opts: %s", {k: v for k, v in ydl_opts.items() if k != "logger"})

    with YoutubeDL(ydl_opts) as ydl:
        try:
            ret = ydl.download([url])
        except DownloadError as e:
            return ("error", f"yt-dlp 报错: {e}")
        except Exception as e:
            logging.exception("yt_dlp raised")
            return ("error", f"yt-dlp 异常: {e}")

    if ret == 0:
        return ("success", "视频已下载并保存到 Downloads 文件夹。")
    return ("error", f"yt-dlp 退出码: {ret}")


def _make_logger():
    """Forward yt_dlp's internal log lines into our debug log."""
    class _L:
        def debug(self, msg): logging.debug("yt_dlp: %s", msg)
        def info(self, msg):  logging.info("yt_dlp: %s", msg)
        def warning(self, msg): logging.warning("yt_dlp: %s", msg)
        def error(self, msg): logging.error("yt_dlp: %s", msg)
    return _L()


# ---------- Main loop ----------

def main():
    logging.info("main() started")
    ffmpeg_path = find_ffmpeg()
    logging.info("Resolved ffmpeg: %s", ffmpeg_path)

    while True:
        try:
            logging.info("Waiting for message from Chrome...")
            msg = read_message()
            logging.info("Received message: %s", msg)
            action = msg.get("action")

            if action != "download":
                send_message({"status": "error", "message": f"Unknown action: {action}"})
                continue

            url = msg.get("url")
            if not url:
                send_message({"status": "error", "message": "Missing URL parameter"})
                continue

            status, message = run_download(
                url,
                msg.get("proxy"),
                msg.get("bypassSsl", True),
                ffmpeg_path,
            )
            send_message({"status": status, "message": message, "path": downloads_dir()})
            logging.info("Exiting after download finished (%s).", status)
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
