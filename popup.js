/* popup.js - Pornhub Shorties Downloader Popup Logic (Native Messaging Integrated) */

document.addEventListener('DOMContentLoaded', function () {
  let activeVideoId = '';
  let activeEmbedUrl = '';
  let activeHost = 'cn.pornhub.com';

  let convertedVideoId = '';
  let convertedEmbedUrl = '';

  const activeTabPanel = document.getElementById('active-tab-panel');
  const activeVideoTitleEl = document.getElementById('active-video-title');
  const activeCommandCodeEl = document.getElementById('active-command-code');

  const urlInput = document.getElementById('url-input');
  const btnConvert = document.getElementById('btn-convert');
  const conversionResult = document.getElementById('conversion-result');
  const convertedCommandCodeEl = document.getElementById('converted-command-code');

  const toastEl = document.getElementById('popup-toast');
  let toastTimeout = null;

  // 1. Detect Active Tab
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs[0]) {
        const tab = tabs[0];
        const url = tab.url || '';
        const title = tab.title || 'Pornhub Shorties';

        const match = url.match(/\/shorties\/([a-zA-Z0-9]+)/i);
        if (match && match[1]) {
          activeVideoId = match[1];

          // Parse host
          try {
            const urlObj = new URL(url);
            activeHost = urlObj.host;
          } catch (e) {
            activeHost = 'cn.pornhub.com';
          }

          activeEmbedUrl = `https://${activeHost}/embed/${activeVideoId}`;
          const commandText = `yt-dlp "${activeEmbedUrl}"`;

          // Clean up tab title
          const cleanTitle = title.replace(/\s*-\s*Pornhub\.com/gi, '');

          // Update active panel UI
          activeVideoTitleEl.textContent = cleanTitle;
          activeCommandCodeEl.textContent = commandText;
          activeTabPanel.classList.remove('hidden');
        }
      }
    });
  }

  // 2. Manual URL Converter
  btnConvert.addEventListener('click', handleManualConversion);
  urlInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
      handleManualConversion();
    }
  });

  function handleManualConversion() {
    const rawVal = urlInput.value.trim();
    if (!rawVal) return;

    let videoId = '';
    let host = 'cn.pornhub.com';

    // Check if it's a URL
    if (rawVal.includes('shorties/')) {
      const match = rawVal.match(/\/shorties\/([a-zA-Z0-9]+)/i);
      if (match && match[1]) {
        videoId = match[1];
      }
      // Extract host
      try {
        let urlWithProtocol = rawVal;
        if (!rawVal.startsWith('http://') && !rawVal.startsWith('https://')) {
          urlWithProtocol = 'https://' + rawVal;
        }
        const urlObj = new URL(urlWithProtocol);
        host = urlObj.host;
      } catch (e) {
        host = 'cn.pornhub.com';
      }
    } else {
      // Treat as plain ID
      const plainIdMatch = rawVal.match(/^[a-zA-Z0-9]+$/);
      if (plainIdMatch) {
        videoId = rawVal;
      }
    }

    if (videoId) {
      convertedVideoId = videoId;
      convertedEmbedUrl = `https://${host}/embed/${convertedVideoId}`;
      const commandText = `yt-dlp "${convertedEmbedUrl}"`;

      convertedCommandCodeEl.textContent = commandText;
      conversionResult.classList.remove('hidden');
      urlInput.style.borderColor = '';
    } else {
      urlInput.style.borderColor = '#ff4d4d';
      showToast('无效的 Shorties 链接或 ID');
    }
  }

  // 3. Setup Button Event Listeners
  // Active Tab panel actions
  document.getElementById('btn-active-download').addEventListener('click', function () {
    const btn = document.getElementById('btn-active-download');
    downloadVideo(activeEmbedUrl, btn);
  });

  document.getElementById('btn-active-copy-cmd').addEventListener('click', function () {
    const commandText = `yt-dlp "${activeEmbedUrl}"`;
    copyText(commandText, '已复制 yt-dlp 下载命令！');
  });

  document.getElementById('btn-active-copy-url').addEventListener('click', function () {
    copyText(activeEmbedUrl, '已复制 Embed 播放链接！');
  });

  document.getElementById('btn-active-open').addEventListener('click', function () {
    openInNewTab(activeEmbedUrl);
  });

  // Converted panel actions
  document.getElementById('btn-converted-download').addEventListener('click', function () {
    const btn = document.getElementById('btn-converted-download');
    downloadVideo(convertedEmbedUrl, btn);
  });

  document.getElementById('btn-converted-copy-cmd').addEventListener('click', function () {
    const commandText = `yt-dlp "${convertedEmbedUrl}"`;
    copyText(commandText, '已复制 yt-dlp 下载命令！');
  });

  document.getElementById('btn-converted-copy-url').addEventListener('click', function () {
    copyText(convertedEmbedUrl, '已复制 Embed 播放链接！');
  });

  document.getElementById('btn-converted-open').addEventListener('click', function () {
    openInNewTab(convertedEmbedUrl);
  });

  let activeDownloadButton = null;

  // Listen to messages from background service worker (progress/success/error)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!activeDownloadButton) return;
      
      if (msg.status === 'progress') {
        const percentage = msg.percentage || '0';
        activeDownloadButton.innerHTML = `
          <svg class="btn-icon" viewBox="0 0 24 24" style="animation: spin 1s linear infinite;">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" fill="none" stroke-width="3"></circle>
            <path d="M4 12a8 8 0 018-8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path>
          </svg>
          正在下载: ${percentage}%
        `;
      } else if (msg.status === 'success') {
        resetDownloadButton(activeDownloadButton);
        showToast('下载成功！已保存至系统的 Downloads 目录。');
        activeDownloadButton = null;
      } else if (msg.status === 'error') {
        resetDownloadButton(activeDownloadButton);
        showToast(`下载失败: ${msg.message || '未知错误'}`);
        activeDownloadButton = null;
      } else if (msg.status === 'disconnected') {
        if (activeDownloadButton) {
          resetDownloadButton(activeDownloadButton);
          showToast(`本地连接断开: ${msg.message}`);
          activeDownloadButton = null;
        }
      }
    });
  }

  function resetDownloadButton(btn) {
    btn.disabled = false;
    btn.style.opacity = '';
    btn.innerHTML = `
      <svg class="btn-icon" viewBox="0 0 24 24">
        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
      </svg>
      一键本地下载 (yt-dlp)
    `;
  }

  // Native Messaging download trigger
  function downloadVideo(url, buttonEl) {
    if (activeDownloadButton) {
      showToast('已有下载任务在后台运行中，请稍候...');
      return;
    }
    
    activeDownloadButton = buttonEl;
    buttonEl.disabled = true;
    buttonEl.style.opacity = '0.6';
    buttonEl.innerHTML = `
      <svg class="btn-icon" viewBox="0 0 24 24" style="animation: spin 1s linear infinite;">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" fill="none" stroke-width="3"></circle>
        <path d="M4 12a8 8 0 018-8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path>
      </svg>
      正在启动下载...
    `;

    // Inject spin style dynamically if missing
    if (!document.getElementById('popup-spin-style')) {
      const style = document.createElement('style');
      style.id = 'popup-spin-style';
      style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }

    showToast('已唤起后台下载，正在解析网页...');

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['proxy', 'bypassSsl'], (settings) => {
        const proxy = settings.proxy || '';
        const bypassSsl = settings.bypassSsl !== false;
        chrome.runtime.sendMessage({ 
          action: 'download', 
          url: url,
          proxy: proxy,
          bypassSsl: bypassSsl
        });
      });
    } else {
      chrome.runtime.sendMessage({ 
        action: 'download', 
        url: url,
        proxy: '',
        bypassSsl: true
      });
    }
  }

  // Helpers
  function copyText(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showToast(successMsg))
        .catch(err => console.error('复制失败:', err));
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        showToast(successMsg);
      } catch (err) {
        console.error('Fallback 复制失败:', err);
      }
      document.body.removeChild(textarea);
    }
  }

  function openInNewTab(url) {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: url });
    } else {
      window.open(url, '_blank');
    }
  }

  function showToast(message) {
    clearTimeout(toastTimeout);
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    toastEl.offsetWidth; // Force reflow
    toastEl.style.opacity = '1';
    
    toastTimeout = setTimeout(() => {
      toastEl.style.opacity = '0';
      setTimeout(() => {
        toastEl.classList.add('hidden');
      }, 200);
    }, 4500); // 4.5 seconds to ensure errors can be read
  }

  // 4. Advanced Settings Management
  const btnToggleSettings = document.getElementById('btn-toggle-settings');
  const settingsContent = document.getElementById('settings-content');
  const settingsArrowIcon = document.getElementById('settings-arrow-icon');
  const proxyInput = document.getElementById('proxy-input');
  const bypassSslCheckbox = document.getElementById('bypass-ssl-checkbox');

  btnToggleSettings.addEventListener('click', function () {
    const isHidden = settingsContent.classList.contains('hidden');
    if (isHidden) {
      settingsContent.classList.remove('hidden');
      settingsArrowIcon.style.transform = 'rotate(180deg)';
    } else {
      settingsContent.classList.add('hidden');
      settingsArrowIcon.style.transform = 'rotate(0deg)';
    }
  });

  // Load saved settings
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['proxy', 'bypassSsl'], function (result) {
      if (result.proxy) {
        proxyInput.value = result.proxy;
      }
      if (result.bypassSsl !== undefined) {
        bypassSslCheckbox.checked = result.bypassSsl;
      }
    });
  }

  // Save settings when changed
  proxyInput.addEventListener('input', saveSettings);
  bypassSslCheckbox.addEventListener('change', saveSettings);

  function saveSettings() {
    const proxyVal = proxyInput.value.trim();
    const bypassSslVal = bypassSslCheckbox.checked;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ proxy: proxyVal, bypassSsl: bypassSslVal });
    }
  }
});
