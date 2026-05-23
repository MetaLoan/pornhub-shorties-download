/* popup.js - Pornhub Shorties Downloader Popup Logic */

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

  const queuePanel = document.getElementById('queue-panel');
  const queueListEl = document.getElementById('queue-list');
  const queueCountEl = document.getElementById('queue-count');
  const btnClearFinished = document.getElementById('btn-clear-finished');

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

          try {
            const urlObj = new URL(url);
            activeHost = urlObj.host;
          } catch (e) {
            activeHost = 'cn.pornhub.com';
          }

          activeEmbedUrl = `https://${activeHost}/embed/${activeVideoId}`;
          const commandText = `yt-dlp "${activeEmbedUrl}"`;
          const cleanTitle = title.replace(/\s*-\s*Pornhub\.com/gi, '');

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
    if (e.key === 'Enter') handleManualConversion();
  });

  function handleManualConversion() {
    const rawVal = urlInput.value.trim();
    if (!rawVal) return;

    let videoId = '';
    let host = 'cn.pornhub.com';

    if (rawVal.includes('shorties/')) {
      const match = rawVal.match(/\/shorties\/([a-zA-Z0-9]+)/i);
      if (match && match[1]) videoId = match[1];
      try {
        let urlWithProtocol = rawVal;
        if (!rawVal.startsWith('http://') && !rawVal.startsWith('https://')) {
          urlWithProtocol = 'https://' + rawVal;
        }
        host = new URL(urlWithProtocol).host;
      } catch (e) {
        host = 'cn.pornhub.com';
      }
    } else if (/^[a-zA-Z0-9]+$/.test(rawVal)) {
      videoId = rawVal;
    }

    if (videoId) {
      convertedVideoId = videoId;
      convertedEmbedUrl = `https://${host}/embed/${convertedVideoId}`;
      convertedCommandCodeEl.textContent = `yt-dlp "${convertedEmbedUrl}"`;
      conversionResult.classList.remove('hidden');
      urlInput.style.borderColor = '';
    } else {
      urlInput.style.borderColor = '#ff4d4d';
      showToast('无效的 Shorties 链接或 ID');
    }
  }

  // 3. Setup Button Event Listeners
  document.getElementById('btn-active-download').addEventListener('click', () => enqueueDownload(activeEmbedUrl));
  document.getElementById('btn-active-copy-cmd').addEventListener('click', () => copyText(`yt-dlp "${activeEmbedUrl}"`, '已复制 yt-dlp 下载命令！'));
  document.getElementById('btn-active-copy-url').addEventListener('click', () => copyText(activeEmbedUrl, '已复制 Embed 播放链接！'));
  document.getElementById('btn-active-open').addEventListener('click', () => openInNewTab(activeEmbedUrl));

  document.getElementById('btn-converted-download').addEventListener('click', () => enqueueDownload(convertedEmbedUrl));
  document.getElementById('btn-converted-copy-cmd').addEventListener('click', () => copyText(`yt-dlp "${convertedEmbedUrl}"`, '已复制 yt-dlp 下载命令！'));
  document.getElementById('btn-converted-copy-url').addEventListener('click', () => copyText(convertedEmbedUrl, '已复制 Embed 播放链接！'));
  document.getElementById('btn-converted-open').addEventListener('click', () => openInNewTab(convertedEmbedUrl));

  btnClearFinished.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clear-finished' }, () => void chrome.runtime.lastError);
  });

  // ---- Queue: fetch + render + live update ----

  function enqueueDownload(url) {
    if (!url) {
      showToast('未识别到视频链接');
      return;
    }
    const proxy = (proxyInput && proxyInput.value.trim()) || '';
    const bypassSsl = bypassSslCheckbox ? bypassSslCheckbox.checked : true;

    chrome.runtime.sendMessage(
      { action: 'download', url, proxy, bypassSsl },
      (res) => {
        void chrome.runtime.lastError;
        if (!res) return;
        if (res.ok) {
          showToast('已加入下载队列');
        } else if (res.reason === 'duplicate') {
          showToast(res.state === 'running' ? '该视频正在下载中' : '该视频已在队列中');
        } else if (res.reason === 'empty-url') {
          showToast('链接为空，无法下载');
        } else {
          showToast(`加入队列失败: ${res.message || res.reason || '未知错误'}`);
        }
      }
    );
  }

  function renderQueue(taskMap) {
    const items = Object.values(taskMap || {});
    // newest first
    items.sort((a, b) => {
      const order = { running: 0, queued: 1, error: 2, success: 3 };
      const oa = order[a.state] ?? 9;
      const ob = order[b.state] ?? 9;
      if (oa !== ob) return oa - ob;
      return b.addedAt - a.addedAt;
    });

    queueCountEl.textContent = String(items.length);
    queueListEl.innerHTML = '';

    if (items.length === 0) {
      queuePanel.classList.add('hidden');
      return;
    }
    queuePanel.classList.remove('hidden');

    for (const t of items) {
      queueListEl.appendChild(buildQueueRow(t));
    }
  }

  function buildQueueRow(t) {
    const li = document.createElement('li');
    li.className = `queue-item state-${t.state}`;

    const top = document.createElement('div');
    top.className = 'queue-top';

    const urlEl = document.createElement('span');
    urlEl.className = 'queue-url';
    urlEl.textContent = shortenUrl(t.url);
    urlEl.title = t.url;
    top.appendChild(urlEl);

    const statusEl = document.createElement('span');
    statusEl.className = 'queue-status';
    statusEl.textContent = labelForState(t);
    top.appendChild(statusEl);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'queue-remove-btn';
    removeBtn.textContent = t.state === 'running' ? '取消' : '移除';
    removeBtn.title = '从队列中移除';
    removeBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'remove-task', url: t.url }, () => void chrome.runtime.lastError);
    });
    top.appendChild(removeBtn);

    li.appendChild(top);

    // progress bar (running) or message line (queued / success / error)
    if (t.state === 'running' || t.state === 'queued') {
      const bar = document.createElement('div');
      bar.className = 'queue-progress';
      const fill = document.createElement('div');
      fill.className = 'queue-progress-fill';
      fill.style.width = `${Math.max(0, Math.min(100, t.percentage || 0))}%`;
      bar.appendChild(fill);
      li.appendChild(bar);
    }
    if (t.message) {
      const msg = document.createElement('div');
      msg.className = 'queue-message';
      msg.textContent = t.message;
      li.appendChild(msg);
    }

    return li;
  }

  function labelForState(t) {
    switch (t.state) {
      case 'queued':  return '排队中';
      case 'running': return `${(t.percentage || 0).toFixed(0)}%`;
      case 'success': return '已完成';
      case 'error':   return '失败';
      default:        return t.state;
    }
  }

  function shortenUrl(url) {
    try {
      const u = new URL(url);
      const tail = u.pathname.split('/').filter(Boolean).pop() || u.pathname;
      return `${u.host}/…/${tail}`;
    } catch (_) {
      return url.length > 60 ? url.slice(0, 57) + '…' : url;
    }
  }

  function refreshQueue() {
    chrome.runtime.sendMessage({ action: 'get-queue' }, (res) => {
      void chrome.runtime.lastError;
      if (res && res.tasks) renderQueue(res.tasks);
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'queue-update') renderQueue(msg.tasks);
    });
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
    toastEl.offsetWidth;
    toastEl.style.opacity = '1';

    toastTimeout = setTimeout(() => {
      toastEl.style.opacity = '0';
      setTimeout(() => toastEl.classList.add('hidden'), 200);
    }, 4500);
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

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['proxy', 'bypassSsl'], function (result) {
      if (result.proxy) proxyInput.value = result.proxy;
      if (result.bypassSsl !== undefined) bypassSslCheckbox.checked = result.bypassSsl;
    });
  }

  proxyInput.addEventListener('input', saveSettings);
  bypassSslCheckbox.addEventListener('change', saveSettings);

  function saveSettings() {
    const proxyVal = proxyInput.value.trim();
    const bypassSslVal = bypassSslCheckbox.checked;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ proxy: proxyVal, bypassSsl: bypassSslVal });
    }
  }

  // Initial queue load
  refreshQueue();
});
