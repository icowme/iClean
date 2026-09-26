/*! iClean · 浏览器数据清理工具
 *  Copyright (c) 2026 iClean. All rights reserved.
 *  本文件为原创代码，未经授权禁止转载、二次分发或用于商业用途。
 */
function ccGetConfig(){return new Promise(function(n){chrome.storage.local.get("config",function(e){var t=e&&e.config?e.config:{};n(Object.assign({},CC_DEFAULT_CONFIG,t))})})}function ccSaveConfig(n){return ccGetConfig().then(function(e){var t=Object.assign(e,n);return new Promise(function(n){chrome.storage.local.set({config:t},function(){n(t)})})})}function ccIsWhitelisted(n,e){if(!n||!e||!e.length)return!1;var t="";try{t=new URL(n).hostname}catch(e){t=n}return e.some(function(n){return!!(n=String(n).trim().replace(/^https?:\/\//,"").replace(/\/.*$/,"").replace(/:\d+$/,""))&&(t===n||t.endsWith("."+n))})}