/*! iClean · 浏览器数据清理工具
 *  Copyright (c) 2026 iClean. All rights reserved.
 *  本文件为原创代码，未经授权禁止转载、二次分发或用于商业用途。
 */
/* 鼠标悬停显示密码
 * ================
 * 鼠标移到密码框上 → 立刻把 type="password" 改成 "text"，明文显示；
 * 鼠标移开 → 改回 "password"。
 *
 * 极简实现：不设延时、不加按钮、不做点击模式。只保留"悬停即显示"。
 *
 * 几个必要处理：
 *   1. 用事件委托（document 级），动态生成的密码框（弹窗登录等）同样生效
 *   2. 用 WeakSet 记录"被我们改成明文的元素"，避免误改页面上本来就是 text 的输入框
 *   3. mouseout 时判断 relatedTarget：鼠标在输入框内部移动不算移开，
 *      否则会在框内滑动时反复闪烁
 *   4. 只改 type，不动 value 与其它属性；鼠标移开立即恢复
 *
 * 开关存在 chrome.storage.sync 的 showPassword 键（与手势模块设置同一存储区）。
 */

(function () {
  'use strict';

  var shown = new WeakSet();   // 记录被我们改成明文的输入框
  var enabled = true;

  /* ── 配置读取 ───────────────────────────────────────────────────────── */
  try {
    chrome.storage.sync.get({ showPassword: true }, function (r) {
      enabled = r.showPassword !== false;
      if (!enabled) restoreAll();
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'sync' && changes.showPassword) {
        enabled = changes.showPassword.newValue !== false;
        if (!enabled) restoreAll();
      }
    });
  } catch (e) { /* 非扩展环境忽略 */ }

  /* ── 悬停显示 ───────────────────────────────────────────────────────── */
  document.addEventListener('mouseover', function (e) {
    if (!enabled) return;
    var el = e.target;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'password') return;
    el.type = 'text';
    shown.add(el);
  }, true);

  /* ── 移开恢复 ───────────────────────────────────────────────────────── */
  document.addEventListener('mouseout', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'INPUT' || !shown.has(el)) return;
    // 鼠标仍在输入框内部移动 → 不算移开，避免闪烁
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    el.type = 'password';
    shown.delete(el);
  }, true);

  /* 开关关闭时，把所有已显示的密码恢复原状 */
  function restoreAll() {
    var list = document.querySelectorAll('input[type="text"]');
    for (var i = 0; i < list.length; i++) {
      if (shown.has(list[i])) {
        list[i].type = 'password';
        shown.delete(list[i]);
      }
    }
  }
})();
