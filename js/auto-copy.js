/*! iClean · 浏览器数据清理工具
 *  Copyright (c) 2026 iClean. All rights reserved.
 *  本文件为原创代码，未经授权禁止转载、二次分发或用于商业用途。
 */
/* 选中文字自动复制
 * ================
 * 在网页里选中文字（鼠标松开）后，自动把选中的文字写入剪贴板，并在右下角
 * 弹一个「已复制」的小提示。
 *
 * 只做必要的处理：
 *   1. 误触发 —— 最短 2 字符；单击不建立选区（isCollapsed）本身就不会触发
 *   2. 输入框内选中 —— 跳过 input / textarea / contenteditable
 *   3. 剪贴板写入失败 —— navigator.clipboard 不可用时回退到 execCommand
 *
 * 为什么不做「同一段文字不重复复制」的去重：
 *   HTML5 拖拽的前提就是「已选中」，所以拖拽结束时那次 mouseup 读到的选区，
 *   必然和选中时是同一段文字——重复写入的内容完全相同，剪贴板毫无变化。
 *   而去重会带来真实副作用：想再复制一次同一段文字时会复制不到。故不做。
 *
 * 开关存在 chrome.storage.sync 的 autoCopy 键（与手势模块的设置同一存储区）。
 */

(function () {
  'use strict';

  var MIN_LEN = 2;      // 少于这个长度不复制（避免点一下就误触发）
  var DELAY = 30;       // 等选区稳定后再读
  var enabled = true;

  /* ── 配置读取 ───────────────────────────────────────────────────────── */
  try {
    chrome.storage.sync.get({ autoCopy: true }, function (r) {
      enabled = r.autoCopy !== false;
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'sync' && changes.autoCopy) {
        enabled = changes.autoCopy.newValue !== false;
      }
    });
  } catch (e) { /* 非扩展环境（预览等）忽略 */ }

  /* ── 主逻辑 ─────────────────────────────────────────────────────────── */
  document.addEventListener('mouseup', function (e) {
    if (!enabled) return;
    if (e.button !== 0) return;                 // 只处理左键
    if (isEditable(e.target)) return;           // 输入框内不处理

    setTimeout(function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      var text = String(sel).trim();
      if (!text || text.length < MIN_LEN) return;
      copyText(text);
    }, DELAY);
  }, true);

  function isEditable(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  /* ── 写剪贴板 ───────────────────────────────────────────────────────── */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showTip(text);
      }).catch(function () {
        legacyCopy(text);
      });
    } else {
      legacyCopy(text);
    }
  }

  /* 回退方案：临时 textarea + execCommand */
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) showTip(text);
    } catch (e) { /* 忽略 */ }
  }

  /* ── 右下角小提示 ───────────────────────────────────────────────────── */
  var tipTimer = null;

  function showTip(text) {
    var short = text.length > 14 ? text.slice(0, 14) + '…' : text;
    var el = document.createElement('div');
    el.textContent = '✓ 已复制：' + short;
    el.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'max-width:280px', 'padding:8px 14px',
      'font:13px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif',
      'color:#fff', 'background:rgba(32,33,36,.92)',
      'border-radius:8px', 'box-shadow:0 4px 16px rgba(0,0,0,.28)',
      'opacity:0', 'transition:opacity .18s ease',
      'pointer-events:none', 'word-break:break-all'
    ].join(';');
    document.documentElement.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = '1'; });

    if (tipTimer) clearTimeout(tipTimer);
    tipTimer = setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 220);
    }, 1200);
  }
})();
