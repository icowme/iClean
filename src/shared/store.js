/*! iClean · 浏览器数据清理工具
 *  Copyright (c) 2026 iClean. All rights reserved.
 *  本文件为原创代码，未经授权禁止转载、二次分发或用于商业用途。
 */
/* 配置读写封装（chrome.storage.local） */

function ccGetConfig() {
  return new Promise(function (resolve) {
    chrome.storage.local.get('config', function (res) {
      var cfg = res && res.config ? res.config : {};
      resolve(Object.assign({}, CC_DEFAULT_CONFIG, cfg));
    });
  });
}

function ccSaveConfig(patch) {
  return ccGetConfig().then(function (cfg) {
    var next = Object.assign(cfg, patch);
    return new Promise(function (resolve) {
      chrome.storage.local.set({ config: next }, function () { resolve(next); });
    });
  });
}

/* 白名单匹配：支持 example.com / www.example.com / https://example.com */
function ccIsWhitelisted(origin, whitelist) {
  if (!origin || !whitelist || !whitelist.length) return false;
  var host = '';
  try { host = new URL(origin).hostname; } catch (e) { host = origin; }
  return whitelist.some(function (rule) {
    rule = String(rule).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    if (!rule) return false;
    return host === rule || host.endsWith('.' + rule);
  });
}
