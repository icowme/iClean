/*! iClean · 浏览器数据清理工具
 *  Copyright (c) 2026 iClean. All rights reserved.
 *  本文件为原创代码，未经授权禁止转载、二次分发或用于商业用途。
 */
/* Service Worker
   —— 负责：清理浏览数据（本扩展功能）
   —— 同时加载 FlowMouse 手势模块的后台动作执行器（js/background.js，GPL v3，见 LICENSE-flowmouse-GPLv3.txt）
   两者通过不同的通信通道工作，互不干扰：
   · 本扩展 popup 走长连接 port('cc-clean')
   · 手势模块走 chrome.runtime.onMessage（其监听器会响应所有消息，故本扩展不使用该通道） */

/* ===== 书签「新标签页打开」模块 =====
   移植自 Open Bookmarks in New Tab（MIT License，见 LICENSE-open-bookmarks-MIT.txt）
   原理：书签 URL 加 newtab@ 标记 → declarativeNetRequest 重定向到扩展内
   cancel.html → 本 Service Worker 的 fetch 拦截直接返回 204 No Content
   （浏览器收到 204 不会离开当前文档）→ 当前页完全不动，全程零网络请求。 */
const CANCEL_URL = chrome.runtime.getURL('cancel.html');
self.addEventListener('fetch', (event) => {
  if (event.request.url !== CANCEL_URL || event.request.method !== 'GET') return;
  event.respondWith(new Response(null, {
    status: 204,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  }));
});

importScripts('/src/shared/dataTypes.js');
importScripts('/src/shared/store.js');
importScripts('/src/shared/cleaner.js');


/* ===== FlowMouse 手势 / 拖拽后台动作（第三方，GPL v3） ===== */
importScripts('/js/background.js');

/* 书签模块（模块间共享顶层作用域，加载顺序不可调换） */
importScripts('/js/bookmark-worker/config.js');
importScripts('/js/bookmark-worker/settings.js');
importScripts('/js/bookmark-worker/urls.js');
importScripts('/js/bookmark-worker/bookmarks.js');
importScripts('/js/bookmark-worker/navigation.js');
importScripts('/js/bookmark-worker/lifecycle.js');

/* 清除手势模块可能残留的图标角标（其原逻辑会在受限页面显示橙色 !、
   需要刷新时显示蓝色 !，本扩展已将该提示禁用，这里再清一次历史残留） */
function ccClearBadges() {
  chrome.tabs.query({}, function (tabs) {
    (tabs || []).forEach(function (t) {
      chrome.action.setBadgeText({ tabId: t.id, text: '' }, function () { void chrome.runtime.lastError; });
    });
  });
}
ccClearBadges();
chrome.runtime.onStartup.addListener(ccClearBadges);
chrome.runtime.onInstalled.addListener(ccClearBadges);


/* ===== 清理指令：popup 通过长连接下发 ===== */
/* 类型分两批：
   存储类（Cookie / localStorage / IndexedDB 等）通常毫秒级 → 清完立即反馈并刷新
   其余（HTTP 缓存 / Cache Storage / Service Worker，以及需向页面注入脚本的 sessionStorage）
   由 Chrome 内部或页面主线程决定耗时，可能达数秒 → 放后台继续，不让用户干等 */
var CC_FAST_TYPES = ['cookies', 'localStorage', 'indexedDB', 'fileSystems'];
var CC_SW_START = Date.now();

/* 后台慢批：同一站点同时只跑一个，避免连续点击时多个慢批并发争抢磁盘 IO。
   若某站点正在清理，期间的重复请求被记为「待补跑」，当前批结束后自动再跑一轮，
   保证用户后来产生的新缓存也能被清掉。 */
var ccBgBusy = {};   // origin -> true（正在后台清理）
var ccBgAgain = {};  // origin -> true（清理期间又收到了请求）

function ccRunSlowBatch(origin, tabId, keys) {
  if (ccBgBusy[origin]) {
    ccBgAgain[origin] = true;
    console.debug('[iClean] 该站点后台清理进行中，本轮请求合并（' + origin + '）');
    return;
  }
  ccBgBusy[origin] = true;
  var ts = Date.now();
  ccCleanSite(origin, tabId, keys)
    .then(function (clearedSlow) {
      console.debug('[iClean] 后台清理完成 ' + origin + ' 耗时 ' + (Date.now() - ts) + 'ms，类型：' + clearedSlow.join(', '));
    })
    .catch(function (e) { console.debug('[iClean] 后台清理失败：', e); })
    .then(function () {
      delete ccBgBusy[origin];
      if (ccBgAgain[origin]) {
        delete ccBgAgain[origin];
        console.debug('[iClean] 检测到清理期间有新请求，补充清理 ' + origin);
        ccRunSlowBatch(origin, tabId, keys);
      }
    });
}

/* 全局慢批：与按站点的慢批分开管理（去重 + 补跑），避免重复点击时并发 */
var ccBgBusyAll = false;
var ccBgAgainAll = false;

function ccRunSlowBatchAll(keys, since) {
  if (ccBgBusyAll) { ccBgAgainAll = true; return; }
  ccBgBusyAll = true;
  var ts = Date.now();
  ccCleanAll(keys, since)
    .then(function () {
      console.debug('[iClean] 后台全局清理完成 耗时 ' + (Date.now() - ts) + 'ms，类型：' + keys.join(', '));
    })
    .catch(function (e) { console.debug('[iClean] 后台全局清理失败：', e); })
    .then(function () {
      ccBgBusyAll = false;
      if (ccBgAgainAll) {
        ccBgAgainAll = false;
        console.debug('[iClean] 检测到清理期间有新请求，补充全局清理');
        ccRunSlowBatchAll(keys, since);
      }
    });
}

/* 清理完成后刷新所有 http(s) 网页（逐个错开，避免同时刷新过多） */
function ccRefreshAllTabs() {
  setTimeout(function () {
    chrome.tabs.query({}, function (tabs) {
      var list = (tabs || []).filter(function (t) { return t.url && /^https?:/i.test(t.url); });
      list.forEach(function (t, i) {
        setTimeout(function () {
          chrome.tabs.reload(t.id, function () { void chrome.runtime.lastError; });
        }, i * 60);
      });
      console.debug('[iClean] 已触发刷新 ' + list.length + ' 个网页');
    });
  }, 500);
}

function ccSplitTypes(keys) {
  var fast = [], slow = [];
  keys.forEach(function (k) {
    if (CC_FAST_TYPES.indexOf(k) >= 0) fast.push(k);
    else slow.push(k);
  });
  return { fast: fast, slow: slow };
}

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== 'cc-clean') return;
  port.onMessage.addListener(function (msg) {
    if (!msg || !msg.action) return;
    var reply = function (payload) {
      payload.id = msg.id;
      try { port.postMessage(payload); } catch (e) { /* popup 已关闭 */ }
    };
    if (msg.action === 'cleanSite') {
      var t0 = Date.now();
      var parts = ccSplitTypes(msg.keys);

      ccCleanSite(msg.origin, msg.tabId, parts.fast)
        .then(function (clearedFast) {
          var cost = Date.now() - t0;
          console.debug('[iClean] 存储类清理完成 ' + msg.origin + ' 耗时 ' + cost + 'ms' +
            '（SW 已运行 ' + (Date.now() - CC_SW_START) + 'ms）；后台继续 ' + parts.slow.length + ' 项：' + parts.slow.join(', '));
          reply({ ok: true, cleared: clearedFast, elapsed: cost, slowPending: parts.slow.length });

          // 记录本次结果：popup 底部会显示，避免提示被页面刷新吃掉后无处可查
          ccSaveConfig({
            lastClean: {
              at: Date.now(),
              origin: msg.origin,
              count: clearedFast.length,
              elapsed: cost,
              slowPending: parts.slow.length
            }
          });

          // 刷新与后台清理并行进行；支持延迟刷新，让结果提示先显示完
          if (msg.refresh && msg.tabId) {
            var delay = typeof msg.refreshDelay === 'number' ? msg.refreshDelay : 0;
            var doReload = function () {
              chrome.tabs.reload(msg.tabId, function () { void chrome.runtime.lastError; });
            };
            if (delay > 0) setTimeout(doReload, delay);
            else doReload();
          }

          // 缓存类 / 需注入脚本的类型放后台继续，不阻塞反馈
          if (parts.slow.length) ccRunSlowBatch(msg.origin, msg.tabId, parts.slow);
        })
        .catch(function (e) { reply({ ok: false, error: e && e.message ? e.message : String(e) }); });
    } else if (msg.action === 'bgStatus') {
      reply({ ok: true, busy: Object.keys(ccBgBusy).concat(ccBgBusyAll ? ['__all__'] : []) });
    } else if (msg.action === 'cleanAll') {
      var t0 = Date.now();
      var parts = ccSplitTypes(msg.keys);

      // 慢项（缓存 / Cache Storage / SW / 历史 / 下载等）放后台继续，不阻塞反馈
      if (parts.slow.length) ccRunSlowBatchAll(parts.slow, msg.since);

      if (!parts.fast.length) {
        reply({ ok: true, cleared: [], elapsed: 0, slowPending: parts.slow.length });
        ccSaveConfig({
          lastClean: {
            at: Date.now(),
            origin: '（全部站点）',
            count: 0,
            elapsed: 0,
            slowPending: parts.slow.length
          }
        });
        if (msg.refreshAll) ccRefreshAllTabs();
        return;
      }

      ccCleanAll(parts.fast, msg.since)
        .then(function (clearedFast) {
          var cost = Date.now() - t0;
          console.debug('[iClean] 全局清理（存储类）完成 耗时 ' + cost + 'ms；后台继续 ' +
            parts.slow.length + ' 项：' + parts.slow.join(', '));
          reply({ ok: true, cleared: clearedFast, elapsed: cost, slowPending: parts.slow.length });

          // 记录本次结果：popup 底部常驻显示
          ccSaveConfig({
            lastClean: {
              at: Date.now(),
              origin: '（全部站点）',
              count: clearedFast.length,
              elapsed: cost,
              slowPending: parts.slow.length
            }
          });

          if (msg.refreshAll) ccRefreshAllTabs();
        })
        .catch(function (e) { reply({ ok: false, error: e && e.message ? e.message : String(e) }); });
    }
  });
});


/* 快捷键：清理当前页面 */
chrome.commands.onCommand.addListener(function (cmd) {
  if (cmd !== 'clean-current-page') return;
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab || !tab.url) return;
    var origin = '';
    try { origin = new URL(tab.url).origin; } catch (e) { return; }
    ccCleanSite(origin, tab.id, CC_PRESETS.standard).catch(function () {});
  });
});
