/*! iClean · 浏览器数据清理工具
 *  Copyright (c) 2026 iClean. All rights reserved.
 *  本文件为原创代码，未经授权禁止转载、二次分发或用于商业用途。
 */
/* 清理核心逻辑（仅在 Service Worker 中运行） */

/* 清理指定站点：只清支持 origin 过滤的类型（browsingData 与 sessionStorage 并行执行） */
function ccCleanSite(origin, tabId, keys) {
  var originKeys = ccFilterOriginAware(keys);
  var dataTypes = ccBuildDataTypeSet(originKeys);
  var cleared = originKeys.slice();
  var tasks = [];

  if (Object.keys(dataTypes).length) {
    tasks.push(new Promise(function (resolve, reject) {
      var t = Date.now();
      chrome.browsingData.remove({ origins: [origin], since: 0 }, dataTypes, function () {
        console.debug('[iClean] browsingData.remove(' + Object.keys(dataTypes).join(',') + ') 耗时 ' + (Date.now() - t) + 'ms');
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    }));
  }

  // sessionStorage 无法通过 browsingData 清理，需要注入脚本；与上面的清理并行
  if (keys.indexOf('sessionStorage') !== -1 && tabId) {
    tasks.push(chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function () { try { sessionStorage.clear(); } catch (e) {} }
    }).then(function () {
      cleared.push('sessionStorage');
    }).catch(function () {
      // 注入失败（受限页面等）不影响其它类型的清理结果
    }));
  }

  return Promise.all(tasks).then(function () { return cleared; });
}

/* 全局清理：支持时间范围（since 为毫秒时间戳，0 表示全部） */
function ccCleanAll(keys, since) {
  var dataTypes = ccBuildDataTypeSet(keys);
  return new Promise(function (resolve, reject) {
    chrome.browsingData.remove({
      since: typeof since === 'number' ? since : 0,
      originTypes: { unprotectedWeb: true }
    }, dataTypes, function () {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(keys.slice());
    });
  });
}

