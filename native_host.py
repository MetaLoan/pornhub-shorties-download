#!/opt/homebrew/bin/python3
# -*- coding: utf-8 -*-
"""
native_host.py - Chrome Native Messaging Host for Shorties Downloader
"""

import sys
import json
import struct
import subprocess
import os
import logging

# Configure logging
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "native_debug.log")
logging.basicConfig(
    filename=LOG_FILE,
    level=logging.DEBUG,
    format='%(asctime)s %(levelname)s: %(message)s'
)

logging.info("Python Native Host script loaded.")

# Helper to read messages from Chrome via stdin
def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length or len(raw_length) < 4:
        sys.exit(0)
    message_length = struct.unpack('@I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)

# Helper to send messages to Chrome via stdout
def send_message(message_dict):
    encoded_message = json.dumps(message_dict).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('@I', len(encoded_message)))
    sys.stdout.buffer.write(encoded_message)
    sys.stdout.buffer.flush()

# Locate the yt-dlp executable on macOS (since GUI apps don't inherit terminal PATH)
def find_yt_dlp():
    # Common macOS brew and user bin locations
    standard_paths = [
        '/opt/homebrew/bin/yt-dlp',
        '/usr/local/bin/yt-dlp',
        '/usr/bin/yt-dlp',
        os.path.expanduser('~/.local/bin/yt-dlp')
    ]
    
    for path in standard_paths:
        if os.path.exists(path) and os.access(path, os.X_OK):
            return path
            
    # Modify environment PATH to include standard directories and search
    env_path = os.environ.get('PATH', '')
    for extra_path in ['/opt/homebrew/bin', '/usr/local/bin', os.path.expanduser('~/.local/bin')]:
        if extra_path not in env_path:
            env_path = extra_path + os.pathsep + env_path
    os.environ['PATH'] = env_path

    # Try executing 'which'
    try:
        res = subprocess.run(['which', 'yt-dlp'], capture_output=True, text=True)
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip()
    except Exception:
        pass
        
    return 'yt-dlp' # Fallback to path search

def find_ffmpeg():
    # Common macOS brew and user bin locations
    standard_paths = [
        '/opt/homebrew/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/usr/bin/ffmpeg',
        os.path.expanduser('~/.local/bin/ffmpeg')
    ]
    
    for path in standard_paths:
        if os.path.exists(path) and os.access(path, os.X_OK):
            return path

    # Try executing 'which'
    try:
        res = subprocess.run(['which', 'ffmpeg'], capture_output=True, text=True)
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip()
    except Exception:
        pass
        
    return None

def main():
    logging.info("main() started")
    yt_dlp_path = find_yt_dlp()
    logging.info(f"Resolved yt-dlp path: {yt_dlp_path}")
    ffmpeg_path = find_ffmpeg()
    logging.info(f"Resolved ffmpeg path: {ffmpeg_path}")
    
    while True:
        try:
            logging.info("Waiting for message from Chrome...")
            msg = read_message()
            logging.info(f"Received message: {msg}")
            action = msg.get('action')
            
            if action == 'download':
                url = msg.get('url')
                proxy = msg.get('proxy')
                bypass_ssl = msg.get('bypassSsl', True)
                
                logging.info(f"Processing download action for URL: {url}, proxy: {proxy}, bypassSsl: {bypass_ssl}")
                if not url:
                    logging.warning("Missing URL parameter")
                    send_message({'status': 'error', 'message': 'Missing URL parameter'})
                    continue
                
                # Default save location: User's Downloads directory
                downloads_dir = os.path.expanduser('~/Downloads')
                
                # Build download command
                # Use standard options. Save into Downloads folder. Add --newline to parse output line by line.
                cmd = [yt_dlp_path, '-P', downloads_dir, '--newline']
                if proxy:
                    cmd.extend(['--proxy', proxy])
                if bypass_ssl:
                    cmd.append('--no-check-certificate')
                
                # Force remux to mp4 container using resolved ffmpeg path
                cmd.extend(['--remux-video', 'mp4'])
                if ffmpeg_path:
                    cmd.extend(['--ffmpeg-location', os.path.dirname(ffmpeg_path)])
                    
                cmd.append(url)
                
                logging.info(f"Starting process: {' '.join(cmd)}")
                
                # Execute yt-dlp asynchronously to capture progress
                process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                    universal_newlines=True
                )
                
                # Parse stdout line by line in real-time
                import re
                progress_re = re.compile(r'\[download\]\s+([0-9.]+)%')
                
                while True:
                    line = process.stdout.readline()
                    if not line:
                        break
                    line = line.strip()
                    if line:
                        logging.debug(f"yt-dlp: {line}")
                        
                        match = progress_re.search(line)
                        if match:
                            percent = match.group(1)
                            send_message({'status': 'progress', 'percentage': percent})
                
                # Wait for process exit and read stderr
                stdout, stderr = process.communicate()
                return_code = process.returncode
                
                logging.info(f"Process exited with code: {return_code}")
                if return_code == 0:
                    logging.info("Download completed successfully.")
                    send_message({
                        'status': 'success',
                        'message': '视频已下载并保存到 Downloads 文件夹。',
                        'path': downloads_dir
                    })
                else:
                    err_msg = stderr.strip() or '下载器遇到错误'
                    logging.error(f"Download failed: {err_msg}")
                    send_message({
                        'status': 'error',
                        'message': f'yt-dlp 报错: {err_msg}'
                    })
                # Exit cleanly after one download to avoid zombie host processes.
                logging.info("Exiting after download finished.")
                sys.stdout.buffer.flush()
                sys.exit(0)
            else:
                logging.warning(f"Unknown action: {action}")
                send_message({'status': 'error', 'message': f'Unknown action: {action}'})
                
        except Exception as e:
            logging.exception("Exception occurred in main loop:")
            send_message({'status': 'error', 'message': f'宿主服务异常: {str(e)}'})
            sys.exit(0)

if __name__ == '__main__':
    main()
