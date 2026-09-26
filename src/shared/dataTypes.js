/*! iClean · 浏览器数据清理工具
 *  Copyright (c) 2026 iClean. All rights reserved.
 *  本文件为原创代码，未经授权禁止转载、二次分发或用于商业用途。
 */
/* 数据类型元数据表 + 预设 + 工具函数（所有页面/Worker 共用） */

var CC_DEFAULT_CONFIG = {
  selectedTypes: ['cookies','localStorage','sessionStorage','indexedDB','cacheStorage','cache','serviceWorkers'],
  preset: 'standard',
  timeRange: 0,
  whitelist: [],
  confirmBeforeAll: true,
  typesFolded: true
};

var CC_DATA_TYPES = [
  { key:'cookies',            label:'Cookie 与登录状态',       group:'站点数据', originAware:true,  risk:'high',    default:true,  desc:'登录状态、会话信息，清除后需重新登录' },
  { key:'localStorage',       label:'localStorage 本地存储',   group:'站点数据', originAware:true,  risk:'medium',  default:true,  desc:'网站保存在本地的键值数据' },
  { key:'sessionStorage',     label:'sessionStorage 会话存储', group:'站点数据', originAware:true,  risk:'low',     default:true,  desc:'当前标签页的临时会话数据' },
  { key:'indexedDB',          label:'IndexedDB 数据库',        group:'站点数据', originAware:true,  risk:'high',    default:true,  desc:'网页离线数据库，清除后应用回到初始状态' },
  { key:'cache',              label:'HTTP / 图片缓存',         group:'缓存与离线', originAware:true,  risk:'low',     default:true,  desc:'图片、脚本等临时文件，清除后首次加载变慢' },
  { key:'cacheStorage',       label:'Cache Storage（PWA）',    group:'缓存与离线', originAware:true,  risk:'low',     default:true,  desc:'PWA 应用的离线缓存资源' },
  { key:'serviceWorkers',     label:'Service Worker 注册',     group:'缓存与离线', originAware:true,  risk:'low',     default:true,  desc:'后台离线服务脚本，清除后 PWA 需重新注册' },
  { key:'formData',           label:'表单自动填充',            group:'浏览器记录', originAware:false, risk:'medium',  default:false, desc:'自动填写的地址、搜索词等表单内容' },
  { key:'downloads',          label:'下载记录',                group:'浏览器记录', originAware:false, risk:'low',     default:false, desc:'下载历史列表（不删除已下载的文件）' },
  { key:'history',            label:'浏览历史',                group:'浏览器记录', originAware:false, risk:'high',    default:false, desc:'浏览过的网页记录' },
  { key:'passwords',          label:'已保存密码',              group:'敏感数据',   originAware:false, risk:'extreme', default:false, desc:'浏览器保存的账号密码，清除后无法恢复' },
  { key:'fileSystems',        label:'文件系统 API 数据',       group:'敏感数据',   originAware:false, risk:'medium',  default:false, desc:'网页沙盒中保存的文件' },
  { key:'serverBoundCertificates', label:'服务绑定证书',       group:'敏感数据',   originAware:false, risk:'medium',  default:false, desc:'与设备绑定的 TLS 证书' },
];

var CC_PRESETS = {
  quick:    ['cookies','localStorage','sessionStorage','cache'],
  standard: ['cookies','localStorage','sessionStorage','indexedDB','cache','cacheStorage','serviceWorkers'],
  thorough: ['cookies','localStorage','sessionStorage','indexedDB','cache','cacheStorage','serviceWorkers','formData','downloads','history','fileSystems']
};

function ccIsOriginAware(key) {
  var t = CC_DATA_TYPES.find(function (x) { return x.key === key; });
  return !!(t && t.originAware);
}

function ccLabelForKey(key) {
  var t = CC_DATA_TYPES.find(function (x) { return x.key === key; });
  return t ? t.label : key;
}

function ccBuildDataTypeSet(keys) {
  var set = {};
  keys.forEach(function (k) {
    // sessionStorage 不在 browsingData DataTypeSet 中，通过注入脚本处理
    if (k === 'sessionStorage') return;
    set[k] = true;
  });
  return set;
}

function ccFilterOriginAware(keys) {
  return keys.filter(ccIsOriginAware);
}
