/*! iClean · 浏览器数据清理工具
 *  Copyright (c) 2026 iClean. All rights reserved.
 *  本文件为原创代码，未经授权禁止转载、二次分发或用于商业用途。
 */
(function () {
  function $(id) { return document.getElementById(id); }

  var FM_DEFAULTS = {
    enableGesture: true,
    distanceThreshold: 20,
    enableTextDrag: true,
    enableLinkDrag: true,
    enableImageDrag: true,
    textDragIgnoreInput: false,
    linkDropIgnoreInput: false
  };

  ccGetConfig().then(function (cfg) {
    $('whitelist').value = (cfg.whitelist || []).join('\n');
    chrome.storage.sync.get('settings', function (res) {
      var st = res && res.settings ? res.settings : {};
      $('bm-newtab').checked = st.enabled !== false;
    });
  });


  /* 与后台通信（走长连接，避免与手势模块的消息监听冲突） */
  var gPort = null, gSeq = 0;
  function ccSend(msg, cb) {
    if (!gPort) {
      try {
        gPort = chrome.runtime.connect({ name: 'cc-clean' });
        gPort.onDisconnect.addListener(function () { gPort = null; });
      } catch (e) { cb({ ok: false, error: '无法连接扩展后台' }); return; }
    }
    var id = ++gSeq;
    msg.id = id;
    function onMsg(res) {
      if (!res || res.id !== id) return;
      try { gPort.onMessage.removeListener(onMsg); } catch (e) {}
      cb(res);
    }
    gPort.onMessage.addListener(onMsg);
    gPort.postMessage(msg);
  }

  /* 状态行：改写数量 + 端点可用性与实测延迟 */
$('bm-newtab').addEventListener('change', function () {
    var on = this.checked;
    // 由后台模块负责改写/还原书签与开关重定向规则
    chrome.runtime.sendMessage({ type: 'updateSettings', data: { enabled: on } }, function () {
      void chrome.runtime.lastError;
      toast(on ? '已开启：点击书签将在新标签打开' : '已关闭：正在还原书签…');
    });
  });


  chrome.storage.sync.get(FM_DEFAULTS, function (fm) {
    $('gs-nav').checked = fm.enableGesture !== false;
    $('gs-threshold').value = String(fm.distanceThreshold || 20);
    $('dg-on').checked = !(fm.enableTextDrag === false && fm.enableLinkDrag === false && fm.enableImageDrag === false);
    $('dg-search').checked = fm.enableTextDrag !== false;
    $('dg-link').checked = fm.enableLinkDrag !== false;
    $('dg-img').checked = fm.enableImageDrag !== false;
    $('dg-input').checked = fm.textDragIgnoreInput === true && fm.linkDropIgnoreInput === true;
    syncDragChildren();
  });

  function syncDragChildren() {
    var on = $('dg-on').checked;
    ['dg-search', 'dg-link', 'dg-img', 'dg-input'].forEach(function (id) {
      $(id).disabled = !on;
    });
  }
  // 开关位于折叠标题内：点击时不要连带展开/收起
  $('dg-on').addEventListener('click', function (e) { e.stopPropagation(); });
  $('dg-on').addEventListener('change', syncDragChildren);

  $('btn-save').onclick = function () {
    var lines = $('whitelist').value.split(/[\r\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    ccSaveConfig({
      whitelist: lines
    });
    var dragOn = $('dg-on').checked;
    var ignoreInput = $('dg-input').checked;
    chrome.storage.sync.set({
      enableGesture: $('gs-nav').checked,
      distanceThreshold: parseInt($('gs-threshold').value, 10) || 20,
      enableTextDrag: dragOn && $('dg-search').checked,
      enableLinkDrag: dragOn && $('dg-link').checked,
      enableImageDrag: dragOn && $('dg-img').checked,
      textDragIgnoreInput: ignoreInput,
      linkDropIgnoreInput: ignoreInput
    }, function () {
      alert('已保存');
    });
  };

  /* 手势一览：调用共享渲染（src/shared/gestureList.js） */
  ccRenderGestureList('gesture-list', 'gesture-summary');

  $('btn-reset').onclick = function () {
    if (!confirm('确定恢复默认设置？')) return;
    chrome.storage.local.remove('config', function () {
      location.reload();
    });
  };
})();
