/* content.js - Pornhub Shorties Downloader Helper (Native Messaging Integrated) */

(function () {
  let lastUrl = '';
  let currentVideoId = '';
  let uiCreated = false;

  // DOM Elements
  let fabEl = null;
  let panelEl = null;
  let codeBoxEl = null;
  let toastEl = null;
  let toastTimeout = null;

  // 1. Check URL and extract Shorties ID
  function checkUrl() {
    const currentUrl = window.location.href;
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;

    const match = window.location.pathname.match(/\/shorties\/([a-zA-Z0-9]+)/i);
    if (match && match[1]) {
      currentVideoId = match[1];
      showDownloaderUI();
      updatePanelContent();
    } else {
      hideDownloaderUI();
    }
  }

  // 2. Create and inject the downloader UI
  function createUI() {
    if (uiCreated) return;

    // Create FAB
    fabEl = document.createElement('div');
    fabEl.id = 'ph-shorties-fab';
    fabEl.title = 'Shorties 下载助手';
    fabEl.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
      </svg>
    `;
    document.body.appendChild(fabEl);

    // Create Control Panel
    panelEl = document.createElement('div');
    panelEl.id = 'ph-shorties-panel';
    panelEl.innerHTML = `
      <div class="ph-shorties-header">
        <div class="ph-shorties-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#FF9900" style="vertical-align: middle;">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
          </svg>
          Shorties 下载助手
        </div>
      </div>
      <div class="ph-shorties-body">
        <!-- Direct Download Button -->
        <button class="ph-shorties-btn ph-shorties-btn-primary" id="ph-btn-direct-download" style="background: linear-gradient(135deg, #FF9900 0%, #FF5500 100%); color: white; margin-bottom: 16px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
          </svg>
          一键本地下载 (yt-dlp)
        </button>

        <div style="border-top: 1px solid rgba(255,255,255,0.06); margin-bottom: 16px;"></div>

        <div class="ph-shorties-section-title">yt-dlp 下载命令</div>
        <div class="ph-shorties-code-box" id="ph-shorties-code">加载中...</div>
        
        <button class="ph-shorties-btn ph-shorties-btn-secondary" id="ph-btn-copy-cmd">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
          </svg>
          复制 yt-dlp 下载命令
        </button>
        
        <button class="ph-shorties-btn ph-shorties-btn-secondary" id="ph-btn-copy-url">
          复制 Embed 播放链接
        </button>
        
        <button class="ph-shorties-btn ph-shorties-btn-secondary" id="ph-btn-open-embed">
          在新标签页打开视频
        </button>

        <div class="ph-shorties-queue-section" id="ph-queue-section" style="display: none;">
          <div class="ph-shorties-queue-header">
            <span class="ph-shorties-section-title" style="margin: 0;">下载队列 <span class="ph-shorties-queue-count" id="ph-queue-count">0</span></span>
            <button class="ph-shorties-queue-clear" id="ph-btn-clear-finished" title="清除已完成 / 失败的任务">清除已完成</button>
          </div>
          <ul class="ph-shorties-queue-list" id="ph-queue-list"></ul>
        </div>
      </div>
    `;
    document.body.appendChild(panelEl);

    // Create Toast
    toastEl = document.createElement('div');
    toastEl.id = 'ph-shorties-toast';
    document.body.appendChild(toastEl);

    // Bind Event Listeners
    codeBoxEl = document.getElementById('ph-shorties-code');

    fabEl.addEventListener('click', togglePanel);

    document.getElementById('ph-btn-direct-download').addEventListener('click', triggerDirectDownload);
    document.getElementById('ph-btn-copy-cmd').addEventListener('click', copyCommand);
    document.getElementById('ph-btn-copy-url').addEventListener('click', copyEmbedUrl);
    document.getElementById('ph-btn-open-embed').addEventListener('click', openEmbed);
    document.getElementById('ph-btn-clear-finished').addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({ action: 'clear-finished' }, () => void chrome.runtime.lastError);
      } catch (_) {}
    });

    // Close panel when clicking outside
    document.addEventListener('click', function (e) {
      if (panelEl.classList.contains('show') && !panelEl.contains(e.target) && e.target !== fabEl && !fabEl.contains(e.target)) {
        togglePanel();
      }
    });

    uiCreated = true;
  }

  // 3. Show or Hide UI wrapper elements
  function showDownloaderUI() {
    createUI();
    if (fabEl) fabEl.style.display = 'flex';
  }

  function hideDownloaderUI() {
    if (fabEl) fabEl.style.display = 'none';
    if (panelEl) panelEl.classList.remove('show');
    if (fabEl) fabEl.classList.remove('active');
  }

  // 4. Update the content inside the control panel
  function updatePanelContent() {
    if (!codeBoxEl) return;
    const host = window.location.host;
    const embedUrl = `https://${host}/embed/${currentVideoId}`;
    codeBoxEl.textContent = `yt-dlp "${embedUrl}"`;
    pullQueueOnce();
  }

  // 5. Toggle panel visibility
  function togglePanel() {
    if (!panelEl) return;
    const isShowing = panelEl.classList.contains('show');
    if (isShowing) {
      panelEl.classList.remove('show');
      fabEl.classList.remove('active');
    } else {
      panelEl.classList.add('show');
      fabEl.classList.add('active');
      pullQueueOnce();
    }
  }

  // The button reflects the state of the task for the *current page's* URL.
  // It is driven entirely by queue-update broadcasts from background.
  function currentEmbedUrl() {
    const host = window.location.host;
    return `https://${host}/embed/${currentVideoId}`;
  }

  function ensureSpinStyle() {
    if (!document.getElementById('ph-spin-style')) {
      const style = document.createElement('style');
      style.id = 'ph-spin-style';
      style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }
  }

  function renderButton(task) {
    const btn = document.getElementById('ph-btn-direct-download');
    if (!btn) return;
    ensureSpinStyle();

    if (!task || task.state === 'success' || task.state === 'error') {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
        </svg>
        一键本地下载 (yt-dlp)
      `;
      return;
    }

    const spinner = `
      <svg class="anim-rotate" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation: spin 1s linear infinite;">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25"></circle>
        <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-linecap="round"></path>
      </svg>
    `;
    btn.disabled = true;
    btn.style.opacity = '0.6';
    if (task.state === 'queued') {
      btn.innerHTML = `${spinner} 排队中…`;
    } else {
      const pct = Math.max(0, Math.min(100, task.percentage || 0));
      btn.innerHTML = `${spinner} 下载中 ${pct.toFixed(0)}%`;
    }
  }

  // Track last seen state per URL so we can fire one-shot toasts on transition
  const lastSeenState = new Map();
  function reflectQueue(taskMap) {
    const url = currentEmbedUrl();
    const task = taskMap ? taskMap[url] : null;
    renderButton(task);
    renderQueueList(taskMap);

    const prev = lastSeenState.get(url);
    const now = task ? task.state : null;
    if (prev !== now) {
      lastSeenState.set(url, now);
      if (now === 'success') {
        showToast('下载成功！视频已保存至系统的 Downloads 目录。');
      } else if (now === 'error') {
        showToast(`下载失败: ${(task && task.message) || '未知错误'}`);
      }
    }
  }

  function renderQueueList(taskMap) {
    const section = document.getElementById('ph-queue-section');
    const list = document.getElementById('ph-queue-list');
    const countEl = document.getElementById('ph-queue-count');
    if (!section || !list || !countEl) return;

    const items = Object.values(taskMap || {});
    items.sort((a, b) => {
      const order = { running: 0, queued: 1, error: 2, success: 3 };
      const oa = order[a.state] ?? 9;
      const ob = order[b.state] ?? 9;
      if (oa !== ob) return oa - ob;
      return b.addedAt - a.addedAt;
    });

    countEl.textContent = String(items.length);
    list.innerHTML = '';
    if (items.length === 0) {
      section.style.display = 'none';
      return;
    }
    section.style.display = '';

    for (const t of items) list.appendChild(buildQueueRow(t));
  }

  function buildQueueRow(t) {
    const li = document.createElement('li');
    li.className = `ph-shorties-queue-item ph-state-${t.state}`;

    const top = document.createElement('div');
    top.className = 'ph-shorties-queue-top';

    const urlEl = document.createElement('span');
    urlEl.className = 'ph-shorties-queue-url';
    urlEl.textContent = shortenUrl(t.url);
    urlEl.title = t.url;
    top.appendChild(urlEl);

    const statusEl = document.createElement('span');
    statusEl.className = 'ph-shorties-queue-status';
    statusEl.textContent = labelForState(t);
    top.appendChild(statusEl);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ph-shorties-queue-remove';
    removeBtn.textContent = t.state === 'running' ? '取消' : '移除';
    removeBtn.addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({ action: 'remove-task', url: t.url }, () => void chrome.runtime.lastError);
      } catch (_) {}
    });
    top.appendChild(removeBtn);

    li.appendChild(top);

    if (t.state === 'running' || t.state === 'queued') {
      const bar = document.createElement('div');
      bar.className = 'ph-shorties-queue-progress';
      const fill = document.createElement('div');
      fill.className = 'ph-shorties-queue-progress-fill';
      fill.style.width = `${Math.max(0, Math.min(100, t.percentage || 0))}%`;
      bar.appendChild(fill);
      li.appendChild(bar);
    }
    if (t.message) {
      const msg = document.createElement('div');
      msg.className = 'ph-shorties-queue-message';
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
      return url.length > 50 ? url.slice(0, 47) + '…' : url;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'queue-update') reflectQueue(msg.tasks);
  });

  function pullQueueOnce() {
    try {
      chrome.runtime.sendMessage({ action: 'get-queue' }, (res) => {
        void chrome.runtime.lastError;
        if (res && res.tasks) reflectQueue(res.tasks);
      });
    } catch (_) {}
  }

  // 6. Action: Direct Download
  function triggerDirectDownload() {
    const embedUrl = currentEmbedUrl();
    const sendDownload = (proxy, bypassSsl) => {
      try {
        chrome.runtime.sendMessage(
          { action: 'download', url: embedUrl, proxy, bypassSsl },
          (res) => {
            void chrome.runtime.lastError;
            if (!res) {
              showToast('后台未响应，请重试');
              return;
            }
            if (res.ok) {
              showToast('已加入下载队列');
            } else if (res.reason === 'duplicate') {
              showToast(res.state === 'running' ? '该视频正在下载中' : '该视频已在队列中');
            } else {
              showToast(`加入队列失败: ${res.message || res.reason || '未知错误'}`);
            }
            pullQueueOnce();
          }
        );
      } catch (e) {
        showToast(`无法连接到后台: ${e.message}`);
      }
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['proxy', 'bypassSsl'], (settings) => {
        sendDownload(settings.proxy || '', settings.bypassSsl !== false);
      });
    } else {
      sendDownload('', true);
    }
  }

  // 7. Action: Copy Command
  function copyCommand() {
    const host = window.location.host;
    const embedUrl = `https://${host}/embed/${currentVideoId}`;
    const commandText = `yt-dlp "${embedUrl}"`;
    copyToClipboard(commandText, '已复制 yt-dlp 下载命令！');
  }

  // 8. Action: Copy Embed URL
  function copyEmbedUrl() {
    const host = window.location.host;
    const embedUrl = `https://${host}/embed/${currentVideoId}`;
    copyToClipboard(embedUrl, '已复制 Embed 播放链接！');
  }

  // 9. Action: Open Embed URL
  function openEmbed() {
    const host = window.location.host;
    const embedUrl = `https://${host}/embed/${currentVideoId}`;
    window.open(embedUrl, '_blank');
  }

  // Helper: Copy string to clipboard
  function copyToClipboard(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showToast(successMsg))
        .catch(err => console.error('复制失败:', err));
    } else {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
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

  // Helper: Show custom toast message
  function showToast(message) {
    if (!toastEl) return;
    clearTimeout(toastTimeout);
    toastEl.textContent = message;
    toastEl.classList.add('show');
    toastTimeout = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 4500); // Kept longer to allow reading error messages
  }

  // 10. Initialize URL Polling
  checkUrl();
  setInterval(checkUrl, 1000);
})();
