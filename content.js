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
    const commandText = `yt-dlp "${embedUrl}"`;
    codeBoxEl.textContent = commandText;
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
    }
  }

  let activeDownloading = false;

  // Listen to messages from background service worker
  chrome.runtime.onMessage.addListener((msg) => {
    const btn = document.getElementById('ph-btn-direct-download');
    if (!btn) return;
    
    if (msg.status === 'progress') {
      const percentage = msg.percentage || '0';
      btn.innerHTML = `
        <svg class="anim-rotate" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation: spin 1s linear infinite;">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25"></circle>
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-linecap="round"></path>
        </svg>
        正在下载: ${percentage}%
      `;
    } else if (msg.status === 'success') {
      resetPageButton(btn);
      showToast('下载成功！视频已保存至系统的 Downloads 目录。');
      activeDownloading = false;
    } else if (msg.status === 'error') {
      resetPageButton(btn);
      showToast(`下载失败: ${msg.message || '未知错误'}`);
      activeDownloading = false;
    } else if (msg.status === 'disconnected') {
      if (activeDownloading) {
        resetPageButton(btn);
        showToast(`本地连接断开: ${msg.message}`);
        activeDownloading = false;
      }
    }
  });

  function resetPageButton(btn) {
    btn.disabled = false;
    btn.style.opacity = '';
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
      </svg>
      一键本地下载 (yt-dlp)
    `;
  }

  // 6. Action: Direct Download
  function triggerDirectDownload() {
    const btn = document.getElementById('ph-btn-direct-download');
    if (!btn || btn.disabled || activeDownloading) {
      if (activeDownloading) {
        showToast('已有下载任务在后台运行中，请稍候...');
      }
      return;
    }

    activeDownloading = true;
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.innerHTML = `
      <svg class="anim-rotate" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation: spin 1s linear infinite;">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25"></circle>
        <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-linecap="round"></path>
      </svg>
      正在启动下载...
    `;
    
    // Add rotate animation styles dynamically if not present
    if (!document.getElementById('ph-spin-style')) {
      const style = document.createElement('style');
      style.id = 'ph-spin-style';
      style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }

    showToast('已唤起后台下载，正在解析网页...');

    const host = window.location.host;
    const embedUrl = `https://${host}/embed/${currentVideoId}`;

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['proxy', 'bypassSsl'], (settings) => {
        const proxy = settings.proxy || '';
        const bypassSsl = settings.bypassSsl !== false;
        chrome.runtime.sendMessage({ 
          action: 'download', 
          url: embedUrl,
          proxy: proxy,
          bypassSsl: bypassSsl
        });
      });
    } else {
      chrome.runtime.sendMessage({ 
        action: 'download', 
        url: embedUrl,
        proxy: '',
        bypassSsl: true
      });
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
