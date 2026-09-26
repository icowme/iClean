(function () {
	'use strict';

	let i18nMessages = null;
	let currentLanguage = null;

	function msg(key, defaultText) {
		if (i18nMessages && i18nMessages[key]) {
			return i18nMessages[key].message;
		}
		if (typeof key !== 'string') {
			return defaultText
		}
		return chrome.i18n.getMessage(key) || defaultText;
	}

	async function loadLanguage(language) {
		const uiLang = chrome.i18n.getUILanguage().replace('-', '_');
		if (!language || language === 'auto' || language === uiLang || (language === 'en' && uiLang.startsWith('en_'))) {
			currentLanguage = null;
			i18nMessages = null;
			return;
		}

		currentLanguage = language;
		try {
			const url = chrome.runtime.getURL(`_locales/${currentLanguage}/messages.json`);
			const response = await fetch(url);
			i18nMessages = await response.json();
		} catch (e) {
			i18nMessages = null;
		}
	}

	function getHtmlLang() {
		return currentLanguage
			? currentLanguage.replace('_', '-')
			: chrome.i18n.getUILanguage();
	}

	function getDir() {
		const lang = getHtmlLang();
		const rtlLangs = ['ar', 'he', 'fa', 'ps', 'ur', 'yi', 'sd', 'ug', 'ku'];
		return rtlLangs.some(l => lang === l || lang.startsWith(l + '-')) ? 'rtl' : 'ltr';
	}

	window.ContentI18n = {
		msg,
		loadLanguage,
		getHtmlLang,
		getDir,
	};
})();


(function () {
	'use strict';

	class EventManager {
		constructor() {
			this._bindings = [];
			this._onUpdateCallbacks = [];
			this._onReattachCallbacks = [];
		}

		add(condition, target, event, handler, options) {
			if (condition !== null && typeof condition !== 'function') {
				throw new TypeError('EventManager.add: condition must be null or a function');
			}
			if (typeof handler !== 'function') {
				throw new TypeError('EventManager.add: handler must be a function');
			}
			const safeHandler = (e) => {
				if (!e.isTrusted) return;
				handler(e);
			};
			this._bindings.push({ target, event, handler: safeHandler, options, condition, active: false });
			return this;
		}

		onUpdate(fn) {
			this._onUpdateCallbacks.push(fn);
			return this;
		}

		onReattach(fn) {
			this._onReattachCallbacks.push(fn);
			return this;
		}

		update() {
			for (const b of this._bindings) {
				const shouldBeActive = b.condition ? b.condition() : true;
				if (shouldBeActive && !b.active) {
					b.target.addEventListener(b.event, b.handler, b.options);
					b.active = true;
				} else if (!shouldBeActive && b.active) {
					b.target.removeEventListener(b.event, b.handler, b.options);
					b.active = false;
				}
			}
			for (const fn of this._onUpdateCallbacks) fn();
		}

		dispose() {
			for (const b of this._bindings) {
				if (b.active) {
					b.target.removeEventListener(b.event, b.handler, b.options);
					b.active = false;
				}
			}
			this._bindings.length = 0;
		}

		reattach() {
			for (const b of this._bindings) {
				if (b.active) {
					b.target.addEventListener(b.event, b.handler, b.options);
				}
			}
			for (const fn of this._onReattachCallbacks) fn();
		}
	}

	window.EventManager = EventManager;
})();


(function () {
	'use strict';


	function getRoot() {
		return document.scrollingElement || window;
	}

	const SCROLL_ACTIONS = {
		scrollUp: { axis: 'y', dir: -1 },
		scrollDown: { axis: 'y', dir: 1 },
		scrollLeft: { axis: 'x', dir: -1 },
		scrollRight: { axis: 'x', dir: 1 },
		scrollToTop: { axis: 'y', dir: -1, toEdge: true },
		scrollToBottom: { axis: 'y', dir: 1, toEdge: true },
		scrollToLeftEdge: { axis: 'x', dir: -1, toEdge: true },
		scrollToRightEdge: { axis: 'x', dir: 1, toEdge: true },
	};

	const AXES = {
		x: { pos: 'scrollLeft', size: 'clientWidth', scrollSize: 'scrollWidth', windowPos: 'scrollX', windowSize: 'innerWidth', overflow: 'overflowX', to: 'left' },
		y: { pos: 'scrollTop', size: 'clientHeight', scrollSize: 'scrollHeight', windowPos: 'scrollY', windowSize: 'innerHeight', overflow: 'overflowY', to: 'top' },
	};

	function getScrollMetrics(target, axis) {
		const ax = AXES[axis];
		if (target !== window) {
			return {
				pos: target[ax.pos],
				size: target[ax.size],
				scrollSize: target[ax.scrollSize],
			};
		}

		return {
			pos: window[ax.windowPos],
			size: window[ax.windowSize],
			scrollSize: Math.max(
				document.documentElement?.[ax.scrollSize] ?? 0,
				document.body?.[ax.scrollSize] ?? 0,
			),
		};
	}

	function hasScrollRoom(el, action) {
		const { axis, dir } = SCROLL_ACTIONS[action];
		const { pos, size, scrollSize } = getScrollMetrics(el, axis);
		const max = Math.max(0, scrollSize - size);
		if (max <= 1) return false;
		return dir < 0 ? pos > 1 : pos < max - 1;
	}

	function deepElementFromPoint(x, y) {
		let el = document.elementFromPoint(x, y);
		while (el && el.shadowRoot) {
			const inner = el.shadowRoot.elementFromPoint(x, y);
			if (!inner || inner === el) break;
			el = inner;
		}
		return el;
	}

	function parentAcrossShadow(el) {
		if (el.parentElement) return el.parentElement;
		const r = el.getRootNode();
		return (r instanceof ShadowRoot) ? r.host : null;
	}

	function getScrollTarget(action, forceTargetWindow = false, cursorX, cursorY) {
		const root = getRoot();
		if (forceTargetWindow) return root;

		if (cursorX != null && cursorY != null) {
			const overflowProp = AXES[SCROLL_ACTIONS[action].axis].overflow;
			let el = deepElementFromPoint(cursorX, cursorY);
			while (el && el !== root && el !== document.body) {
				const o = window.getComputedStyle(el)[overflowProp];
				if ((o === 'auto' || o === 'scroll') && hasScrollRoom(el, action)) {
					return el;
				}
				el = parentAcrossShadow(el);
			}
		}
		return root;
	}

	function checkScrollFeasibility(action, cursorX, cursorY) {
		if (!SCROLL_ACTIONS[action]) throw new Error(`Not a scroll action: ${action}`);
		return hasScrollRoom(getScrollTarget(action, false, cursorX, cursorY), action);
	}

	function resolveScrollSmoothness(value) {
		if (value === 'auto') {
			const systemHasAnimation = window.matchMedia && window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
			return systemHasAnimation ? 'system' : 'smooth';
		}
		return value;
	}

	const scrollGoals = new WeakMap();
	let scrollRafId = null;
	let scrollActiveTarget = null;
	let scrollVersion = 0;

	let scrollAccelLastTime = 0;
	let scrollAccelCount = 0;
	let scrollAccelLastDir = null;

	function startScrollListeners() {
		window.addEventListener('wheel', cancelEaseScroll, { capture: true, passive: true });
	}

	function stopScrollListeners() {
		window.removeEventListener('wheel', cancelEaseScroll, { capture: true });
	}

	function cancelEaseScroll() {
		if (scrollRafId) {
			cancelAnimationFrame(scrollRafId);
			scrollRafId = null;
		}
		if (scrollActiveTarget) {
			scrollGoals.delete(scrollActiveTarget);
			scrollActiveTarget = null;
		}
		stopScrollListeners();
	}

	function easeScrollTo(target, axis, goal, unclampedGoal, baseDuration = 500) {
		scrollActiveTarget = target;

		const ax = AXES[axis];
		const { pos: start } = getScrollMetrics(target, axis);
		if (start === goal) {
			scrollActiveTarget = null;
			return;
		}

		const delta = goal - start;
		const startTime = performance.now();

		const realDist = Math.abs(delta);
		const unclampedDist = Math.abs(unclampedGoal - start);
		let duration = baseDuration;
		if (unclampedDist > 0 && realDist < unclampedDist) {
			duration = Math.max(16, duration * (realDist / unclampedDist));
		}

		startScrollListeners();

		function step(now) {
			const elapsed = now - startTime;
			if (elapsed >= duration) {
				target.scrollTo({ [ax.to]: goal, behavior: 'instant' });
				scrollRafId = null;
				scrollActiveTarget = null;
				scrollGoals.delete(target);
				stopScrollListeners();
				return;
			}
			const ease = 1 - Math.pow(1 - elapsed / duration, 3);
			target.scrollTo({ [ax.to]: start + delta * ease, behavior: 'instant' });
			scrollRafId = requestAnimationFrame(step);
		}

		scrollRafId = requestAnimationFrame(step);
	}

	function handleScroll(action, scrollConfig, forceTargetWindow = false, cursorX, cursorY) {
		const meta = SCROLL_ACTIONS[action];
		if (!meta) return;
		const ax = AXES[meta.axis];
		const target = getScrollTarget(action, forceTargetWindow, cursorX, cursorY);
		const smoothness = resolveScrollSmoothness(scrollConfig.scrollSmoothness);

		const { pos: cur, size, scrollSize } = getScrollMetrics(target, meta.axis);
		const max = Math.max(0, scrollSize - size);

		let goal, unclampedGoal;
		if (meta.toEdge) {
			goal = unclampedGoal = meta.dir < 0 ? 0 : max;
		} else {
			let delta = size * (scrollConfig.scrollDistance / 100) * meta.dir;

			const accel = scrollConfig.scrollAccel ?? 1;
			const accelWindow = scrollConfig.scrollAccelWindow ?? 400;
			if (accel != 1) {
				const now = performance.now();
				if (now - scrollAccelLastTime < accelWindow && scrollAccelLastDir === action) {
					scrollAccelCount++;
				} else {
					scrollAccelCount = 0;
				}
				scrollAccelLastTime = now;
				scrollAccelLastDir = action;
				if (scrollAccelCount > 0) {
					delta *= accel;
				}
			}

			unclampedGoal = (scrollGoals.get(target)?.[meta.axis] ?? cur) + delta;
			goal = Math.max(0, Math.min(unclampedGoal, max));
		}

		cancelEaseScroll();
		scrollGoals.set(target, { [meta.axis]: goal });
		if (cur === goal) return;

		if (smoothness === 'none') {
			scrollGoals.delete(target);
			target.scrollTo({ [ax.to]: goal, behavior: 'instant' });
		} else if (smoothness === 'system') {
			target.scrollTo({ [ax.to]: goal, behavior: 'smooth' });
			const version = ++scrollVersion;
			const eventTarget = target === getRoot() ? document : target;
			eventTarget.addEventListener('scrollend', () => {
				if (scrollVersion === version) {
					scrollGoals.delete(target);
				}
			}, { once: true });
		} else {
			easeScrollTo(target, meta.axis, goal, unclampedGoal, scrollConfig.scrollDuration ?? 500);
		}
	}


	function copyTextFallback(text) {
		try {
			const textarea = document.createElement('textarea');
			textarea.value = text;
			textarea.style.position = 'fixed';
			textarea.style.left = '-9999px';
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			document.body.removeChild(textarea);
		} catch (err) {
		}
	}

	function copyText(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).catch(err => {
				copyTextFallback(text);
			});
		} else {
			copyTextFallback(text);
		}
	}


	function isNavigableUrl(href) {
		try {
			const p = new URL(href).protocol;
			return p !== 'javascript:' && p !== 'data:' && p !== 'blob:';
		} catch { return false; }
	}

	function tryParseAsUrl(text, requireProtocol = false) {
		if (!text || typeof text !== 'string') return null;
		text = text.trim();
		if (!text) return null;

		const protocolRegex = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
		if (protocolRegex.test(text)) {
			const ignoreProtocol = /^(javascript|data|blob):/i;
			if (ignoreProtocol.test(text)) return null;
			if (/^(mailto|tel|sms|magnet):/i.test(text) || text.includes('://')) return text;
			return null;
		}

		if (requireProtocol) return null;

		const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/;
		if (ipRegex.test(text)) {
			return 'http://' + text;
		}

		const localhostRegex = /^localhost(:\d+)?(\/.*)?$/i;
		if (localhostRegex.test(text)) {
			return 'http://' + text;
		}

		const domainRegex = /^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)*(:\d+)?(\/.*)?$/;
		const commonTlds = /\.(com|cn|net|org|gov|edu|io|co|cc|me|tv|info|biz|xyz|top|vip|club|shop|site|online|tech|app|dev|ai|uk|de|fr|jp|kr|ru|br|in|au|ca|hk|tw|sg)\b/i;
		if (domainRegex.test(text) && commonTlds.test(text)) {
			return 'http://' + text;
		}

		return null;
	}

	window.FlowMouseUtils = {
		handleScroll,
		checkScrollFeasibility,
		copyText,
		isNavigableUrl,
		tryParseAsUrl,
	};
})();



(function () {
	'use strict';

	const isFirefox = false;
	const isEdgeDesktop = navigator.userAgent.includes('Edg/');

	const currentDomain = location.hostname;

	function checkBlacklist(blacklist) {
		if (blacklist.includes(currentDomain)) return true;
		try {
			const origins = location.ancestorOrigins;
			if (origins && origins.length > 0) {
				return blacklist.includes(new URL(origins[origins.length - 1]).hostname);
			}
		} catch (e) {}
		return false;
	}

	let isBlacklisted = false;
	let initGesturesCalled = false;

	chrome.storage.sync.get({ blacklist: [] }, (items) => {
		if (chrome.runtime.lastError) {
			console.error(chrome.runtime.lastError);
			return;
		}
		isBlacklisted = checkBlacklist(items.blacklist);
		if (!isBlacklisted) {
			initGestures();
		}
	});

	chrome.storage.onChanged.addListener((changes, namespace) => {
		if (namespace === 'sync') {
			if (changes.blacklist) {
				const oldBlacklist = changes.blacklist.oldValue || [];
				const newBlacklist = changes.blacklist.newValue || [];
				const wasBlacklisted = checkBlacklist(oldBlacklist);
				const nowBlacklisted = checkBlacklist(newBlacklist);

				if (wasBlacklisted !== nowBlacklisted) {
					isBlacklisted = nowBlacklisted;
					if (nowBlacklisted === false && !initGesturesCalled) {
						initGestures();
					}
				}
			}
		}
	});

	function initGestures() {
		initGesturesCalled = true;
		const { DEFAULT_GESTURES, DEFAULT_SETTINGS, ACTION_DEFAULTS, DRAG_ACTION_DEFAULTS, ACTION_KEYS, LOCAL_ACTIONS, TEXT_DRAG_ACTIONS, LINK_DRAG_ACTIONS, IMAGE_DRAG_ACTIONS } = window.GestureConstants;
		const { handleScroll, checkScrollFeasibility, copyText, tryParseAsUrl } = window.FlowMouseUtils;
		const { msg } = window.ContentI18n;

		const recognizer = new window.GestureRecognizer({
			distanceThreshold: DEFAULT_SETTINGS.distanceThreshold
		});

		let isIframe = false;
		try {
			isIframe = window.self !== window.top;
		} catch (e) {
			isIframe = true;
		}

		const isIncognito = chrome.extension.inIncognitoContext;

		async function safeSendMessage(message) {
			try {
				return await chrome.runtime.sendMessage(message);
			} catch (e) {
			}
		}

		function getActionHintText(action, type) {
			const dragActionKeyMap = { text: TEXT_DRAG_ACTIONS, link: LINK_DRAG_ACTIONS, image: IMAGE_DRAG_ACTIONS };
			const key = dragActionKeyMap[type]?.[action];
			return key ? msg(key) : '';
		}

		function getDragHints(type, pattern, dragContent, parentLink) {
			const gestures = getGesturesForDragType(type);
			if (!gestures) return [];

			const configs = getDragGestureConfigs(gestures, pattern);
			const rawHints = [];
			for (const cfg of configs) {
				let action = cfg.action || 'none';
				if (action === 'none') continue;
				if (action === 'search' && type === 'text' && cfg.autoDetectUrl === true && dragContent && tryParseAsUrl(dragContent, false)) {
					rawHints.push(cfg.customNameAutoDetectUrl || msg('dragActionOpenTabLink'));
				} else if (action === 'openTab' && type === 'image' && cfg.preferLink === true && parentLink) {
					rawHints.push(cfg.customNamePreferLink || msg('dragActionOpenTabLink'));
				} else if (cfg.customName) {
					rawHints.push(cfg.customName);
				} else {
					const hint = getActionHintText(action, type);
					if (hint) rawHints.push(hint);
				}
			}

			const countMap = new Map();
			for (const h of rawHints) {
				countMap.set(h, (countMap.get(h) || 0) + 1);
			}
			const hints = [];
			const seen = new Set();
			for (const h of rawHints) {
				if (seen.has(h)) continue;
				seen.add(h);
				const count = countMap.get(h);
				hints.push(count > 1 ? `${h} × ${count}` : h);
			}
			return hints;
		}

		function getGesturesForDragType(dragType) {
			if (dragType === 'text') return SETTINGS.textDragGestures;
			if (dragType === 'link') return SETTINGS.linkDragGestures;
			if (dragType === 'image') return SETTINGS.imageDragGestures;
			return null;
		}

		function getDragGestureConfigs(gestures, dir) {
			if (!Array.isArray(gestures)) return [];
			return gestures.filter(g => g.direction === dir).map(g => ({ ...DRAG_ACTION_DEFAULTS[g.action], ...g }));
		}

		function isEditableTarget(e) {
			const node = e.composedPath()[0];
			const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
			const tag = el.tagName;
			return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
		}

		function hasDragAction(dragType, pattern) {
			if (!pattern) return false;
			const gestures = getGesturesForDragType(dragType);
			if (!gestures) return false;
			return getDragGestureConfigs(gestures, pattern).some(g => g.action && g.action !== 'none');
		}

		let SETTINGS = {
			...DEFAULT_SETTINGS,
			enableDrag: DEFAULT_SETTINGS.enableTextDrag || DEFAULT_SETTINGS.enableImageDrag || DEFAULT_SETTINGS.enableLinkDrag
		};

		function getGestureAction(pattern) {
			if (!SETTINGS.enableGestureCustomization) {
				return DEFAULT_GESTURES[pattern];
			}

			const config = SETTINGS.mouseGestures?.[pattern];
			return config?.action;
		}


		function getActionName(pattern) {
			const action = getGestureAction(pattern);
			if (!action || action === 'none') return '';
			if (SETTINGS.enableGestureCustomization) {
				const customName = SETTINGS.mouseGestures?.[pattern]?.customName;
				if (customName) return customName;
			}
			if (action === 'customMenu') {
				const config = SETTINGS.mouseGestures?.[pattern];
				const menuDef = SETTINGS.customMenus?.[config?.menuId];
				if (menuDef?.name) return menuDef.name;
				if (!menuDef) return `${msg(ACTION_KEYS[action])} ${msg('menuNotFound')}`;
			}
			if (action === 'simulateKey') {
				const config = SETTINGS.mouseGestures?.[pattern] || {};
				const defaults = ACTION_DEFAULTS.simulateKey || {};
				const keyValue = config.keyValue || defaults.keyValue || 'ArrowLeft';
				const mods = [];
				if (config.modCtrl) mods.push('Ctrl');
				if (config.modShift) mods.push('Shift');
				if (config.modAlt) mods.push('Alt');
				if (config.modMeta) mods.push('Meta');
				mods.push(keyValue);
				return `${msg(ACTION_KEYS[action])} (${mods.join('+')})`;
			}
			const i18nKey = ACTION_KEYS[action];
			return i18nKey ? msg(i18nKey) : '';
		}

		function getSuggestedGestures(currentPattern) {
			const source = SETTINGS.enableGestureCustomization
				? (SETTINGS.mouseGestures || {})
				: DEFAULT_GESTURES;
			const suggestions = [];
			for (const pattern of Object.keys(source)) {
				if (!pattern.startsWith(currentPattern)) continue;
				if (pattern.length !== currentPattern.length + 1) continue;
				const actionName = getActionName(pattern);
				if (!actionName) continue;
				suggestions.push({ pattern, actionName });
			}

			const lastDir = currentPattern.slice(-1);
			const isHorizontal = lastDir === '←' || lastDir === '→';
			const isVertical = lastDir === '↑' || lastDir === '↓';

			const getSortKey = (pattern) => {
				const D = pattern[currentPattern.length];
				if (isHorizontal) {
					if (D === '↑') return 0;
					if (D === '←' || D === '→') return 1;
					if (D === '↓') return 2;
				} else if (isVertical) {
					if (D === '←') return 0;
					if (D === '↑' || D === '↓') return 1;
					if (D === '→') return 2;
				}
				return 3;
			};

			suggestions.sort((a, b) => getSortKey(a.pattern) - getSortKey(b.pattern));
			return suggestions;
		}

		function loadSettings() {
			chrome.storage.sync.get(null, async (items) => {
				if (chrome.runtime.lastError) {
					console.error(chrome.runtime.lastError);
					return;
				}
				if (items) {
					const { blacklist, ...otherSettings } = items;
					SETTINGS = { ...structuredClone(DEFAULT_SETTINGS), ...otherSettings };
				}

				await window.ContentI18n.loadLanguage(SETTINGS.language);

				SETTINGS.enableDrag = SETTINGS.enableTextDrag || SETTINGS.enableImageDrag || SETTINGS.enableLinkDrag;

				recognizer.updateConfig({
					distanceThreshold: SETTINGS.distanceThreshold,
					longGestureMultiplier: SETTINGS.gestureTurnTolerance
				});

				if (SETTINGS.enableTrail || SETTINGS.enableHUD) {
					const lang = window.ContentI18n.getHtmlLang();
					const isRtl = window.ContentI18n.getDir() === 'rtl';
					visualizer.updateSettings({
						hudBgColor: SETTINGS.hudBgColor,
						hudTextColor: SETTINGS.hudTextColor,
						hudBlurRadius: SETTINGS.hudBlurRadius,
						enableHudShadow: SETTINGS.enableHudShadow,
						trailColor: SETTINGS.trailColor,
						trailWidth: SETTINGS.trailWidth,
						showTrailOrigin: SETTINGS.showTrailOrigin,
						enableInputStabilization: SETTINGS.enableTrailSmooth,
						enablePathInterpolation: SETTINGS.enableTrailSmooth,
						customCss: SETTINGS.customCss,
						lang,
						isRtl
					});
					toaster.updateSettings({
						hudBgColor: SETTINGS.hudBgColor,
						hudTextColor: SETTINGS.hudTextColor,
						hudBlurRadius: SETTINGS.hudBlurRadius,
						customCss: SETTINGS.customCss,
						lang,
						isRtl
					});
				}

				eventManager.update();
			});
		}

		chrome.storage.onChanged.addListener((changes, namespace) => {
			if (namespace === 'sync') {
				const keys = Object.keys(changes);
				if (keys.length === 1 && keys[0] === 'blacklist') return;

				loadSettings();
			}
		});

		loadSettings();

		chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
			if (request.action === 'ping') {
				sendResponse({ pong: true });
				return;
			}

			if (request.action === 'gestureStateUpdate') {
				isRemoteGestureActive = request.active;
			}

			if (request.action === 'executeLocalAction' && !isIframe) {
				if (!LOCAL_ACTIONS.has(request.stepAction)) {
					sendResponse({ success: false });
					return;
				}
				executeAction(request.stepAction, request.stepConfig)
					.then(() => sendResponse({ success: true }))
					.catch(() => sendResponse({ success: false }));
				return true;
			}

			if (request.action === 'gestureHudUpdate' && !isIframe) {
				const d = request.data;
				switch (d.type) {
					case 'hide': visualizer.hide(); break;
					case 'updateAction': visualizer.updateAction(d.arrows, d.texts); break;
					case 'updateSuggestedGestures': visualizer.updateSuggestedGestures(d.suggestions, d.currentPattern); break;
				}
			}

			if (request.action === 'gestureScrollUpdate' && !isIframe) {
				handleScroll(request.data.action, request.data.scrollConfig, true);
			}

			if (request.action === 'showDownloadError' && !isIframe) {
				toaster.showToast(msg('downloadErrorHotlink'), { duration: 5000 });
			}
			if (request.action === 'pauseGesture') {
				isBlacklisted = true;
				resetState();
				eventManager.dispose();
				visualizer.cleanup();
				toaster.cleanup();
			}
		});

		let gestureState = {
			isRightButton: false,
			gestureButton: null,
			isDrag: false,
			selectedText: '',
			dragElement: null,
			dragType: null,
			parentLink: null,
			startTarget: null,
			preventContextMenu: false,
			skipFirstDragOver: false,
			dropOnInputSuppressed: false
		};

		function resetState() {
			if (!isIframe || recognizer.isActive()) {
				visualizer.hide();
				if (SETTINGS.enableHUD) visualizer.updateAction('', []);
			}
			recognizer.reset();
			gestureState.isRightButton = false;
			gestureState.gestureButton = null;
			gestureState.isDrag = false;
			gestureState.selectedText = '';
			gestureState.dragElement = null;
			gestureState.dragType = null;
			gestureState.startTarget = null;
			gestureState.skipFirstDragOver = false;
			gestureState.dropOnInputSuppressed = false;
		}

		let isRemoteGestureActive = false;

		let edgeGestureBlurCount = 0;

		let preventContextMenuTimeoutId = null;

		let lastPointerType = 'mouse';

		class RelayGestureOverlay extends window.GestureOverlay {
			updateAction(arrows, texts) {
				if (isIframe) {
					safeSendMessage({ action: 'gestureHudUpdate', data: { type: 'updateAction', arrows, texts } });
				} else {
					super.updateAction(arrows, texts);
				}
			}

			updateSuggestedGestures(suggestions, currentPattern) {
				if (isIframe) {
					safeSendMessage({ action: 'gestureHudUpdate', data: { type: 'updateSuggestedGestures', suggestions, currentPattern } });
				} else {
					super.updateSuggestedGestures(suggestions, currentPattern);
				}
			}

			hide() {
				super.hide();

				if (isIframe) {
					safeSendMessage({ action: 'gestureHudUpdate', data: { type: 'hide' } });
				}
			}
		}

		const visualizer = new RelayGestureOverlay();
		const toaster = new window.ToastOverlay();

		const isGestureEnabled = () => SETTINGS.enableGesture && !isBlacklisted;
		const isDragEnabled = () => SETTINGS.enableDrag && !isBlacklisted;
		const eventManager = new window.EventManager();

		let _docEl = document.documentElement;
		new MutationObserver(() => {
			if (document.documentElement !== _docEl) {
				_docEl = document.documentElement;
				eventManager.reattach();
			}
		}).observe(document, { childList: true });

		{
			const extensionId = chrome.runtime.id;
			function onDispose(event) {
				if (event.detail?.extensionId !== extensionId) return;
				isBlacklisted = true;
				eventManager.dispose();
				visualizer.cleanup();
				toaster.cleanup();
			}
			window.addEventListener('flowmouse:dispose', onDispose, { once: true });
			eventManager.onReattach(() => {
				window.addEventListener('flowmouse:dispose', onDispose, { once: true });
			});
		}

		function isExtensionContextValid() {
			{
				if (!chrome.runtime?.id) {
					isBlacklisted = true;
					eventManager.dispose();
					visualizer.cleanup();
					toaster.cleanup();
					return false;
				}
			}
			return true;
		}

		const isMacOrLinux = /Mac|Linux/i.test(navigator.platform);
		let lastRightClickTime = 0;
		const doubleClickDelay = 500;

		let macLinuxHintShown = false;

		function showMacLinuxHint() {
			if (macLinuxHintShown) return;
			const hintText = msg('macLinuxDoubleClickHint');
			if (!hintText) return;
			macLinuxHintShown = true;
			toaster.showToast(hintText, {
				onClick: () => {
					try { chrome.storage.sync.set({ macLinuxHintDismissed: true }); } catch (e) {}
					SETTINGS.macLinuxHintDismissed = true;
					safeSendMessage({ action: 'openOptionsPage', hash: '#mac-linux-notice' });
				},
			});
		}

		let rightButtonSeenOnPage = false;

		eventManager.add(null, window, 'pageshow', (e) => {
			if (e.persisted) {
				rightButtonSeenOnPage = false;
				resetState();
			}
		});

		eventManager.add(null, document, 'visibilitychange', () => {
			rightButtonSeenOnPage = false;
			resetState();
		});

		eventManager.add(null, window, 'pagehide', () => {
			if (recognizer.isActive()) {
				safeSendMessage({ action: 'gestureStateUpdate', active: false });
				resetState();
			}
		});

		eventManager.add(() => !isBlacklisted, window, 'contextmenu', (e) => {
			if (!isExtensionContextValid()) return;


			if (!rightButtonSeenOnPage && e.button === 2) {
				rightButtonSeenOnPage = true;
				e.preventDefault();
				e.stopImmediatePropagation();
				return;
			}
			const triggerBtns = SETTINGS.gestureTriggerButtons;
			const gestureUsesRightClick = SETTINGS.enableGesture && (triggerBtns.right !== false || triggerBtns.penRight === true);
			if (!gestureUsesRightClick) return;

			if (e.composedPath().some(el => el.hasAttribute && el.hasAttribute('data-gesture-ignore'))) return;

			if (isMacOrLinux) {
				if (e.ctrlKey || e.button !== 2) return;

				const now = Date.now();
				if (recognizer.isActive()) {
					e.preventDefault();
					e.stopImmediatePropagation();
					return;
				}
				if (now - lastRightClickTime < doubleClickDelay) {
					lastRightClickTime = 0;
					gestureState.isRightButton = false;
					recognizer.reset();
					if (!SETTINGS.macLinuxHintDismissed) {
						SETTINGS.macLinuxHintDismissed = true;
						try { chrome.storage.sync.set({ macLinuxHintDismissed: true }); } catch (e) {}
					}
					return;
				} else {
					lastRightClickTime = now;
					e.preventDefault();

					if (!SETTINGS.macLinuxHintDismissed && !isIframe) {
						showMacLinuxHint();
					}

					return;
				}
			} else {
				if (gestureState.preventContextMenu || isRemoteGestureActive) {
					e.preventDefault();
					e.stopImmediatePropagation();
					if (isRemoteGestureActive) {
						safeSendMessage({ action: 'gestureStateUpdate', active: false });
					}
					return;
				}
			}
		}, { capture: true });

		eventManager.add(null, window, 'pointerdown', (e) => {
			if (e.button === 0) {
				lastPointerType = e.pointerType;
			}
			if (e.button === 2) {
				rightButtonSeenOnPage = true;
			}
		}, true);

		function isTriggerButton(pointerType, button) {
			const btns = SETTINGS.gestureTriggerButtons;
			if (pointerType === 'pen') return button === 2 && btns.penRight === true;
			if (pointerType !== 'mouse') return false;
			switch (button) {
				case 2: return btns.right !== false;
				case 1: return btns.middle === true;
				case 3: return btns.side1 === true;
				case 4: return btns.side2 === true;
				default: return false;
			}
		}

		eventManager.add(isGestureEnabled, window, 'pointerdown', (e) => {
			if (isTriggerButton(e.pointerType, e.button)) {
				if (e.composedPath().some(el => el.hasAttribute && el.hasAttribute('data-gesture-ignore'))) return;

				gestureState.isRightButton = true;
				gestureState.gestureButton = e.button;
				gestureState.isDrag = false;
				gestureState.preventContextMenu = false;
				gestureState.startTarget = e.composedPath()[0];
				if (preventContextMenuTimeoutId) {
					clearTimeout(preventContextMenuTimeoutId);
					preventContextMenuTimeoutId = null;
				}
				recognizer.start(e.clientX, e.clientY, e.timeStamp);

				if (e.button === 1 || e.pointerType === 'pen' && e.button === 2) {
					e.preventDefault();
				}

			}
		}, { capture: true });

		eventManager.add(isGestureEnabled, window, 'pointermove', (e) => {
			if (!gestureState.isRightButton) return;

			const result = recognizer.move(e.clientX, e.clientY, e.timeStamp);

			if (result.totalDistance > 3 || result.activated) {
				try {
					const target = document.documentElement || document.body;
					if (!target.hasPointerCapture(e.pointerId)) {
						target.setPointerCapture(e.pointerId);
					}
				} catch (err) {
					console.warn('FlowMouse: setPointerCapture failed', err);
				}
			}

			let currentPoints = [];
			if (SETTINGS.enableTrail) {
				if (e.getCoalescedEvents) {
					const events = e.getCoalescedEvents();
					if (events.length > 0) {
						currentPoints = events.map(evt => ({ x: evt.clientX, y: evt.clientY, timestamp: evt.timeStamp }));
					}
				}
				if (currentPoints.length === 0) {
					currentPoints = [{ x: e.clientX, y: e.clientY, timestamp: e.timeStamp }];
				}
			}

			if (result.activated) {
				if (!isExtensionContextValid()) return;
				gestureState.preventContextMenu = true;
				safeSendMessage({ action: 'gestureStateUpdate', active: true });
				if (SETTINGS.enableTrail) {
					visualizer.updateSettings({
						minCutoff: 5.0,
						beta: 0.01,
						dcutoff: 1.0
					});
					visualizer.show();

					const preTrail = result.preActivationTrail || [{ x: recognizer.startX, y: recognizer.startY, timestamp: recognizer.startTimestamp }];
					const merged = [...preTrail, ...currentPoints];
					merged.sort((a, b) => a.timestamp - b.timestamp);
					visualizer.addPoints(merged);
				}
			} else if (recognizer.isActive() && SETTINGS.enableTrail) {
				visualizer.addPoints(currentPoints);
			}

			if (!recognizer.isActive()) return;

			if (result.directionChanged && SETTINGS.enableHUD) {
				const actionName = getActionName(result.pattern);
				visualizer.updateAction(result.pattern, actionName ? [actionName] : []);
				if (SETTINGS.enableSuggestedGestures) {
					const suggestions = getSuggestedGestures(result.pattern);
					visualizer.updateSuggestedGestures(suggestions, result.pattern);
				}
			}
		}, { capture: true });

		eventManager.add(isGestureEnabled, window, 'pointerup', (e) => {
			if (gestureState.isRightButton) {
				if (recognizer.isActive()) {
					e.preventDefault();
					e.stopPropagation();
					executeGesture(recognizer.getPattern());
					lastRightClickTime = 0;
				}

				resetState();
			}
			if (gestureState.preventContextMenu) {
				preventContextMenuTimeoutId = setTimeout(() => {
					gestureState.preventContextMenu = false;
					preventContextMenuTimeoutId = null;
					safeSendMessage({ action: 'gestureStateUpdate', active: false });
				}, 50);
			}
		}, { capture: true });

		eventManager.add(isGestureEnabled, window, 'mousedown', (e) => {
			if (e.button === 0 && gestureState.isRightButton && recognizer.isActive()) {
				e.preventDefault();
				e.stopImmediatePropagation();
				resetState();
			}
		}, { capture: true });


		eventManager.add(isDragEnabled, window, 'mousedown', (e) => {
			if (e.button !== 0) return;

			let target = e.target;
			let depth = 0;
			let hasModified = false;

			while (target && target !== document.body && depth < 5) {
				if (target.getAttribute && target.getAttribute('draggable') === 'false') {
					let shouldForce = false;


					if (target.tagName === 'A' && target.href) {
						if (!target.querySelector('input, textarea, select, button')) {
							shouldForce = true;
						}
					}
					else if (window.getSelection().rangeCount > 0 && window.getSelection().containsNode(target, true)) {
						shouldForce = true;
					}

					if (shouldForce) {
						target.setAttribute('draggable', 'true');
						target.setAttribute('data-flowmouse-modified', 'true');
						hasModified = true;
					}
				}
				target = target.parentElement;
				depth++;
			}

			if (hasModified) {
				window.addEventListener('mouseup', restoreDraggable, true);
				window.addEventListener('dragend', restoreDraggable, true);
			}
		}, { capture: true });

		function restoreDraggable(e) {
			if (!e.isTrusted) return;
			window.removeEventListener('mouseup', restoreDraggable, true);
			window.removeEventListener('dragend', restoreDraggable, true);

			const modified = document.querySelectorAll('[data-flowmouse-modified="true"]');
			modified.forEach(el => {
				el.setAttribute('draggable', 'false');
				el.removeAttribute('data-flowmouse-modified');
			});
		}

		eventManager.add(isDragEnabled, window, 'dragstart', (e) => {
			if (!isExtensionContextValid()) return;

			const path = e.composedPath();

			const dragSource = path[0];
			if (dragSource && dragSource.nodeType === Node.ELEMENT_NODE) {
				const cursor = window.getComputedStyle(dragSource).cursor;
				if ((cursor === 'grab' || cursor === 'grabbing' || cursor === 'move')
					&& !window.getSelection().toString().trim()) {
					return;
				}
			}

			let dragContent = null;
			let dragElement = null;
			let dragType = null;

			const dtItems = [...e.dataTransfer.items];
			let isImage = dtItems.some(i => i.kind === 'file' && i.type.startsWith('image/'));
			const isLink = !isImage && dtItems.some(i => i.type === 'text/uri-list');
			const isText = !isImage && !isLink && dtItems.some(i => i.type === 'text/plain' || i.type === 'text/html');

			if (SETTINGS.enableImageDrag && isImage) {
				let targetImg = path.find(el => el.tagName === 'IMG');


				if (targetImg) {
					dragContent = targetImg.src || targetImg.currentSrc;
					dragElement = targetImg;
					dragType = 'image';
					const parentLink = path.find(el => el.tagName === 'A' && el.href);
					if (parentLink) {
						gestureState.parentLink = parentLink.href;
					} else {
						gestureState.parentLink = null;
					}
					window.getSelection().removeAllRanges();
				}
			}

			if (!dragContent && SETTINGS.enableLinkDrag && isLink) {
				const targetLink = path.find(el => el.tagName === 'A' && el.href);
				if (targetLink) {
					let rawHref = targetLink.getAttribute('href');

					if (rawHref) {
						try {
							const absoluteUrl = new URL(rawHref, document.baseURI).href;

							if (tryParseAsUrl(absoluteUrl, true)) {
								dragContent = absoluteUrl;
								dragType = 'link';
								dragElement = targetLink;
								window.getSelection().removeAllRanges();
							}
						} catch (err) {
						}
					}
				}
			}

			if (!dragContent && SETTINGS.enableTextDrag && isText) {
				let skipDrag = false;
				if (SETTINGS.textDragIgnoreInput) {
					skipDrag = isEditableTarget(e);
				}
				if (!skipDrag) {
					for (const el of path) {
						if (el === document || el === window) break;
						if (el.getAttribute && el.getAttribute('draggable') === 'true'
							&& !el.hasAttribute('data-flowmouse-modified')
							&& el.tagName !== 'IMG'
							&& !(el.tagName === 'A' && el.href)) {
							skipDrag = true;
							break;
						}
					}
				}
				if (!skipDrag) {
					const text = e.dataTransfer.getData('text/plain')?.trim() || window.getSelection().toString().trim();
					if (text) {
						dragContent = text;
						dragType = 'text';
					}
				}
			}

			if (dragContent) {
				gestureState.isDrag = true;
				gestureState.isRightButton = false;
				gestureState.selectedText = dragContent;
				gestureState.dragElement = dragElement;
				gestureState.dragType = dragType;
				recognizer.start(e.clientX, e.clientY, e.timeStamp);
				if (lastPointerType === 'touch' || lastPointerType === 'pen' || isMacOrLinux) {
					gestureState.skipFirstDragOver = true;
				}
			}
		}, { capture: false });

		eventManager.add(isDragEnabled, window, 'dragover', (e) => {
			if (!gestureState.isDrag) return;

			if (gestureState.skipFirstDragOver) {
				gestureState.skipFirstDragOver = false;
				return;
			}

			const result = recognizer.move(e.clientX, e.clientY, e.timeStamp);

			const currentPoint = { x: e.clientX, y: e.clientY, timestamp: e.timeStamp };

			if (result.activated) {
				if (SETTINGS.enableTrail) {
					visualizer.updateSettings({
						minCutoff: 1.0,
						beta: 0.007,
						dcutoff: 1.0
					});
					visualizer.show();

					const preTrail = result.preActivationTrail || [{ x: recognizer.startX, y: recognizer.startY, timestamp: recognizer.startTimestamp }];
					const merged = [...preTrail, currentPoint];
					merged.sort((a, b) => a.timestamp - b.timestamp);
					visualizer.addPoints(merged);
				}
			} else if (recognizer.isActive() && SETTINGS.enableTrail) {
				visualizer.addPoints([currentPoint]);
			}

			if (!recognizer.isActive()) return;

			const shouldIgnoreGestureOnInputDrop = (gestureState.dragType === 'text' && SETTINGS.textDropIgnoreInput)
				|| (gestureState.dragType === 'link' && SETTINGS.linkDropIgnoreInput);
			if (shouldIgnoreGestureOnInputDrop && isEditableTarget(e)) {
				if (!gestureState.dropOnInputSuppressed) {
					gestureState.dropOnInputSuppressed = true;
					visualizer.updateAction('', []);
				}
				return;
			}
			if (gestureState.dropOnInputSuppressed) {
				gestureState.dropOnInputSuppressed = false;
				result.directionChanged = true;
			}

			if (hasDragAction(gestureState.dragType, recognizer.getPattern())) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}

			if (result.directionChanged && SETTINGS.enableHUD) {
				const hints = getDragHints(gestureState.dragType, result.pattern, gestureState.selectedText, gestureState.parentLink);
				visualizer.updateAction(hints.length > 0 ? result.pattern : '', hints);
			}
		}, { capture: true });

		eventManager.add(isDragEnabled, window, 'dragenter', (e) => {
			if (!gestureState.isDrag) return;
			if (!recognizer.isActive()) return;
			if (gestureState.dropOnInputSuppressed) return;
			if (hasDragAction(gestureState.dragType, recognizer.getPattern())) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		}, { capture: true });

		eventManager.add(isDragEnabled, window, 'dragleave', (e) => {
			if (gestureState.isDrag && e.relatedTarget === null) {
				resetState();
			}
		}, { capture: true });

		let dropHandledAction = false;
		eventManager.add(isDragEnabled, window, 'dragend', (e) => {
			if (dropHandledAction) {
				dropHandledAction = false;
				e.preventDefault();
			}
			resetState();
		}, { capture: true });

		eventManager.add(isDragEnabled, window, 'drop', (e) => {
			try {
				if (gestureState.isDrag && recognizer.isActive()) {
					if (gestureState.dropOnInputSuppressed) return;
					const pattern = recognizer.getPattern();
					if (hasDragAction(gestureState.dragType, pattern)) {
						dropHandledAction = true;
						e.preventDefault();
						executeDragGesture({ ...gestureState, startX: recognizer.startX, startY: recognizer.startY }, pattern, e.dataTransfer);
					}
				}
			} finally {
				resetState();
			}
		}, { capture: true });

		eventManager.add(null, window, 'keydown', (e) => {
			if (e.key === 'Escape') {
				if (gestureState.isRightButton || gestureState.isDrag) {
					if (gestureState.isRightButton && recognizer.isActive()) {
						e.preventDefault();
						e.stopImmediatePropagation();
					}
					if (gestureState.isRightButton) {
						safeSendMessage({ action: 'gestureStateUpdate', active: false });
					}

					resetState();
				}
			}
		}, true);






		eventManager.add(null, window, 'blur', () => {
			if (gestureState.isRightButton) {
				if (recognizer.isActive()) {
					safeSendMessage({ action: 'gestureStateUpdate', active: false });
				}

				if (isEdgeDesktop && !isIframe) {
					edgeGestureBlurCount++;
					if (edgeGestureBlurCount >= 2 && !SETTINGS.edgeGestureConflict) {
						SETTINGS.edgeGestureConflict = true;
						try { chrome.storage.sync.set({ edgeGestureConflict: true }); } catch (e) { }
					}
				}

				gestureState.preventContextMenu = false;
				resetState();
			}
		});

		async function executeAction(action, config = {}, cursor = {}, startTarget = null, useActiveTab = false) {
			if (!action || action === 'none') return false;
			if (!isExtensionContextValid()) return false;

			if (!ACTION_KEYS[action]) return false;

			const defaults = ACTION_DEFAULTS[action] || {};
			const mergedConfig = { ...defaults, ...config };

			if (LOCAL_ACTIONS.has(action)) {
				const scrollConfig = { scrollDistance: mergedConfig.scrollDistance, scrollSmoothness: mergedConfig.scrollSmoothness, scrollDuration: mergedConfig.scrollDuration, scrollAccel: mergedConfig.scrollAccel, scrollAccelWindow: mergedConfig.scrollAccelWindow };
				switch (action) {
					case 'scrollUp':
					case 'scrollDown':
					case 'scrollLeft':
					case 'scrollRight':
					case 'scrollToTop':
					case 'scrollToBottom':
					case 'scrollToLeftEdge':
					case 'scrollToRightEdge':
						if (isIframe && !checkScrollFeasibility(action, cursor.startX, cursor.startY)) {
							safeSendMessage({ action: 'gestureScrollUpdate', data: { action, scrollConfig } });
							break;
						}
						handleScroll(action, scrollConfig, false, cursor.startX, cursor.startY);
						break;
					case 'stopLoading': safeSendMessage({ action: 'restoreTab' }); break; // 【本扩展定制】改绑为撤回关闭的标签页
					case 'copyUrl': copyText(location.href); break;
					case 'copyTitle': copyText(document.title); break;
					case 'copyTitleAndUrl': {
						if (mergedConfig.asMarkdown) {
							const t = document.title.replace(/([\[\]])/g, '\\$1');
							const u = location.href.replace(/([()])/g, '\\$1');
							copyText(`[${t}](${u})`);
						} else {
							copyText(`${document.title}\n${location.href}`);
						}
						break;
					}
					case 'printPage': window.print(); break;
					case 'sendCustomEvent': {
						const eventType = mergedConfig.eventType;
						if (eventType) {
							let detail = {};
							try {
								const detailStr = mergedConfig.eventDetail || '{}';
								detail = JSON.parse(detailStr);
							} catch { }
							if (mergedConfig.gestureInfo) {
								detail.gesture = {
									startX: cursor.startX,
									startY: cursor.startY,
									endX: cursor.endX,
									endY: cursor.endY,
								};
							}
							window.dispatchEvent(new CustomEvent(eventType, { detail, bubbles: true, cancelable: true }));
						}
						break;
					}
					case 'simulateKey': {
						const keyValue = mergedConfig.keyValue;
						if (keyValue) {
							const KEY_CODE_MAP = {
								Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18,
								Escape: 27, ' ': 32, PageUp: 33, PageDown: 34,
								End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
								Delete: 46, Insert: 45,
								F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
								F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
							};
							let keyCode = KEY_CODE_MAP[keyValue];
							if (keyCode == null && keyValue.length === 1) {
								keyCode = keyValue.toUpperCase().charCodeAt(0);
							}
							keyCode = keyCode || 0;
							let code = keyValue;
							if (keyValue.length === 1) {
								const ch = keyValue.toUpperCase();
								if (ch >= 'A' && ch <= 'Z') code = 'Key' + ch;
								else if (ch >= '0' && ch <= '9') code = 'Digit' + ch;
							}
							const opts = {
								key: keyValue,
								code,
								keyCode,
								which: keyCode,
								bubbles: true,
								cancelable: true,
								ctrlKey: !!mergedConfig.modCtrl,
								shiftKey: !!mergedConfig.modShift,
								altKey: !!mergedConfig.modAlt,
								metaKey: !!mergedConfig.modMeta,
							};
							const target = document.activeElement || document.body;
							target.dispatchEvent(new KeyboardEvent('keydown', opts));
							target.dispatchEvent(new KeyboardEvent('keyup', opts));
						}
						break;
					}
					case 'pasteClipboard': {
						try {
							const permResult = await safeSendMessage({ action: 'requestPermission', permissions: ['clipboardRead'] });
							if (!permResult?.granted) break;
							if (startTarget) startTarget.focus();
							document.execCommand('paste');
						} catch { }
						break;
					}
					case 'pasteContent': {
						try {
							const content = mergedConfig.content || '';
							if (!content) break;
							if (startTarget) startTarget.focus();
							document.execCommand('insertText', false, content);
						} catch { }
						break;
					}
					case 'searchClipboard': {
						const permResult = await safeSendMessage({ action: 'requestPermission', permissions: ['clipboardRead'] });
						if (!permResult?.granted) break;
						const clipText = (await navigator.clipboard.readText() || '').trim();
						if (!clipText) break;
						const { SEARCH_ENGINES } = window.GestureConstants;
						const engine = mergedConfig.engine || 'system';
						const customUrl = mergedConfig.url || '';
						const position = mergedConfig.position || 'right';
						const active = mergedConfig.active !== false;
						const incognito = !!mergedConfig.incognito;
						if (mergedConfig.autoDetectUrl) {
							const detectedUrl = tryParseAsUrl(clipText, false);
							if (detectedUrl) {
								await safeSendMessage({ action: 'openTabAtPosition', url: detectedUrl, position, active, incognito });
								break;
							}
						}
						if (engine === 'system') {
							await safeSendMessage({ action: 'systemSearch', query: clipText, position, active, incognito });
						} else if (engine === 'custom' && customUrl) {
							await safeSendMessage({ action: 'openTabAtPosition', url: customUrl.replace('%s', encodeURIComponent(clipText)), position, active, incognito });
						} else {
							const searchUrl = (SEARCH_ENGINES[engine] || SEARCH_ENGINES['google']).url + encodeURIComponent(clipText);
							await safeSendMessage({ action: 'openTabAtPosition', url: searchUrl, position, active, incognito });
						}
						break;
					}
				}
			} else {
				const msg_obj = { action };
				if (useActiveTab) msg_obj.useActiveTab = true;
				if (action === 'openCustomUrl') {
					const rawUrl = mergedConfig.customUrl || '';
					msg_obj.customUrl = rawUrl;
					msg_obj.position = mergedConfig.position || 'last';
					msg_obj.active = mergedConfig.active !== false;
					msg_obj.incognito = !!mergedConfig.incognito;
				} else if (action === 'closeTab') {
					msg_obj.keepWindow = !!mergedConfig.keepWindow;
					msg_obj.afterClose = mergedConfig.afterClose || 'default';
					msg_obj.skipPinned = !!mergedConfig.skipPinned;
					msg_obj.preserveTab = !!mergedConfig.preserveTab;
				} else if (action === 'closeOtherTabs' || action === 'closeLeftTabs' || action === 'closeRightTabs') {
					msg_obj.skipPinned = !!mergedConfig.skipPinned;
					msg_obj.preserveTab = !!mergedConfig.preserveTab;
				} else if (action === 'closeAllTabs') {
					msg_obj.skipPinned = !!mergedConfig.skipPinned;
				} else if (action === 'switchLeftTab' || action === 'switchRightTab') {
					msg_obj.noWrap = !!mergedConfig.noWrap;
					msg_obj.moveTab = !!mergedConfig.moveTab;
				} else if (action === 'switchFirstTab' || action === 'switchLastTab') {
					msg_obj.moveTab = !!mergedConfig.moveTab;
				} else if (action === 'refresh' || action === 'refreshAllTabs') {
					msg_obj.hardReload = !!mergedConfig.hardReload;
				} else if (action === 'newTab') {
					msg_obj.position = mergedConfig.position || 'last';
					msg_obj.active = mergedConfig.active !== false;
				} else if (action === 'newWindow') {
					msg_obj.focused = mergedConfig.focused !== false;
				} else if (action === 'viewPageSource') {
					msg_obj.position = mergedConfig.position || 'right';
					msg_obj.active = mergedConfig.active !== false;
				} else if (action === 'zoomIn' || action === 'zoomOut') {
					msg_obj.zoomMode = mergedConfig.zoomMode || 'browser';
					msg_obj.zoomDelta = Number(mergedConfig.zoomDelta) || 10;
				} else if (action === 'resetZoom') {
					msg_obj.resetZoomLevel = Number(mergedConfig.resetZoomLevel) || 0;
				} else if (action === 'addToBookmarks') {
				} else if (action === 'sendExtensionMessage') {
					msg_obj.extensionId = mergedConfig.extensionId || '';
					msg_obj.message = mergedConfig.message || '{}';
				}
				return await safeSendMessage(msg_obj);
			}
			return true;
		}

		function executeGesture(pattern) {
			const action = getGestureAction(pattern);
			if (!action || action === 'none') return;

			if (isEdgeDesktop && SETTINGS.edgeGestureConflict) {
				SETTINGS.edgeGestureConflict = false;
				edgeGestureBlurCount = 0;
				try { chrome.storage.sync.set({ edgeGestureConflict: false }); } catch (e) { }
			}

			const config = SETTINGS.enableGestureCustomization
				? (SETTINGS.mouseGestures?.[pattern] || {})
				: {};
			executeAction(action, config, { startX: recognizer.startX, startY: recognizer.startY, endX: recognizer.currentX, endY: recognizer.currentY }, gestureState.startTarget);
		}

		function resolveTabTarget(config, state) {
			const { SEARCH_ENGINES, IMAGE_SEARCH_ENGINES } = window.GestureConstants;
			const { selectedText: content, dragType, parentLink } = state;
			const engine = config.engine;
			const customUrl = config.url;

			switch (config.action) {
				case 'search': {
					if (config.autoDetectUrl === true && dragType === 'text') {
						const url = tryParseAsUrl(content, false);
						if (url) return { url };
					}
					if (engine === 'system') return { query: content };
					if (engine === 'custom' && customUrl) return { url: customUrl.replace('%s', encodeURIComponent(content)) };
					return { url: (SEARCH_ENGINES[engine] || SEARCH_ENGINES['google']).url + encodeURIComponent(content) };
				}
				case 'openTab':
					return { url: (dragType === 'image' && config.preferLink === true && parentLink) ? parentLink : content };
				case 'imageSearch': {
					if (engine === 'custom' && customUrl) return { url: customUrl.replace('%s', encodeURIComponent(content)) };
					return { url: (IMAGE_SEARCH_ENGINES[engine] || IMAGE_SEARCH_ENGINES['google']).url + encodeURIComponent(content) };
				}
				default:
					return null;
			}
		}

		const COPY_ACTION_RESOLVERS = {
			'copy':         (state) => state.selectedText,
			'copyLink':     (state) => state.selectedText,
			'copyLinkText': (state) => state.dragElement ? (state.dragElement.innerText || state.dragElement.textContent || '') : null,
			'copyLinkAndText': (state, config) => {
				const text = state.dragElement ? (state.dragElement.innerText || state.dragElement.textContent || '') : '';
				const link = state.selectedText || '';
				if (!text && !link) return null;
				if (config.asMarkdown && link) {
					const t = (text || link).replace(/([\[\]])/g, '\\$1');
					const u = link.replace(/([()])/g, '\\$1');
					return `[${t}](${u})`;
				}
				return [text, link].filter(Boolean).join('\n');
			},
			'copyImageUrl': (state) => state.selectedText,
		};

		async function executeDragGesture(state, pattern, dataTransfer) {
			if (!pattern) return;
			if (!isExtensionContextValid()) return;

			const gestures = getGesturesForDragType(state.dragType);
			if (!gestures) return;

			let configs = getDragGestureConfigs(gestures, pattern);

			const copyTexts = [];
			configs = configs.filter(config => {
				const resolver = COPY_ACTION_RESOLVERS[config.action || 'none'];
				if (!resolver) return true;
				const text = resolver(state, config);
				if (text) copyTexts.push(text);
				return false;
			});
			if (copyTexts.length > 0) {
				copyText(copyTexts.join('\n'));
			}

			if (!isIncognito) {
				const incognitoUrls = [];
				const incognitoQueries = [];
				configs = configs.filter(config => {
					if (!config.incognito) return true;
					const target = resolveTabTarget(config, state);
					if (target?.url) incognitoUrls.push(target.url);
					else if (target?.query) incognitoQueries.push(target.query);
					return !target;
				});
				if (incognitoUrls.length > 0 || incognitoQueries.length > 0) {
					await safeSendMessage({ action: 'openIncognitoTabs', urls: incognitoUrls, queries: incognitoQueries });
				}
			}

			for (const config of configs) {
				await executeSingleDragAction(config, state, dataTransfer);
			}
		}

		async function executeSingleDragAction(config, state, dataTransfer) {
			const { selectedText: content, dragType, parentLink, dragElement } = state;
			const action = config.action || 'none';
			if (action === 'none') return;

			const { position, active, incognito } = config;

			switch (action) {
				case 'search':
				case 'openTab': {
					const target = resolveTabTarget(config, state);
					if (target?.query) {
						await safeSendMessage({ action: 'systemSearch', query: target.query, position, active, incognito });
					} else if (target?.url) {
						await safeSendMessage({ action: 'openTabAtPosition', url: target.url, position, active, incognito });
					}
					break;
				}

				case 'saveImage':
					if (content.startsWith('data:')) {
						safeSendMessage({ action: 'saveImage', url: content, subdir: config.subdir || '' });
						break;
					}

					if (dataTransfer && dataTransfer.files && dataTransfer.files.length > 0) {
						const file = dataTransfer.files[0];
						const reader = new FileReader();
						reader.onload = () => {
							safeSendMessage({
								action: 'saveImage',
								url: reader.result,
								filename: file.name,
								subdir: config.subdir || ''
							});
						};
						reader.readAsDataURL(file);
						break;
					}

					{
						const waitForImageLoad = (img, timeout = 60000) => {
							return new Promise((resolve, reject) => {
								if (!img || img.tagName !== 'IMG' || img.complete) {
									resolve();
									return;
								}

								let settled = false;
								const cleanup = () => {
									img.removeEventListener('load', onLoad);
									img.removeEventListener('error', onError);
								};
								const onLoad = () => {
									if (settled) return;
									settled = true;
									cleanup();
									resolve();
								};
								const onError = () => {
									if (settled) return;
									settled = true;
									cleanup();
									reject(new Error('load'));
								};

								img.addEventListener('load', onLoad);
								img.addEventListener('error', onError);

								setTimeout(() => {
									if (settled) return;
									settled = true;
									cleanup();
									reject(new Error('timeout'));
								}, timeout);
							});
						};

						waitForImageLoad(dragElement)
							.then(() => {
								safeSendMessage({
									action: 'saveImage',
									url: content,
									origin: window.location.origin,
									subdir: config.subdir || ''
								});
							})
							.catch((err) => {
								const toastMsg = err.message === 'timeout'
									? msg('saveImageTimeout')
									: msg('saveImageLoadError');
								toaster.showToast(toastMsg, { duration: 5000 });
							});
					}
					break;

				case 'imageSearch': {
					const target = resolveTabTarget(config, state);
					if (target?.url) {
						await safeSendMessage({ action: 'openTabAtPosition', url: target.url, position, active, incognito });
					}
					break;
				}

				case 'sendCustomEvent': {
					const eventType = config.eventType;
					if (eventType) {
						let detail = {};
						try {
							detail = JSON.parse(config.eventDetail || '{}');
						} catch { }
						if (config.gestureInfo) {
							detail.gesture = {
								dragType,
								data: content,
								startX: state.startX,
								startY: state.startY,
							};
						}
						window.dispatchEvent(new CustomEvent(eventType, { detail, bubbles: true, cancelable: true }));
					}
					break;
				}
			}
		}
	}
})();