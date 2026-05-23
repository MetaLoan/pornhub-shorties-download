/* background.js - Chrome Native Messaging Bridge Service Worker
 *
 * Responsibilities:
 *   - Bridge popup/content script <-> native host (yt-dlp)
 *   - Maintain a task queue with URL-dedupe, max 3 concurrent
 *   - Persist queue to chrome.storage.session so a closed popup can re-open and see state
 */

const HOST_NAME = 'com.shorties.downloader';
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 2;
const EARLY_DISCONNECT_MS = 1500;
const STORAGE_KEY = 'tasks';

// url -> task, the single source of truth in-memory.
const tasks = new Map();
// url -> in-flight Port (only for running tasks)
const taskPorts = new Map();
let keepAliveInterval = null;
let restorePromise = null;

self.addEventListener('unhandledrejection', (event) => {
  console.warn('[bg] swallowed unhandled rejection:', event.reason && event.reason.message);
  event.preventDefault();
});

// ---------- Service worker keepalive while any task is running ----------

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
  }, 20000);
}

function stopKeepAliveIfIdle() {
  if (taskPorts.size === 0 && keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// ---------- Broadcast helpers ----------

function safeSend(sendFn) {
  try {
    const p = sendFn();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) {}
}

function broadcastQueue() {
  const snapshot = serializeTasks();
  safeSend(() => chrome.runtime.sendMessage({ type: 'queue-update', tasks: snapshot }));
}

// ---------- Persistence ----------

function serializeTasks() {
  const out = {};
  for (const [url, t] of tasks) out[url] = t;
  return out;
}

function persist() {
  try {
    chrome.storage.session.set({ [STORAGE_KEY]: serializeTasks() }, () => void chrome.runtime.lastError);
  } catch (e) {
    console.warn('[bg] persist failed:', e);
  }
}

async function restore() {
  if (tasks.size > 0) return;
  try {
    const data = await chrome.storage.session.get([STORAGE_KEY]);
    const obj = data && data[STORAGE_KEY];
    if (!obj) return;
    for (const [url, t] of Object.entries(obj)) {
      // Any task that was 'running' before SW died has lost its port. Re-queue it.
      if (t.state === 'running') {
        t.state = 'queued';
        t.percentage = 0;
        t.message = '已重新排队（后台被回收）';
      }
      tasks.set(url, t);
    }
    console.log('[bg] restored tasks:', tasks.size);
  } catch (e) {
    console.warn('[bg] restore failed:', e);
  }
}

function ensureRestored() {
  if (!restorePromise) restorePromise = restore();
  return restorePromise;
}

// ---------- Task lifecycle ----------

function makeTask(url, proxy, bypassSsl, tabId) {
  return {
    url,
    proxy: proxy || '',
    bypassSsl: bypassSsl !== false,
    tabId: tabId != null ? tabId : null,
    state: 'queued',           // queued | running | success | error
    percentage: 0,
    message: '排队中…',
    addedAt: Date.now(),
    startedAt: 0,
    finishedAt: 0,
    attempt: 0,
  };
}

function countRunning() {
  let n = 0;
  for (const t of tasks.values()) if (t.state === 'running') n++;
  return n;
}

function schedule() {
  let started = 0;
  for (const task of tasks.values()) {
    if (countRunning() >= MAX_CONCURRENT) break;
    if (task.state === 'queued') {
      task.state = 'running';
      task.startedAt = Date.now();
      task.percentage = 0;
      task.message = '正在启动…';
      task.attempt = 0;
      startDownloadPort(task);
      started++;
    }
  }
  if (started > 0) {
    persist();
    broadcastQueue();
  }
}

function finalizeTask(task, finalState, finalMessage) {
  task.state = finalState;
  task.finishedAt = Date.now();
  task.message = finalMessage || task.message;
  if (finalState === 'success') task.percentage = 100;
  const port = taskPorts.get(task.url);
  if (port) {
    taskPorts.delete(task.url);
    try { port.disconnect(); } catch (_) {}
  }
  stopKeepAliveIfIdle();
  persist();
  broadcastQueue();
  schedule();
}

function startDownloadPort(task) {
  let port;
  const state = { gotAnyMessage: false, finished: false };
  const startedAt = Date.now();
  const attemptNum = task.attempt;

  try {
    port = chrome.runtime.connectNative(HOST_NAME);
    console.log(`[bg] connectNative ok url=${task.url} attempt=${attemptNum + 1}`);
  } catch (e) {
    console.error('[bg] connectNative threw:', e);
    finalizeTask(task, 'error', `无法唤起本地服务: ${e.message}`);
    return;
  }

  taskPorts.set(task.url, port);
  startKeepAlive();

  port.onMessage.addListener((msg) => {
    state.gotAnyMessage = true;
    console.log('[bg] native -> ext:', msg);
    if (!msg) return;
    if (msg.status === 'progress') {
      const pct = parseFloat(msg.percentage);
      task.percentage = Number.isFinite(pct) ? pct : task.percentage;
      task.message = `下载中 ${task.percentage.toFixed(1)}%`;
      broadcastQueue();
    } else if (msg.status === 'success') {
      state.finished = true;
      finalizeTask(task, 'success', msg.message || '下载成功');
    } else if (msg.status === 'error') {
      state.finished = true;
      finalizeTask(task, 'error', msg.message || '下载失败');
    }
  });

  port.onDisconnect.addListener(() => {
    const lastErr = chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
    const elapsed = Date.now() - startedAt;
    console.warn(`[bg] port disconnected after ${elapsed}ms lastError="${lastErr}" gotAny=${state.gotAnyMessage} finished=${state.finished} url=${task.url}`);
    taskPorts.delete(task.url);
    stopKeepAliveIfIdle();

    if (state.finished) return; // success/error already finalized

    // Early-disconnect retry (SW race)
    if (!state.gotAnyMessage && elapsed < EARLY_DISCONNECT_MS && attemptNum < MAX_RETRIES) {
      task.attempt = attemptNum + 1;
      task.message = `连接被回收，正在重试 (${task.attempt + 1}/${MAX_RETRIES + 1})`;
      broadcastQueue();
      const delay = 300 * (attemptNum + 1);
      setTimeout(() => startDownloadPort(task), delay);
      return;
    }

    finalizeTask(task, 'error',
      `宿主连接断开: ${lastErr || '与本地服务连接断开'}（已重试 ${attemptNum} 次）`);
  });

  try {
    port.postMessage({
      action: 'download',
      url: task.url,
      proxy: task.proxy,
      bypassSsl: task.bypassSsl,
    });
    console.log('[bg] postMessage dispatched url=', task.url);
  } catch (e) {
    console.error('[bg] postMessage failed:', e);
    try { port.disconnect(); } catch (_) {}
    taskPorts.delete(task.url);
    stopKeepAliveIfIdle();
    if (attemptNum < MAX_RETRIES) {
      task.attempt = attemptNum + 1;
      task.message = `发送指令失败，正在重试 (${task.attempt + 1}/${MAX_RETRIES + 1})`;
      broadcastQueue();
      setTimeout(() => startDownloadPort(task), 300 * (attemptNum + 1));
      return;
    }
    finalizeTask(task, 'error', `发送下载指令失败: ${e.message}`);
  }
}

// ---------- Public actions ----------

async function enqueueDownload(url, proxy, bypassSsl, tabId) {
  await ensureRestored();
  if (!url) return { ok: false, reason: 'empty-url' };

  const existing = tasks.get(url);
  if (existing && (existing.state === 'queued' || existing.state === 'running')) {
    return { ok: false, reason: 'duplicate', state: existing.state };
  }
  if (existing && (existing.state === 'success' || existing.state === 'error')) {
    // Allow re-adding finished tasks (manual retry)
    tasks.delete(url);
  }
  const task = makeTask(url, proxy, bypassSsl, tabId);
  tasks.set(url, task);
  persist();
  broadcastQueue();
  schedule();
  return { ok: true };
}

async function removeTask(url) {
  await ensureRestored();
  const t = tasks.get(url);
  if (!t) return;
  if (t.state === 'running') {
    // Cancel: disconnect port → host stdin EOF → host exits.
    const port = taskPorts.get(url);
    if (port) {
      taskPorts.delete(url);
      try { port.disconnect(); } catch (_) {}
    }
  }
  tasks.delete(url);
  stopKeepAliveIfIdle();
  persist();
  broadcastQueue();
  schedule();
}

async function clearFinished() {
  await ensureRestored();
  for (const [url, t] of Array.from(tasks)) {
    if (t.state === 'success' || t.state === 'error') tasks.delete(url);
  }
  persist();
  broadcastQueue();
}

// ---------- Message router ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;
  const tabId = sender && sender.tab ? sender.tab.id : null;

  if (message.action === 'download') {
    enqueueDownload(message.url, message.proxy, message.bypassSsl, tabId)
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ ok: false, reason: 'error', message: e.message }));
    return true; // async response
  }

  if (message.action === 'get-queue') {
    ensureRestored().then(() => {
      sendResponse({ tasks: serializeTasks() });
    });
    return true;
  }

  if (message.action === 'remove-task') {
    removeTask(message.url).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.action === 'clear-finished') {
    clearFinished().then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

// On wake-up, eagerly restore so any pending task resumes promptly.
ensureRestored().then(() => schedule());
