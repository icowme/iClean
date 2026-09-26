/* 预览降级：在非扩展环境（如普通浏览器/预览面板）提供 chrome.* 的 mock，
   让 popup 的界面和交互可以正常渲染、演示。扩展环境中自动跳过。 */
(function () {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && chrome.tabs) return;

  var LS_KEY = 'cc_config_mock';
  var LS_SYNC = 'cc_sync_mock';
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; }
  }
  function write(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

  function area(key) {
    return {
      get: function (defaults, cb) {
        var stored = read(key);
        if (typeof defaults === 'function') { cb(stored); return; }
        var out = {};
        Object.keys(defaults || {}).forEach(function (k) {
          out[k] = (k in stored) ? stored[k] : defaults[k];
        });
        cb(out);
      },
      set: function (obj, cb) {
        var d = read(key); Object.assign(d, obj); write(key, d); if (cb) cb();
      },
      remove: function (k, cb) {
        var d = read(key); delete d[k]; write(key, d); if (cb) cb();
      }
    };
  }

  window.chrome = {
    storage: {
      local: area(LS_KEY),
      sync: area(LS_SYNC)
    },
    tabs: {
      query: function (q, cb) {
        cb([{ id: 1, url: 'https://www.example.com/', title: 'Example Domain —— 一个示例网页标题' }]);
      }
    },
    scripting: {
      executeScript: function () {
        return Promise.resolve([{ result: 13 * 1024 * 1024 }]);
      }
    },
    runtime: {
      connect: function () {
        var listeners = [];
        return {
          name: 'cc-clean',
          postMessage: function (msg) {
            setTimeout(function () {
              listeners.forEach(function (f) {
                f({ id: msg.id, ok: true, cleared: (msg.keys || []).slice() });
              });
            }, 400);
          },
          onMessage: {
            addListener: function (f) { listeners.push(f); },
            removeListener: function (f) {
              var i = listeners.indexOf(f);
              if (i >= 0) listeners.splice(i, 1);
            }
          },
          onDisconnect: { addListener: function () {} }
        };
      },
      sendMessage: function (msg, cb) { if (cb) setTimeout(function () { cb({ ok: true }); }, 50); },
      openOptionsPage: function () { alert('预览模式：请在 Chrome 扩展中打开设置页'); },
      lastError: undefined
    }
  };
})();
