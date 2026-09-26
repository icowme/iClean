/*! iClean · 浏览器数据清理工具
 *  Copyright (c) 2026 iClean. All rights reserved.
 *  本文件为原创代码，未经授权禁止转载、二次分发或用于商业用途。
 */
/* 手势一览渲染 —— popup 设置视图与独立设置页共用。
   依赖 js/constants.js 提供的 window.GestureConstants
   （DEFAULT_GESTURES / DEFAULT_SETTINGS / ACTION_KEYS）。
   显示的是「实际生效」的映射：开了自定义绑定读 storage，否则用内置默认。 */
function ccGestureActionName(action) {
  var C = window.GestureConstants || {};
  var key = (C.ACTION_KEYS || {})[action];
  var name = key && chrome.i18n ? (chrome.i18n.getMessage(key) || '') : '';
  return name || action;
}

/* 预览兜底：普通浏览器（无 constants.js / 无扩展 API）时用于示意 */
var CC_PREVIEW_GESTURES = {
  '←': '后退', '→': '前进', '↑': '向上滚动', '↓': '向下滚动',
  '↑←': '切到左侧标签', '↑→': '切到右侧标签',
  '→↑': '新标签页', '→↓': '刷新',
  '↓←': '撤回关闭标签', '↓→': '关闭标签',
  '←↑': '撤回关闭标签', '←↓': '关闭所有标签',
  '↑↓': '滚动到页底', '↓↑': '滚动到页顶',
  '←→': '关闭标签', '→←': '撤回关闭标签'
};
var CC_PREVIEW_DRAGS = [
  ['拖动文字', '搜索（→）'],
  ['拖动链接', '新标签打开（→）'],
  ['拖动图片', '新标签打开（→）']
];

function ccRenderGestureList(boxId, summaryId) {
  var box = document.getElementById(boxId);
  if (!box) return;
  var C = window.GestureConstants || {};

  var row = function (key, val) {
    return '<div class="g-row"><span class="g-key">' + key + '</span><span class="g-act">' + val + '</span></div>';
  };
  var setSummary = function (n, fromCustom) {
    var el = summaryId ? document.getElementById(summaryId) : null;
    if (el) el.textContent = '手势一览 · 共 ' + n + ' 个';
    return n;
  };

  // 预览环境：直接示意
  if (!C.DEFAULT_GESTURES) {
    var ph = '', pn = 0;
    Object.keys(CC_PREVIEW_GESTURES).forEach(function (pat) {
      pn++;
      ph += row(pat, CC_PREVIEW_GESTURES[pat]);
    });
    CC_PREVIEW_DRAGS.forEach(function (d) {
      pn++;
      ph += row(d[0], d[1]);
    });
    box.innerHTML = ph + '<div class="g-note">预览示意（真机读取实际配置）</div>';
    setSummary(pn, false);
    return;
  }

  var paint = function (items) {
    var custom = items.enableGestureCustomization === true;
    var map = (custom && items.mouseGestures) ? items.mouseGestures : (C.DEFAULT_GESTURES || {});
    var DS = C.DEFAULT_SETTINGS || {};
    var html = '', n = 0;
    Object.keys(map).forEach(function (pat) {
      var act = map[pat];
      if (!act || act === 'none') return;
      n++;
      html += row(pat, ccGestureActionName(act));
    });
    [
      ['拖动文字', items.textDragGestures || DS.textDragGestures],
      ['拖动链接', items.linkDragGestures || DS.linkDragGestures],
      ['拖动图片', items.imageDragGestures || DS.imageDragGestures]
    ].forEach(function (d) {
      var acts = [];
      (d[1] || []).forEach(function (it) {
        if (it && it.action && it.action !== 'none') {
          acts.push(ccGestureActionName(it.action) + (it.direction ? '（' + it.direction + '）' : ''));
        }
      });
      if (!acts.length) return;
      n++;
      html += row(d[0], acts.join(' / '));
    });
    box.innerHTML = html + '<div class="g-note">' + (custom ? '来自你的自定义绑定' : '内置默认映射') + '</div>';
    setSummary(n, custom);
  };

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(null, function (items) { paint(items || {}); });
  } else {
    paint({});
  }
}
