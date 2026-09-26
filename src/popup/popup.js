/*! iClean · 浏览器数据清理工具
 *  Copyright (c) 2026 iClean. All rights reserved.
 *  本文件为原创代码，未经授权禁止转载、二次分发或用于商业用途。
 */
/* popup 逻辑 */
(function () {
  var gConfig = null;
  var gTab = null;
  var gOrigin = '';
  var gForbidden = false;
  var gMode = 'site'; // 'site' | 'all'

  function $(id) { return document.getElementById(id); }

  /* 与后台通信：走长连接 port（避免与内置手势模块的全局消息监听冲突） */
  var gPort = null;
  var gSeq = 0;

  function warmPort() {
    if (gPort) return;
    try {
      gPort = chrome.runtime.connect({ name: 'cc-clean' });
      gPort.onDisconnect.addListener(function () { gPort = null; });
    } catch (e) { gPort = null; }
  }

  function ccSend(msg, cb) {
    warmPort();
    if (!gPort) {
      cb({ ok: false, error: '无法连接扩展后台，请刷新扩展后重试' });
      return;
    }
    var id = ++gSeq;
    msg.id = id;
    function onMsg(res) {
      if (!res || res.id !== id) return;
      try { gPort.onMessage.removeListener(onMsg); } catch (e) {}
      cb(res);
    }
    gPort.onMessage.addListener(onMsg);
    try {
      gPort.postMessage(msg);
    } catch (e) {
      gPort = null;
      cb({ ok: false, error: '后台连接已断开，请重试' });
    }
  }

  /* 手势与拖拽配置（FlowMouse 模块，存 chrome.storage.sync） */
  var FM_DEFAULTS = {
    enableGesture: true,
    distanceThreshold: 20,
    enableTextDrag: true,
    enableLinkDrag: true,
    enableImageDrag: true,
    textDragIgnoreInput: false,
    linkDropIgnoreInput: false
  };
  function fmLoad(cb) { chrome.storage.sync.get(FM_DEFAULTS, cb); }
  function fmSave(patch, cb) { chrome.storage.sync.set(patch, function () { cb && cb(); }); }
  /* Tab 切换：当前页 / 全部 */
  function switchTab(mode) {
    gMode = mode;
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.tab === mode);
    });
    $('panel-site').hidden = mode !== 'site';
    $('panel-all').hidden = mode !== 'all';
    // 「仅全局」类型只在「全部」模式下可勾选
    document.querySelectorAll('#types-list input[type="checkbox"]').forEach(function (cb) {
      var isGlobal = !ccIsOriginAware(cb.dataset.key);
      var locked = isGlobal && mode === 'site';
      cb.disabled = locked;
      cb.closest('.type-item').classList.toggle('locked', locked);
    });
    document.querySelectorAll('.group-hint').forEach(function (h) {
      h.style.display = mode === 'all' ? 'none' : '';
    });
  }

  function init(config) {
    gConfig = config;
    // 预热与后台的长连接：SW 可能处于休眠，提前唤醒可省掉点击后的冷启动等待
    warmPort();
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.dataset.tab); });
    });
    $('btn-fold').addEventListener('click', toggleFold);
    setFoldState(config.typesFolded !== false);
    chrome.tabs.query({active:true, currentWindow:true}, function (tabs) {
      var tab = tabs && tabs[0];
      gTab = tab || null;
      updateSiteCard(tab);
      renderTypes(config.selectedTypes || CC_PRESETS.standard);
      // 按实际勾选恢复预设高亮（自定义组合会显示「已自定义」）
      markPreset(matchPreset(getSelectedKeys()));
      renderLastClean(config);
    });
  }

  function updateSiteCard(tab) {
    var host = $('site-host');
    var meta = $('site-meta');
    var card = $('site-card');
    var btn = $('btn-clean-site');
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('edge://') || tab.url.startsWith('data:')) {
      host.textContent = tab && tab.url ? (tab.title || tab.url) : '未知页面';
      meta.textContent = '浏览器内部页面不支持清理';
      card.classList.add('disabled');
      btn.disabled = true; gForbidden = true; gOrigin = '';
      return;
    }
    var origin = '';
    try { origin = new URL(tab.url).origin; } catch (e) { origin = tab.url; }
    gOrigin = origin;
    gForbidden = false;
    host.textContent = tab.title || origin;
    meta.textContent = origin;
    card.classList.remove('disabled');
    btn.disabled = false;

    // 白名单
    ccGetConfig().then(function (cfg) {
      if (ccIsWhitelisted(origin, cfg.whitelist)) {
        meta.textContent = origin + ' · 已加入白名单（跳过清理）';
        card.classList.add('disabled');
        btn.disabled = true;
        gForbidden = true;
      }
    });
  }

  function renderTypes(selected) {
    var wrap = $('types-list');
    wrap.innerHTML = '';
    var groups = {};
    CC_DATA_TYPES.forEach(function (t) {
      (groups[t.group] = groups[t.group] || []).push(t);
    });
    Object.keys(groups).forEach(function (g) {
      var gt = document.createElement('div');
      gt.className = 'group-title';
      gt.textContent = g;
      // 整组都是「仅全局」类型时，在标题旁加自解释提示
      var allGlobal = groups[g].every(function (t) { return !ccIsOriginAware(t.key); });
      if (allGlobal) {
        var hint = document.createElement('span');
        hint.className = 'group-hint';
        hint.textContent = '切到「全部」标签后可清理';
        gt.appendChild(hint);
      }
      wrap.appendChild(gt);
      groups[g].forEach(function (t) {
        var row = document.createElement('label');
        row.className = 'type-item';
        var isGlobal = !ccIsOriginAware(t.key);
        var locked = isGlobal && gMode === 'site';
        if (locked) row.classList.add('locked');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selected.indexOf(t.key) !== -1;
        cb.disabled = locked;
        cb.dataset.key = t.key;
        cb.addEventListener('change', function () {
          updateFoldSummary();
          saveSelection();
        });
        var content = document.createElement('span');
        content.className = 'content';
        var name = document.createElement('span');
        name.className = 'name';
        name.textContent = t.label;
        var desc = document.createElement('span');
        desc.className = 'desc';
        desc.textContent = t.desc || '';
        content.appendChild(name);
        content.appendChild(desc);
        var tag = document.createElement('span');
        tag.className = 'tag';
        if (isGlobal) {
          tag.className += ' global';
          tag.textContent = '全局';
          tag.title = '该类型不支持按站点清理，切换到「全部」标签后可勾选';
        }
        else if (t.risk === 'high' || t.risk === 'extreme') { tag.className += ' danger'; tag.textContent = '高'; }
        row.appendChild(cb);
        row.appendChild(content);
        if (tag.textContent) row.appendChild(tag);
        wrap.appendChild(row);
      });
    });
    updateFoldSummary();
    bindPresets();
  }

  /* 类型清单整体折叠/展开 */
  function setFoldState(folded) {
    $('types-body').hidden = folded;
    $('types-fold').classList.toggle('open', !folded);
  }

  function toggleFold() {
    var folded = $('types-body').hidden;
    setFoldState(!folded);
    gConfig.typesFolded = !folded;
    ccSaveConfig({ typesFolded: !folded });
  }

  function updateFoldSummary() {
    var el = $('fold-summary');
    if (!el) return;
    el.textContent = '已选 ' + getSelectedKeys().length + ' 类';
  }

  function getSelectedKeys() {
    var keys = [];
    document.querySelectorAll('#types-list input[type="checkbox"]').forEach(function (cb) {
      if (cb.checked) keys.push(cb.dataset.key);
    });
    return keys;
  }

  function setPreset(name) {
    // 「自定义」保留当前勾选，仅切换模式标记
    if (name === 'custom') {
      gConfig.preset = 'custom';
      ccSaveConfig({ preset: 'custom' });
      markPreset('custom');
      return;
    }
    var preset = CC_PRESETS[name] || CC_PRESETS.standard;
    gConfig.selectedTypes = preset.slice();
    gConfig.preset = name;
    ccSaveConfig({ selectedTypes: preset, preset: name });
    renderTypes(preset);
    markPreset(name);
  }

  /* 高亮与预设一致的 chip；自定义组合时显示「已自定义」 */
  function markPreset(name) {
    // 未匹配任何预设（自定义组合）时高亮「自定义」
    var target = name || 'custom';
    document.querySelectorAll('.presets .chip').forEach(function (c) {
      c.classList.toggle('is-active', c.dataset.preset === target);
    });
  }

  /* 判断当前勾选组合是否与某个预设一致 */
  function matchPreset(keys) {
    var sorted = keys.slice().sort().join(',');
    var matched = null;
    Object.keys(CC_PRESETS).forEach(function (k) {
      if (CC_PRESETS[k].slice().sort().join(',') === sorted) matched = k;
    });
    return matched;
  }

  /* 手动勾选：立即保存记忆；若与某个预设完全一致则回到该预设状态 */
  function saveSelection() {
    var keys = getSelectedKeys();
    var matched = matchPreset(keys);
    gConfig.selectedTypes = keys;
    gConfig.preset = matched || 'custom';
    markPreset(matched);
    ccSaveConfig({ selectedTypes: keys, preset: gConfig.preset });
  }

  function bindPresets() {
    document.querySelectorAll('.presets .chip').forEach(function (c) {
      c.onclick = function () { setPreset(c.dataset.preset); };
    });
  }

  function showConfirm(title, body, onOk) {
    $('confirm-title').textContent = title;
    $('confirm-body').innerHTML = body;
    $('confirm-mask').classList.add('show');
    function ok() { hide(); onOk && onOk(); }
    function hide() { $('confirm-mask').classList.remove('show'); $('confirm-ok').onclick = null; $('confirm-cancel').onclick = null; }
    $('confirm-ok').onclick = ok;
    $('confirm-cancel').onclick = hide;
  }

  function toast(msg, type) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (type || 'ok');
    setTimeout(function () { t.classList.remove('show'); }, 2500);
  }

  /* 后台清理状态：慢速类型（缓存/Cache Storage/SW 等）在后台继续时，
     按钮显示「后台清理中…」并轮询后台状态，全部完成后再恢复并提示 */
  var gBgTimer = null;

  function watchBackgroundClean(slowPending, btnId) {
    if (!slowPending) return;
    var btn = $(btnId || 'btn-clean-site');
    if (!btn) return;
    var baseText = btn.textContent;
    var ticks = 0;
    var stop = function (done) {
      if (gBgTimer) { clearInterval(gBgTimer); gBgTimer = null; }
      btn.textContent = baseText;
      btn.title = '';
      btn.classList.remove('is-bg');
      if (done) toast('后台清理完成（缓存等 ' + slowPending + ' 项）');
    };
    btn.textContent = '⏳ 后台清理中…';
    btn.title = '缓存等较慢的类型正在后台清理，可继续操作';
    btn.classList.add('is-bg');
    if (gBgTimer) clearInterval(gBgTimer);
    gBgTimer = setInterval(function () {
      ticks++;
      ccSend({ action: 'bgStatus' }, function (res) {
        var busy = (res && res.busy) || [];
        if (!busy.length) stop(true);
        else if (ticks > 60) stop(false);   // 最多轮询 60 秒，避免一直挂着
      });
    }, 1000);
  }

  /* 清理当前页面 */
  $('btn-clean-site').onclick = function () {
    if (gForbidden || !gOrigin) return;
    var keys = getSelectedKeys().filter(ccIsOriginAware);
    if (!keys.length) { toast('未选择可清理的类型', 'err'); return; }
    var btn = this;
    var oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ 正在清理…';
    var t0 = Date.now();
    // 直接执行，不弹确认框；完成后由后台自动刷新该页面
    ccSend({
      action: 'cleanSite',
      origin: gOrigin,
      tabId: gTab && gTab.id,
      keys: keys,
      refresh: true,
      refreshDelay: 600 // 先让结果提示显示完，再刷新页面（结果同时写入底部常驻）
    }, function (res) {
      btn.disabled = false;
      btn.textContent = oldText;
      if (res && res.ok) {
        var sec = ((Date.now() - t0) / 1000).toFixed(1);
        var swSec = res.elapsed ? (res.elapsed / 1000).toFixed(2) : '?';
        var tail = res.slowPending ? '，其余 ' + res.slowPending + ' 项后台清理中' : '';
        watchBackgroundClean(res.slowPending);
        // 同时给出后台实际耗时与总耗时：两者接近说明清理本身慢，差距大说明卡在通道/后台启动
        toast('已清理 ' + (res.cleared || []).length + ' 类 · 后台 ' + swSec + 's / 总 ' + sec + 's' + tail);
      } else {
        toast(res && res.error ? res.error : '清理失败', 'err');
      }
    });
  };

  /* 时间范围标签（替代原下拉） */
  var gTimeRange = 0;
  document.querySelectorAll('#time-chips .chip').forEach(function (chip) {
    chip.onclick = function () {
      document.querySelectorAll('#time-chips .chip').forEach(function (x) {
        x.classList.toggle('is-active', x === chip);
      });
      gTimeRange = parseInt(chip.dataset.range, 10) || 0;
    };
  });

  /* 清理全部：按钮内联二次确认（点第一次变为警示态，3 秒内再点才执行） */
  var gAllArmed = false;
  var gAllTimer = null;

  function resetAllBtn(btn) {
    gAllArmed = false;
    if (gAllTimer) { clearTimeout(gAllTimer); gAllTimer = null; }
    btn.textContent = btn.dataset.orig || '🗑 清理全部数据';
    btn.classList.remove('btn-armed');
  }

  $('btn-clean-all').onclick = function () {
    var btn = this;
    var keys = getSelectedKeys();
    if (!keys.length) { toast('请先选择要清理的类型', 'err'); return; }

    if (!gAllArmed) {
      gAllArmed = true;
      if (!btn.dataset.orig) btn.dataset.orig = btn.textContent;
      btn.textContent = '⚠️ 再次点击确认清理（' + keys.length + ' 类）';
      btn.classList.add('btn-armed');
      gAllTimer = setTimeout(function () { resetAllBtn(btn); }, 3000);
      return;
    }

    resetAllBtn(btn);
    var since = gTimeRange ? (Date.now() - gTimeRange) : 0;
    // 默认清理后自动刷新所有网页
    ccSend({
      action: 'cleanAll',
      keys: keys,
      since: since,
      refreshAll: true
    }, function (res) {
      if (res && res.ok) {
        var sec = res.elapsed ? (res.elapsed / 1000).toFixed(2) : '?';
        var tail = res.slowPending ? '，其余 ' + res.slowPending + ' 项后台清理中' : '';
        toast('全局清理完成 · 共 ' + keys.length + ' 类 · 后台 ' + sec + 's' + tail);
        // 有慢项时本按钮显示「后台清理中…」并轮询后台状态
        watchBackgroundClean(res.slowPending, 'btn-clean-all');
        // 后台写入 lastClean 在回包之后，稍等一下再读，否则会读到旧值
        setTimeout(function () { ccGetConfig().then(renderLastClean); }, 400);
      } else {
        toast(res && res.error ? res.error : '清理失败', 'err');
      }
    });
  };

  /* 上次清理结果（提示被页面刷新吃掉后仍可在这里查看） */
  function renderLastClean(cfg) {
    var lc = cfg && cfg.lastClean;
    var text = '';
    if (lc) {
      var ago = Math.round((Date.now() - lc.at) / 60000);
      var when = ago < 1 ? '刚刚' : ago < 60 ? ago + ' 分钟前' : Math.round(ago / 60) + ' 小时前';
      text = '上次清理 ' + when + ' · ' + lc.count + ' 类 · 后台 ' +
        (lc.elapsed / 1000).toFixed(2) + 's' +
        (lc.slowPending ? '（另有 ' + lc.slowPending + ' 项后台清理）' : '');
    }
    // 主视图底部一份（两个标签页共用同一位置）
    var el = $('last-clean');
    if (el) el.textContent = text;
  }

  /* 视图切换：主视图 / 内嵌设置 */
  function switchView(v) {
    $('view-main').hidden = v !== 'main';
    $('view-settings').hidden = v !== 'settings';
    if (v === 'settings') renderSettings();
    else {
      // 回到主视图时刷新（白名单可能已变更）
      ccGetConfig().then(function (cfg) {
        gConfig = cfg;
        updateSiteCard(gTab);
        renderLastClean(cfg);
      });
    }
  }

  function renderSettings() {
    ccGetConfig().then(function (cfg) {
      gConfig = cfg;
      // 白名单
      $('whitelist-input').value = (cfg.whitelist || []).join('\n');
    });
    // 手势与拖拽（配置来自 FlowMouse 模块的 sync 存储）
    fmLoad(function (fm) {
      $('gs-nav').checked = fm.enableGesture !== false;
      $('gs-threshold').value = String(fm.distanceThreshold || 20);
      $('dg-on').checked = !(fm.enableTextDrag === false && fm.enableLinkDrag === false && fm.enableImageDrag === false);
      $('dg-search').checked = fm.enableTextDrag !== false;
      $('dg-link').checked = fm.enableLinkDrag !== false;
      $('dg-img').checked = fm.enableImageDrag !== false;
      $('dg-input').checked = fm.textDragIgnoreInput === true && fm.linkDropIgnoreInput === true;
      syncDragChildren();
    });
    // 书签新标签开关与改写状态
    ccGetConfig().then(function (c) {
      chrome.storage.sync.get('settings', function (res) {
      var st = res && res.settings ? res.settings : {};
      $('bm-newtab').checked = st.enabled !== false;
    });
    });
  }

    /* 拖拽子项跟随总开关启用/禁用 */
  function syncDragChildren() {
    var on = $('dg-on').checked;
    ['dg-search', 'dg-link', 'dg-img', 'dg-input'].forEach(function (id) {
      $(id).disabled = !on;
    });
  }

  $('btn-options').onclick = function () { switchView('settings'); };
  $('btn-back').onclick = function () { switchView('main'); };

  $('btn-save-wl').onclick = function () {
    var lines = $('whitelist-input').value.split(/[\r\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    ccSaveConfig({ whitelist: lines }).then(function (next) {
      gConfig = next;
      toast('白名单已保存（' + lines.length + ' 个站点）');
    });
  };

  /* 手势与拖拽设置（写入 FlowMouse 模块的 sync 配置） */
  $('gs-nav').addEventListener('change', function () {
    var on = this.checked;
    fmSave({ enableGesture: on }, function () {
      toast(on ? '已开启右键手势（左后退 / 右前进）' : '已关闭右键手势');
    });
  });
  /* 鼠标悬停显示密码（设置存在 sync 存储的 showPassword 键） */
  chrome.storage.sync.get({ showPassword: true }, function (r) {
    var el = $('pw-on');
    if (el) el.checked = r.showPassword !== false;
  });

  $('pw-on').addEventListener('change', function () {
    var on = this.checked;
    chrome.storage.sync.set({ showPassword: on }, function () {
      void chrome.runtime.lastError;
      toast(on ? '已开启：鼠标悬停显示密码' : '已关闭：鼠标悬停显示密码');
    });
  });

  /* 选中文字自动复制（设置存在 sync 存储的 autoCopy 键，由 content script 读取） */
  chrome.storage.sync.get({ autoCopy: true }, function (r) {
    var el = $('ac-on');
    if (el) el.checked = r.autoCopy !== false;
  });

  $('ac-on').addEventListener('change', function () {
    var on = this.checked;
    chrome.storage.sync.set({ autoCopy: on }, function () {
      void chrome.runtime.lastError;
      toast(on ? '已开启：选中文字自动复制' : '已关闭：选中文字自动复制');
    });
  });

  $('gs-threshold').addEventListener('change', function () {
    fmSave({ distanceThreshold: parseInt(this.value, 10) || 20 });
  });
  $('dg-on').addEventListener('change', function () {
    var on = this.checked;
    syncDragChildren();
    fmSave({ enableTextDrag: on, enableLinkDrag: on, enableImageDrag: on }, function () {
      toast(on ? '已开启超级拖拽' : '已关闭超级拖拽');
    });
  });
  $('dg-search').addEventListener('change', function () {
    fmSave({ enableTextDrag: this.checked });
  });
  $('dg-link').addEventListener('change', function () {
    fmSave({ enableLinkDrag: this.checked });
  });
  $('dg-img').addEventListener('change', function () {
    fmSave({ enableImageDrag: this.checked });
  });
  $('dg-input').addEventListener('change', function () {
    var v = this.checked;
    fmSave({ textDragIgnoreInput: v, linkDropIgnoreInput: v });
  });


  /* 书签新标签开关：后台监听 storage 变化后自动注册/注销监听 */
$('bm-newtab').addEventListener('change', function () {
    var on = this.checked;
    // 由后台模块负责改写/还原书签与开关重定向规则
    chrome.runtime.sendMessage({ type: 'updateSettings', data: { enabled: on } }, function () {
      void chrome.runtime.lastError;
      toast(on ? '已开启：点击书签将在新标签打开' : '已关闭：正在还原书签…');
    });
  });


  // 启动
  /* 赞赏作者：点按钮显示赞赏码，点遮罩关闭 */
  var donateMask = $('donate-mask');
  if (donateMask) {
    $('btn-donate').onclick = function (e) {
      e.stopPropagation();
      donateMask.classList.add('show');
    };
    donateMask.onclick = function () { donateMask.classList.remove('show'); };
  }

  /* 折叠框内的两个标签：清理项目 / 白名单 */
  document.querySelectorAll('.mini-tab').forEach(function (tab) {
    tab.onclick = function () {
      document.querySelectorAll('.mini-tab').forEach(function (x) {
        x.classList.toggle('is-active', x === tab);
      });
      var which = tab.dataset.ctab;
      var typesPane = $('ctab-types');
      var wlPane = $('ctab-whitelist');
      if (typesPane) typesPane.hidden = which !== 'types';
      if (wlPane) wlPane.hidden = which !== 'whitelist';
    };
  });

  /* 高级功能页右上角的版本号（取自 manifest） */
  try {
    var verEl = $('app-version');
    if (verEl) verEl.textContent = 'v' + chrome.runtime.getManifest().version;
  } catch (e) { /* 非扩展环境忽略 */ }

  ccGetConfig().then(init);

  /* 手势一览（折叠区）：调用共享渲染 */
  ccRenderGestureList('gesture-list', 'gesture-summary');
})();
