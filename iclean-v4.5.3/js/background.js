const isEdge = navigator.userAgent.includes('Edg/') || navigator.userAgent.includes('EdgA/');

const GLOBAL_MUTE_KEY = 'flowmouse_global_mute_state';
function sortAndClamp(items, sortOrder, maxItems, titleKey = 'title') {
	if (sortOrder && sortOrder !== 'default') {
		if (sortOrder === 'default_desc') {
			items = items.slice().reverse();
		} else {
			const [field, dir] = sortOrder.split('_');
			const asc = dir === 'asc';
			items = items.slice().sort((a, b) => {
				let va, vb;
				if (field === 'name') {
					va = (a[titleKey] || '').toLowerCase();
					vb = (b[titleKey] || '').toLowerCase();
					return asc ? va.localeCompare(vb) : vb.localeCompare(va);
				}
				va = a[field] || 0;
				vb = b[field] || 0;
				return asc ? va - vb : vb - va;
			});
		}
	}
	if (maxItems > 0 && items.length > maxItems) {
		items = items.slice(0, maxItems);
	}
	return items;
}

chrome.tabs.onCreated.addListener((tab) => {
	chrome.storage.session.get([GLOBAL_MUTE_KEY], (items) => {
		if (items[GLOBAL_MUTE_KEY]) {
			if (tab.id) {
				chrome.tabs.update(tab.id, { muted: true });
			}
		}
	});
});

function asyncMessageHandler(asyncHandler) {
	return (message, sender, sendResponse) => {
		asyncHandler(message, sender)
			.then(sendResponse)
			.catch((error) => {
				console.error('Error handling message:', message, error);
				sendResponse({ success: false, error: error.message });
			});
		return true;
	};
}

const CONTENT_ACTIONS = new Set([
	'scrollUp', 'scrollDown', 'scrollLeft', 'scrollRight', 'scrollToTop', 'scrollToBottom', 'scrollToLeftEdge', 'scrollToRightEdge',
	'stopLoading', 'copyUrl', 'copyTitle', 'copyTitleAndUrl', 'printPage', 'sendCustomEvent',
	'simulateKey', 'pasteClipboard', 'pasteContent', 'searchClipboard',
	'menuShowTabs', 'menuRecentlyClosed', 'menuShowBookmarks',
	'customMenu',
]);

async function createTabAtPosition(sender, position, extraOpts = {}) {
	if (!sender.tab) {
		return await chrome.tabs.create({ active: true, ...extraOpts });
	}
	const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
	const createOpts = { active: true, windowId: sender.tab.windowId, ...extraOpts };
	switch (position) {
		case 'right': createOpts.index = sender.tab.index + 1; break;
		case 'left': createOpts.index = sender.tab.index; break;
		case 'first': createOpts.index = 0; break;
		case 'last':
		default: createOpts.index = tabs.length; break;
	}
	return await chrome.tabs.create(createOpts);
}

async function openInNewWindow(url, focused = true, incognito = false) {
	const createOpts = { focused, incognito };
	if (url) createOpts.url = url;
	const win = await chrome.windows.create(createOpts);
	return win.tabs[0];
}

async function getSenderWindow(sender) {
	if (sender.tab?.windowId != null) {
		return await chrome.windows.get(sender.tab.windowId);
	}
	return await chrome.windows.getCurrent();
}

function replaceUrlPlaceholders(template, tab) {
	const rawUrl = tab?.url || '';
	const raw = {
		tabUrl: rawUrl,
		tabTitle: tab?.title || '',
		tabDomain: '',
	};
	if (rawUrl) {
		try {
			raw.tabDomain = new URL(rawUrl).hostname;
		} catch { }
	}
	return (template || '').replace(/\{(tabUrl|tabTitle|tabDomain)(?::(raw))?\}/g, (_, key, mod) => {
		const val = raw[key] || '';
		return mod ? val : encodeURIComponent(val);
	});
}

async function handleAction(request, sender) {
	switch (request.action) {


		case 'closeAllTabs': {
			const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
			const tabsToRemove = tabs
				.filter(tab => !(request.skipPinned && tab.pinned))
				.map(tab => tab.id);
			if (tabsToRemove.length > 0) {
				const remainingTabs = tabs.length - tabsToRemove.length;
				if (remainingTabs === 0) {
					await chrome.tabs.create({ active: true, windowId: sender.tab.windowId });
				}
				await chrome.tabs.remove(tabsToRemove);
			}
			return { success: true };
		}
		case 'refresh':
			if (sender.tab?.id) {
				await chrome.tabs.reload(sender.tab.id, { bypassCache: !!request.hardReload });
			}
			return { success: true };
		case 'newTab': {
			// 【本扩展定制】固定为「当前标签右侧、前台」打开
			await createTabAtPosition(sender, 'right', { active: true });
			return { success: true };
		}

		case 'closeTab': {
			if (sender.tab?.id) {
				if (request.skipPinned && sender.tab.pinned) {
					return { success: true };
				}
				const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
				const currentPos = tabs.findIndex(t => t.id === sender.tab.id);
				let afterClose = request.afterClose || 'default';

				if (request.preserveTab && afterClose === 'default') {
					afterClose = currentPos === tabs.length - 1 ? 'left' : 'right';
				}

				if (!request.preserveTab && request.keepWindow && tabs.length === 1) {
					await chrome.tabs.create({ active: true, windowId: sender.tab.windowId });
				}

				if (afterClose !== 'default' && tabs.length > 1 && currentPos !== -1) {
					let targetPos;
					if (afterClose === 'left') {
						targetPos = currentPos > 0 ? currentPos - 1 : tabs.length - 1;
					} else if (afterClose === 'right') {
						targetPos = currentPos < tabs.length - 1 ? currentPos + 1 : 0;
					}
					if (targetPos !== undefined) {
						await chrome.tabs.update(tabs[targetPos].id, { active: true });
					}
				}

				if (request.preserveTab) {
					if (tabs.length > 1 && !sender.tab.discarded) {
						await chrome.tabs.discard(sender.tab.id);
					}
				} else {
					await chrome.tabs.remove(sender.tab.id);
				}
			}
			return { success: true };
		}

		case 'restoreTab':
			if (sender.tab?.incognito) return { success: false };
			await chrome.sessions.restore(null).catch(() => { });
			return { success: true };
		case 'switchLeftTab': {
			if (sender.tab) {
				const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
				const currentPos = tabs.findIndex(t => t.id === sender.tab.id);
				if (currentPos === -1) return { success: true };
				if (request.noWrap && currentPos === 0) return { success: true };
				const prevPos = currentPos > 0 ? currentPos - 1 : tabs.length - 1;
				if (request.moveTab) {
					await chrome.tabs.move(sender.tab.id, { index: tabs[prevPos].index });
				} else {
					await chrome.tabs.update(tabs[prevPos].id, { active: true });
				}
			}
			return { success: true };
		}
		case 'switchRightTab': {
			if (sender.tab) {
				const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
				const currentPos = tabs.findIndex(t => t.id === sender.tab.id);
				if (currentPos === -1) return { success: true };
				if (request.noWrap && currentPos === tabs.length - 1) return { success: true };
				const nextPos = currentPos < tabs.length - 1 ? currentPos + 1 : 0;
				if (request.moveTab) {
					await chrome.tabs.move(sender.tab.id, { index: tabs[nextPos].index });
				} else {
					await chrome.tabs.update(tabs[nextPos].id, { active: true });
				}
			}
			return { success: true };
		}
		case 'toggleFullscreen': {
			const win = await getSenderWindow(sender);
			if (win.state === 'fullscreen') {
				const storageKey = `flowmouse_fullscreen_prev_state_${win.id}`;
				const items = await chrome.storage.session.get([storageKey]);
				const prevState = items[storageKey] || 'normal';
				await chrome.windows.update(win.id, { state: prevState });
				await chrome.storage.session.remove(storageKey);
			} else {
				const storageKey = `flowmouse_fullscreen_prev_state_${win.id}`;
				await chrome.storage.session.set({ [storageKey]: win.state });
				await chrome.windows.update(win.id, { state: 'fullscreen' });
			}
			return { success: true };
		}

		case 'openTabAtPosition': {
			if (sender.tab && request.incognito && !sender.tab.incognito) {
				const granted = await requestPermission(['incognito'], sender.tab.windowId);
				if (granted) {
					await chrome.windows.create({ incognito: true, url: request.url });
				}
				return { success: true };
			}

			const position = request.position || 'right';
			const active = request.active !== false;

			if (position === 'newWindow') {
				await openInNewWindow(request.url, active, sender.tab?.incognito);
			} else if (position === 'current' && sender.tab) {
				await chrome.tabs.update(sender.tab.id, { url: request.url, active });
			} else {
				await createTabAtPosition(sender, position, {
					url: request.url,
					active,
					openerTabId: sender.tab?.id,
				});
			}
			return { success: true };
		}
		case 'openIncognitoTabs': {
			const urls = request.urls || [];
			const queries = request.queries || [];
			if (!sender.tab || (urls.length === 0 && queries.length === 0)) return { success: true };
			if (sender.tab.incognito) {
				for (const url of urls) {
					await chrome.tabs.create({ url, windowId: sender.tab.windowId });
				}
				for (const query of queries) {
					const tab = await chrome.tabs.create({ windowId: sender.tab.windowId });
					await chrome.search.query({ text: query, tabId: tab.id });
				}
			} else {
				const granted = await requestPermission(['incognito'], sender.tab.windowId);
				if (granted) {
					const newWin = await chrome.windows.create({ incognito: true, url: urls.length > 0 ? urls : undefined });
					if (newWin) {
						for (const query of queries) {
							const tab = await chrome.tabs.create({ windowId: newWin.id });
							await chrome.search.query({ text: query, tabId: tab.id });
						}
					}
				}
			}
			return { success: true };
		}
		case 'systemSearch': {
			if (sender.tab) {
				if (request.incognito && !sender.tab.incognito) {
					const granted = await requestPermission(['incognito'], sender.tab.windowId);
					if (granted) {
						const newWin = await chrome.windows.create({ incognito: true });
						if (newWin && newWin.tabs && newWin.tabs.length > 0) {
							await chrome.search.query({ text: request.query, tabId: newWin.tabs[0].id });
						}
					}
					return { success: true };
				}

				const position = request.position || 'right';
				const active = request.active !== false;

				if (position === 'newWindow') {
					const newTab = await openInNewWindow(undefined, active, sender.tab?.incognito);
					await chrome.search.query({ text: request.query, tabId: newTab.id });
				} else if (position === 'current') {
					await chrome.search.query({ text: request.query, tabId: sender.tab.id });
				} else {
					const newTab = await createTabAtPosition(sender, position, {
						url: 'about:blank',
						active,
						openerTabId: sender.tab.id,
					});
					if (newTab) {
						await chrome.search.query({ text: request.query, tabId: newTab.id });
					}
				}
			}
			return { success: true };
		}

		case 'back':
			if (sender.tab?.id) {
				await chrome.tabs.goBack(sender.tab.id).catch(() => { });
			}
			return { success: true };

		case 'forward':
			if (sender.tab?.id) {
				await chrome.tabs.goForward(sender.tab.id).catch(() => { });
			}
			return { success: true };

		case 'gestureStateUpdate':
			if (sender.tab?.id) {
				await chrome.tabs.sendMessage(sender.tab.id, {
					action: 'gestureStateUpdate',
					active: request.active
				}).catch(() => {
				});
			}
			return { success: true };

		case 'pauseGesture':
			if (sender.tab?.id) {
				await chrome.tabs.sendMessage(sender.tab.id, {
					action: 'pauseGesture'
				}).catch(() => {});
			}
			return { success: true };

		case 'gestureHudUpdate':
			if (sender.tab?.id) {
				await chrome.tabs.sendMessage(sender.tab.id, {
					action: 'gestureHudUpdate',
					data: request.data
				}).catch(() => {
				});
			}
			return { success: true };

		case 'gestureScrollUpdate':
			if (sender.tab?.id) {
				await chrome.tabs.sendMessage(sender.tab.id, {
					action: 'gestureScrollUpdate',
					data: request.data
				}).catch(() => {
				});
			}
			return { success: true };

					}
}

chrome.runtime.onMessage.addListener(asyncMessageHandler(async (request, sender) => {
	if (request.useActiveTab && sender.tab) {
		const [activeTab] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
		if (activeTab) {
			sender = { ...sender, tab: activeTab };
		}
	}

	return await handleAction(request, sender);
}));

chrome.runtime.onInstalled.addListener((details) => {
	function compareVersions(a, b) {
		const partsA = a.split('.').map(Number);
		const partsB = b.split('.').map(Number);
		for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
			const segA = partsA[i] || 0;
			const segB = partsB[i] || 0;
			if (segA !== segB) return segA > segB ? 1 : -1;
		}
		return 0;
	}

	// 【本扩展定制】原实现在安装/首次加载时自动打开 pages/tutorial.html，
	// 该教程页已随 FlowMouse 自带设置界面一并删除，故不再自动打开任何页面。

	if (details.reason === 'update' && details.previousVersion) {
		if (details.previousVersion.startsWith('1.1')) {
			chrome.storage.sync.get(['imageDragGestures'], (items) => {
				const gestures = items.imageDragGestures;
				if (Array.isArray(gestures)) {
					let changed = false;
					const newGestures = gestures.map(g => {
						if (g.action === 'customSearch') {
							changed = true;
							return {
								...g,
								action: 'imageSearch',
								engine: 'custom',
							};
						}
						return g;
					});

					if (changed) {
						chrome.storage.sync.set({ imageDragGestures: newGestures });
					}
				}
			});
		}

		chrome.storage.sync.get(['gestures', 'customGestures', 'customGestureUrls', 'mouseGestures'], (items) => {
			if (items.mouseGestures && Object.keys(items.mouseGestures).length > 0) {
				return;
			}
			if (!items.customGestures && !items.customGestureUrls && !items.gestures) {
				return;
			}

			const LEGACY_DEFAULT_GESTURES = {
				'←': 'back', '→': 'forward', '↑': 'scrollUp', '↓': 'scrollDown',
				'↓→': 'closeTab', '←↑': 'restoreTab', '→↑': 'newTab', '→↓': 'refresh',
				'↑←': 'switchLeftTab', '↑→': 'switchRightTab', '↓←': 'stopLoading',
				'←↓': 'closeAllTabs', '↑↓': 'scrollToBottom', '↓↑': 'scrollToTop',
				'←→': 'closeTab', '→←': 'restoreTab',
			};
			const baseGestures = items.gestures || LEGACY_DEFAULT_GESTURES;
			const customGestures = items.customGestures || {};
			const customGestureUrls = items.customGestureUrls || {};
			const merged = { ...baseGestures, ...customGestures };

			const mouseGestures = {};
			for (const [pattern, action] of Object.entries(merged)) {
				if (action === null) continue;
				const entry = { action };
				if (customGestureUrls[pattern]) entry.customUrl = customGestureUrls[pattern];
				mouseGestures[pattern] = entry;
			}

			chrome.storage.sync.remove(['gestures', 'customGestures', 'customGestureUrls'], () => {
				chrome.storage.sync.set({ mouseGestures });
			});
		});

		if (compareVersions(details.previousVersion, '2.1') < 0) {
			chrome.storage.sync.remove(['enableAdvancedSettings', 'scrollAmount', 'scrollSmoothness']);
		}

		if (compareVersions(details.previousVersion, '2.0.2') <= 0) {
			chrome.storage.sync.set({ enableSuggestedGestures: false });
		}

		chrome.storage.sync.get(['mouseGestures', 'wheelGestures', 'specialGestures', 'actionChains'], (items) => {
			const updates = {};
			let changed = false;

			if (items.mouseGestures) {
				const mg = structuredClone(items.mouseGestures);
				for (const [pattern, config] of Object.entries(mg)) {
					if (config.action === 'copyUrl' && config.includeTitle) {
						config.action = 'copyTitleAndUrl';
						delete config.includeTitle;
						changed = true;
					}
				}
				if (changed) updates.mouseGestures = mg;
			}

			if (items.wheelGestures) {
				const wg = structuredClone(items.wheelGestures);
				let wgChanged = false;
				for (const config of Object.values(wg)) {
					if (config.action === 'copyUrl' && config.includeTitle) {
						config.action = 'copyTitleAndUrl';
						delete config.includeTitle;
						wgChanged = true;
					}
				}
				if (wgChanged) { updates.wheelGestures = wg; changed = true; }
			}

			if (items.specialGestures) {
				const sg = structuredClone(items.specialGestures);
				let sgChanged = false;
				for (const config of Object.values(sg)) {
					if (config.action === 'copyUrl' && config.includeTitle) {
						config.action = 'copyTitleAndUrl';
						delete config.includeTitle;
						sgChanged = true;
					}
				}
				if (sgChanged) { updates.specialGestures = sg; changed = true; }
			}

			if (items.actionChains) {
				const ac = structuredClone(items.actionChains);
				let acChanged = false;
				for (const chain of Object.values(ac)) {
					if (!chain.steps) continue;
					for (const step of chain.steps) {
						if (step.action === 'copyUrl' && step.includeTitle) {
							step.action = 'copyTitleAndUrl';
							delete step.includeTitle;
							acChanged = true;
						}
					}
				}
				if (acChanged) { updates.actionChains = ac; changed = true; }
			}

			if (changed) chrome.storage.sync.set(updates);
		});
	}


	{
		async function reinjectContentScripts(dispose) {
			const contentScript = chrome.runtime.getManifest().content_scripts[0];
			const tabs = await chrome.tabs.query({});
			await Promise.all(tabs.map(async (tab) => {
				if (isRestrictedUrl(tab.url)) return;
				try {
					if (dispose) {
						await chrome.scripting.executeScript({
							target: { tabId: tab.id, allFrames: contentScript.all_frames },
							func: () => window.dispatchEvent(new CustomEvent('flowmouse:dispose', { detail: { extensionId: chrome.runtime.id } })),
						});
					}
					await chrome.scripting.executeScript({
						target: { tabId: tab.id, allFrames: contentScript.all_frames },
						files: contentScript.js,
					});
				} catch (error) {
					// 【本扩展定制】错误页（网站打不开）与受限页面本就无法注入，属预期情况，降级为 debug 避免误报
					console.debug('[FlowMouse] 跳过注入（错误页/受限页）:', error && error.message ? error.message : error);
				}
			}));
		}

		if (details.reason === 'install' || (details.reason === 'update' && compareVersions(details.previousVersion, '1.50') > 0)) {
			reinjectContentScripts(details.reason === 'update');
		}
	}

	if (details.reason === 'install' || details.reason === 'update') {
		chrome.storage.local.get(['installDate'], (items) => {
			if (!items.installDate) {
				chrome.storage.local.set({ installDate: new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z' });
			}
		});
	}
});
let fileSchemeAllowed = false;
chrome.extension.isAllowedFileSchemeAccess().then(v => { fileSchemeAllowed = v; });

function isRestrictedUrl(url) {
	if (!url) return true;

	if (url.startsWith(chrome.runtime.getURL(''))) {
		return false;
	}

	if (url.startsWith('file:')) {
		return !fileSchemeAllowed;
	}

	const restrictedProtocols = ['chrome:', 'chrome-extension:', 'moz-extension:', 'about:', 'edge:', 'view-source:', 'devtools:'];
	for (const protocol of restrictedProtocols) {
		if (url.startsWith(protocol)) return true;
	}

	{
		if (url.startsWith('https://chrome.google.com/webstore') ||
			url.startsWith('https://chromewebstore.google.com') ||
			(isEdge && url.startsWith('https://microsoftedge.microsoft.com/addons'))) {
			return true;
		}
	}

	return false;
}

function getMsg(key, fallback) {
	try {
		if (typeof key !== 'string') {
			return fallback
		}
		const msg = chrome.i18n.getMessage(key);
		return msg || fallback;
	} catch (e) {
		return fallback;
	}
}

function sanitizeSubdir(raw) {
	if (!raw || typeof raw !== 'string') return '';
	let s = raw.trim()
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/');
	s = s.replace(/^\/|\/$/g, '');
	const segments = s.split('/').filter(seg => {
		if (!seg || seg === '.' || seg === '..') return false;
		if (/[<>:"|?*\x00-\x1f]/.test(seg)) return false;
		return true;
	});
	return segments.join('/');
}

function sanitizeFilename(raw) {
	if (!raw || typeof raw !== 'string') return '';
	const illegalRe = /[\/?<>\\:*|"]/g;
	const controlRe = /[\x00-\x1f\x80-\x9f]/g;
	const reservedRe = /^\.+$/;
	const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
	let name = raw
		.replace(illegalRe, '_')
		.replace(controlRe, '_')
		.replace(reservedRe, '_')
		.replace(windowsReservedRe, '_');
	let end = name.length;
	while (end > 0 && (name[end - 1] === '.' || name[end - 1] === ' ')) end--;
	name = name.slice(0, end);
	if (name.length > 255) name = name.slice(0, 255);
	return name;
}

function joinDownloadPath(subdir, filename) {
	const name = sanitizeFilename(filename);
	if (subdir) return subdir + '/' + (name || 'image.png');
	return name || null;
}

function getFilename(url, mimeType) {
	let filename = null;

	if (url && !url.startsWith('data:')) {
		try {
			const urlObj = new URL(url);
			const pathname = urlObj.pathname;
			const name = pathname.substring(pathname.lastIndexOf('/') + 1);
			if (name && name.length > 0 && name.length < 255) {
				filename = decodeURIComponent(name);
			}
		} catch (e) {
		}
	}

	if (!filename) {
		filename = 'image';
	}

	if (mimeType) {
		const safeMime = mimeType.split(';')[0].trim().toLowerCase();
		const mimeMap = {
			'image/jpeg': '.jpg',
			'image/jpg': '.jpg',
			'image/png': '.png',
			'image/gif': '.gif',
			'image/webp': '.webp',
			'image/bmp': '.bmp',
			'image/svg+xml': '.svg',
			'image/x-icon': '.ico',
			'image/vnd.microsoft.icon': '.ico',
			'image/avif': '.avif',
			'image/jxl': '.jxl',
			'image/tiff': '.tiff'
		};

		const ext = mimeMap[safeMime];
		if (ext) {
			if (!/\.[a-zA-Z0-9]+$/i.test(filename)) {
				filename += ext;
			}
		} else if (safeMime.startsWith('image/')) {
			const subType = safeMime.split('/')[1];
			if (subType && /^[a-z0-9]+$/i.test(subType) && subType.length < 10) {
				if (!/\.[a-zA-Z0-9]+$/i.test(filename)) {
					filename += '.' + subType;
				}
			}
		}
	}

	return filename;
}

function findResourceInMhtml(mhtmlContent, targetUrl) {
	if (!mhtmlContent || !targetUrl) return null;

	const boundaryMatch = mhtmlContent.match(/Content-Type:\s*multipart\/related;[\s\S]*?boundary="?([^";\r\n]+)"?/i);
	if (!boundaryMatch) return null;

	const boundary = '--' + boundaryMatch[1];

	const parts = mhtmlContent.split(boundary);

	for (const part of parts) {
		if (!part || part.trim() === '--') continue;

		const headerEndIndex = part.indexOf('\r\n\r\n');
		if (headerEndIndex === -1) continue;

		const headersRaw = part.substring(0, headerEndIndex);
		const bodyRaw = part.substring(headerEndIndex + 4);

		const locationMatch = headersRaw.match(/Content-Location:\s*([^\r\n]+)/i);
		if (locationMatch) {
			const location = locationMatch[1].trim();

			if (location === targetUrl) {
				const typeMatch = headersRaw.match(/Content-Type:\s*([^\r\n;]+)/i);
				const encodingMatch = headersRaw.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);

				const type = typeMatch ? typeMatch[1].trim() : 'application/octet-stream';
				const encoding = encodingMatch ? encodingMatch[1].trim().toLowerCase() : 'binary';

				let dataUrl = null;

				if (encoding === 'base64') {
					const cleanBody = bodyRaw.replace(/[\r\n\s]+/g, '');
					dataUrl = `data:${type};base64,${cleanBody}`;
				} else if (encoding === 'quoted-printable') {
					let decoded = bodyRaw.replace(/=(?:\r\n|\r|\n)/g, '');

					decoded = decoded.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
						return String.fromCharCode(parseInt(hex, 16));
					});

					const base64 = btoa(decoded);
					dataUrl = `data:${type};base64,${base64}`;
				}

				return {
					type,
					encoding,
					dataUrl
				};
			}
		}
	}

	return null;
}

async function notifyDownloadError(tabId) {
	if (tabId) {
		await chrome.tabs.sendMessage(tabId, { action: 'showDownloadError' }).catch(() => { });
	}
}

async function requestPermission(permissions, windowId) {
	if (permissions.includes('incognito')) {
		const isAllowed = await chrome.extension.isAllowedIncognitoAccess();
		if (isAllowed) return true;
	} else {
		const hasPermission = await chrome.permissions.contains({ permissions: permissions });
		if (hasPermission) return true;
	}

	return new Promise((resolve) => {
		const permUrl = chrome.runtime.getURL(`pages/permission.html?permissions=${permissions.join(',')}`);

		const checkGranted = async () => {
			if (permissions.includes('incognito')) {
				return await chrome.extension.isAllowedIncognitoAccess();
			}
			return await chrome.permissions.contains({ permissions: permissions });
		};

		const openAsTab = async () => {
			const tab = await chrome.tabs.create({ url: permUrl, active: true });
			const onTabRemoved = async (tabId) => {
				if (tabId === tab.id) {
					chrome.tabs.onRemoved.removeListener(onTabRemoved);
					resolve(await checkGranted());
				}
			};
			chrome.tabs.onRemoved.addListener(onTabRemoved);
		};

		const openPermissionWindow = async (winOptions) => {
			try {
				const popupWindow = await chrome.windows.create({
					url: permUrl,
					type: 'popup',
					width: 340,
					height: 380,
					left: winOptions?.left,
					top: winOptions?.top,
					focused: true
				});

				if (!popupWindow) {
					await openAsTab();
					return;
				}

				const onRemoved = async (closedWindowId) => {
					if (closedWindowId === popupWindow.id) {
						chrome.windows.onRemoved.removeListener(onRemoved);
						resolve(await checkGranted());
					}
				};
				chrome.windows.onRemoved.addListener(onRemoved);
			} catch (e) {
				try {
					await openAsTab();
				} catch (e2) {
					console.error('Failed to open permission popup:', e2);
					resolve(false);
				}
			}
		};

		if (windowId) {
			chrome.windows.get(windowId).then((win) => {
				const width = 340;
				const height = 380;
				const left = Math.round(win.left + (win.width - width) / 2);
				const top = Math.round(win.top + (win.height - height) / 2);
				openPermissionWindow({ left, top });
			}).catch(() => {
				openPermissionWindow(null);
			});
		} else {
			openPermissionWindow(null);
		}
	});
}