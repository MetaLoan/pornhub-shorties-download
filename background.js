/* background.js - Chrome Native Messaging Bridge Service Worker */

const HOST_NAME = 'com.shorties.downloader';
const activePorts = new Set();
let keepAliveInterval = null;

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
  }, 20000);
}

function stopKeepAliveIfIdle() {
  if (activePorts.size === 0 && keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

function broadcast(msg, tabId) {
  try {
    const p = chrome.runtime.sendMessage(msg);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) {}
  if (tabId != null) {
    try {
      const p = chrome.tabs.sendMessage(tabId, msg);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {}
  }
}

self.addEventListener('unhandledrejection', (event) => {
  console.warn('[bg] swallowed unhandled rejection:', event.reason && event.reason.message);
  event.preventDefault();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'download') {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const proxy = message.proxy || '';
    const bypassSsl = message.bypassSsl !== false;

    console.log('[bg] download request received', { url: message.url, proxy, bypassSsl, tabId });
    startDownloadPort(message.url, proxy, bypassSsl, tabId, 0);

    sendResponse({ status: 'started' });
    return false;
  }
});

const MAX_RETRIES = 2;
const EARLY_DISCONNECT_MS = 1500;

function startDownloadPort(url, proxy, bypassSsl, tabId, attempt) {
  let port;
  const state = { gotAnyMessage: false, finished: false, settledAt: 0 };
  const startedAt = Date.now();

  try {
    port = chrome.runtime.connectNative(HOST_NAME);
    console.log(`[bg] connectNative ok (attempt ${attempt + 1})`);
  } catch (e) {
    console.error('[bg] connectNative threw:', e);
    broadcast({ status: 'error', message: `无法唤起本地服务: ${e.message}` }, tabId);
    return;
  }

  activePorts.add(port);
  startKeepAlive();

  port.onMessage.addListener((msg) => {
    state.gotAnyMessage = true;
    console.log('[bg] native -> ext message:', msg);
    if (msg && (msg.status === 'success' || msg.status === 'error')) {
      state.finished = true;
    }
    broadcast(msg, tabId);
  });

  port.onDisconnect.addListener(() => {
    const lastErr = chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
    const elapsed = Date.now() - startedAt;
    console.warn(`[bg] port disconnected after ${elapsed}ms. lastError="${lastErr}" gotAnyMessage=${state.gotAnyMessage} finished=${state.finished} attempt=${attempt + 1}`);
    activePorts.delete(port);
    stopKeepAliveIfIdle();

    if (state.finished) return;

    // Early disconnect with no host messages => possible SW race. Retry.
    if (!state.gotAnyMessage && elapsed < EARLY_DISCONNECT_MS && attempt < MAX_RETRIES) {
      const delay = 300 * (attempt + 1);
      console.warn(`[bg] retrying connectNative in ${delay}ms (attempt ${attempt + 2}/${MAX_RETRIES + 1})`);
      setTimeout(() => startDownloadPort(url, proxy, bypassSsl, tabId, attempt + 1), delay);
      return;
    }

    broadcast({
      status: 'disconnected',
      message: `宿主连接断开: ${lastErr || '与本地服务连接断开'}（已重试 ${attempt} 次）`
    }, tabId);
  });

  try {
    port.postMessage({
      action: 'download',
      url: url,
      proxy: proxy,
      bypassSsl: bypassSsl
    });
    console.log('[bg] postMessage(download) dispatched');
  } catch (e) {
    console.error('[bg] postMessage failed:', e);
    try { port.disconnect(); } catch (_) {}
    activePorts.delete(port);
    stopKeepAliveIfIdle();

    if (attempt < MAX_RETRIES) {
      const delay = 300 * (attempt + 1);
      setTimeout(() => startDownloadPort(url, proxy, bypassSsl, tabId, attempt + 1), delay);
      return;
    }
    broadcast({ status: 'error', message: `发送下载指令失败: ${e.message}` }, tabId);
  }
}
