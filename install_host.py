#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
install_host.py - Installer to register the Native Messaging Host in Google Chrome
"""

import os
import sys
import json
import re
import subprocess

HOST_NAME = "com.shorties.downloader"
TARGET_DIRS = [
    os.path.expanduser("~/Library/Application Support/Google/Chrome/NativeMessagingHosts"),
    os.path.expanduser("~/Library/Application Support/Microsoft Edge/NativeMessagingHosts"),
    os.path.expanduser("~/Library/Application Support/Microsoft/Edge/NativeMessagingHosts")
]

def main():
    print("=== Shorties Downloader Native Helper Installer ===")
    
    # 1. Ask for Extension ID
    extension_id = ""
    if len(sys.argv) > 1:
        extension_id = sys.argv[1].strip()
        print(f"Using Extension ID from command line: {extension_id}")
    
    while not re.match(r"^[a-p]{32}$", extension_id):
        extension_id = input("请输入您的 Chrome/Edge 扩展 ID: ").strip()
        if not re.match(r"^[a-p]{32}$", extension_id):
            print("错误: 扩展 ID 格式不正确。")

    # 2. Paths Configuration
    current_dir = os.path.dirname(os.path.abspath(__file__))
    host_script_path = os.path.join(current_dir, "native_host.py")
    
    if not os.path.exists(host_script_path):
        print(f"错误: 未找到 native_host.py，请确保脚本完整。")
        sys.exit(1)

    # 3. Process each browser directory
    for target_dir in TARGET_DIRS:
        print(f"\n正在配置目录: {target_dir}")
        os.makedirs(target_dir, exist_ok=True)
        
        # 4. Copy native_host.py to Target Directory to avoid macOS TCC/sandboxing restrictions
        import shutil
        target_script_path = os.path.join(target_dir, "native_host.py")
        try:
            shutil.copy2(host_script_path, target_script_path)
            print(f"成功: 已将 native_host.py 复制到 {target_script_path}")
        except Exception as e:
            print(f"错误: 复制 native_host.py 失败: {e}")
            continue
        
        # 5. Generate the Native Messaging JSON Manifest
        candidate_ids = {extension_id, "ooabbpmambgfgflppmfffmgcebopbjij", "fcbmiimfkmkkkffjlopcpdlgclncnknm", "lbackfeepepegfedmnmcadebimihaemb"}
        allowed_origins = [f"chrome-extension://{ext_id}/" for ext_id in candidate_ids if ext_id]

        manifest_data = {
            "name": HOST_NAME,
            "description": "Shorties Downloader Native Helper",
            "path": target_script_path,
            "type": "stdio",
            "allowed_origins": allowed_origins
        }
        
        target_manifest_path = os.path.join(target_dir, f"{HOST_NAME}.json")
        
        try:
            with open(target_manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest_data, f, indent=2, ensure_ascii=False)
            print(f"成功: 已写入配置文件到 {target_manifest_path}")
        except Exception as e:
            print(f"错误: 写入配置文件失败: {e}")
            continue

        # 6. Make target script executable
        try:
            subprocess.run(["chmod", "+x", target_script_path], check=True)
            print(f"成功: 已为 {target_script_path} 授予可执行权限。")
        except Exception as e:
            print(f"警告: 无法为 {target_script_path} 设置可执行权限: {e}。")

    print("\n安装成功完成！")
    print("重要步骤:")
    print("1. 如果您在浏览器中打开了相关网页，请在扩展管理页面重新加载本插件。")
    print("2. 刷新您要下载视频的网页，然后点击“一键本地下载”即可。")

if __name__ == "__main__":
    main()
