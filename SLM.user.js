// ==UserScript==
// @name         ShortLink Master (SLM) + Document Controller
// @version      4.6
// @description  Professional framework for shortlink bypassing + full document control
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    if (window.self !== window.top) return;

    // =========================================================================
    // 0. CONFIG
    // =========================================================================
    const Config = {
        settings: { waitInterval: 250, fastMode: false, cacheEnabled: true },

        async detectOptimalSettings() {
            const isMobile = /Mobi|Android/i.test(navigator.userAgent);
            const t0 = Date.now();
            for (let i = 0; i < 1000; i++) JSON.stringify({ test: i });
            const dur = Date.now() - t0;

            this.settings.waitInterval = isMobile ? 400 : dur > 100 ? 300 : 200;
            this.settings.fastMode     = !isMobile && dur < 50;
            this.settings.cacheEnabled = !isMobile;
        }
    };

    // =========================================================================
    // 1. CACHE
    // =========================================================================
    const Cache = (() => {
        const _map = new Map();
        const TTL  = { selector: 300_000, xpath: 120_000 };

        const _isLive = v => {
            if (v instanceof Node) return v.isConnected;
            if (Array.isArray(v))  return !v.length || !(v[0] instanceof Node) || v.every(n => n.isConnected);
            return true;
        };

        return {
            TTL,
            get(key, ttl) {
                if (!Config.settings.cacheEnabled) return null;
                const e = _map.get(key);
                if (!e || Date.now() - e.ts >= ttl) return null;
                if (!_isLive(e.v)) { _map.delete(key); return null; }
                return e.v;
            },
            set(key, value) {
                if (Config.settings.cacheEnabled) _map.set(key, { v: value, ts: Date.now() });
            },
            cleanup() {
                const now = Date.now();
                for (const [k, e] of _map)
                    if (now - e.ts > TTL.selector || !_isLive(e.v)) _map.delete(k);
            },
            clear() { _map.clear(); }
        };
    })();

    setInterval(() => Cache.cleanup(), 300_000);

    // =========================================================================
    // 2. SPA MANAGER
    // =========================================================================
    const SPAManager = (() => {
        let _lastPath   = location.pathname;
        let _cleanups   = [];   
        let _debounceId = null; 

        const _onChange = () => {
            const newPath = location.pathname;
            if (newPath === _lastPath) return;

            console.log(`[SLM] SPA: ${_lastPath} → ${newPath}`);
            _lastPath = newPath;

            Cache.clear();

            for (const fn of _cleanups) {
                try { fn(); } catch (e) { console.warn('[SLM] SPA cleanup error:', e); }
            }
            _cleanups = [];

            setTimeout(() => Router.run(), 100);
        };

        const _trigger = () => {
            clearTimeout(_debounceId);
            _debounceId = setTimeout(_onChange, 50);
        };

        return {
            onLeave(fn) { _cleanups.push(fn); },

            init() {
                for (const method of ['pushState', 'replaceState']) {
                    const orig = history[method];
                    history[method] = function (...args) {
                        orig.apply(this, args);
                        _trigger();
                    };
                }

                window.addEventListener('popstate', _trigger);

                let _lastUrl = location.href;
                new MutationObserver(() => {
                    if (location.href !== _lastUrl) {
                        _lastUrl = location.href;
                        Cache.clear();
                        _trigger();
                    }
                }).observe(document, { subtree: true, childList: true });
            }
        };
    })();

    // =========================================================================
    // 3. WAITERS
    // =========================================================================
    const Waiters = {
        sleep: ms => new Promise(r => setTimeout(r, ms)),

        async waitForElement(selector, timeout = 30, checkVisible = false) {
            const deadline  = Date.now() + timeout * 1000;
            const isComplex = /XPATH|contains|text\(\)/.test(selector);
            let interval = isComplex ? 200 : Config.settings.waitInterval;
            let attempts = 0;

            while (Date.now() < deadline) {
                const el = Browser.getElement(selector, false);
                if (el) {
                    if (!checkVisible) return el;
                    const { width, height } = el.getBoundingClientRect();
                    if (width > 0 && height > 0) return el;
                }
                if (++attempts > 5) interval = Math.min(interval * 1.3, 500);
                await this.sleep(interval);
            }
            return null;
        },

        async waitForAnyVisible(selectorList, timeout = 30) {
            return this._waitForAny(selectorList, timeout, true);
        },

        async waitForAny(selectorList, timeout = 30) {
            return this._waitForAny(selectorList, timeout, false);
        },

        async _waitForAny(selectorList, timeout, checkVisible) {
            const selectors = selectorList.split(',').map(s => s.trim());
            const deadline  = Date.now() + timeout * 1000;
            let interval = 100, attempts = 0;

            while (Date.now() < deadline) {
                for (const sel of selectors) {
                    const el = Browser.getElement(sel, false);
                    if (!el) continue;
                    if (!checkVisible) return el;
                    const { width, height } = el.getBoundingClientRect();
                    if (width > 0 && height > 0) return el;
                }
                if (++attempts > 5) interval = Math.min(interval * 1.3, 400);
                await this.sleep(interval);
            }
            return null;
        },

        async waitForHide(selector, timeout = 30) {
            const deadline = Date.now() + timeout * 1000;
            while (Date.now() < deadline) {
                const el = Browser.getElement(selector, false);
                if (!el) return true;
                const { width, height } = el.getBoundingClientRect();
                if (width === 0 || height === 0) return true;
                await this.sleep(200);
            }
            return false;
        },

        async waitForText(selector, condition, timeout = 30) {
            const deadline = Date.now() + timeout * 1000;
            while (Date.now() < deadline) {
                const el = Browser.getElement(selector, false);
                if (el) {
                    const text = el.innerText?.trim() || el.textContent?.trim() || '';
                    if (typeof condition === 'string'   && text.includes(condition)) return text;
                    if (typeof condition === 'function' && condition(text))           return text;
                    if (condition instanceof RegExp     && condition.test(text))      return text;
                }
                await this.sleep(Config.settings.waitInterval);
            }
            return null;
        }
    };

    // =========================================================================
    // 4. BROWSER
    // =========================================================================
    const TOKEN_RE = />(CSS|MATCH|XPATH|AT|FRAME|SHADOW)>/g;

    const Browser = {
        getElement(selector, needAll = false, context = document) {
            if (!selector || selector === 'none')
                return needAll ? [document.body] : document.body;

            const cacheKey = `${selector}|${needAll}|${context === document}`;
            if (context === document) {
                const cached = Cache.get(cacheKey, Cache.TTL.selector);
                if (cached) return cached;
            }

            let full = selector.trim();
            if (!full.startsWith('>')) full = '>CSS>' + full;

            const parts    = full.split(TOKEN_RE);
            const commands = [];
            for (let i = 1; i < parts.length; i += 2)
                commands.push({ type: parts[i].toLowerCase(), value: (parts[i + 1] || '').trim() });

            const result = commands.reduce((ctx, cmd, i) => {
                if (!ctx) return null;
                const isLast = i === commands.length - 1;
                const useAll = (needAll && isLast) || commands[i + 1]?.type === 'at';

                try {
                    switch (cmd.type) {
                        case 'css':
                            return useAll
                                ? [...ctx.querySelectorAll(cmd.value)]
                                : ctx.querySelector(cmd.value);

                        case 'xpath': {
                            if (!useAll) {
                                const xk  = `xpath|${cmd.value}`;
                                const hit = Cache.get(xk, Cache.TTL.xpath);
                                if (hit) return hit;
                                const node = document.evaluate(
                                    cmd.value, ctx, null,
                                    XPathResult.FIRST_ORDERED_NODE_TYPE, null
                                ).singleNodeValue;
                                if (node) Cache.set(xk, node);
                                return node;
                            }
                            const snap = document.evaluate(
                                cmd.value, ctx, null,
                                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
                            );
                            return Array.from({ length: snap.snapshotLength },
                                (_, k) => snap.snapshotItem(k));
                        }

                        case 'at':     return Array.isArray(ctx) ? ctx[parseInt(cmd.value, 10) || 0] : ctx;
                        case 'shadow': return ctx.shadowRoot || ctx;
                        case 'frame':  return ctx.contentDocument || ctx.contentWindow?.document || ctx;

                        case 'match': {
                            const found = [...ctx.querySelectorAll('*')]
                                .filter(el => el.textContent.includes(cmd.value));
                            return useAll ? found : found[0];
                        }

                        default: return ctx;
                    }
                } catch { return null; }
            }, context);

            if (context === document && result) Cache.set(cacheKey, result);
            return result;
        },

        elementExists(selector, checkVisible = false) {
            const el = this.getElement(selector, false);
            if (!el) return false;
            if (!checkVisible) return true;
            const { width, height } = el.getBoundingClientRect();
            return width > 0 && height > 0;
        },

        async click(selector, timeout = 30) {
            const el = await Waiters.waitForElement(selector, timeout, true);
            if (!el) return false;
            try {
                el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                await Waiters.sleep(300);
                el.click();
                return true;
            } catch {
                try {
                    const { left, top, width, height } = el.getBoundingClientRect();
                    const opts = {
                        bubbles: true, cancelable: true, view: window,
                        clientX: left + width / 2, clientY: top + height / 2, buttons: 1
                    };
                    for (const e of ['mousedown', 'mouseup', 'click'])
                        el.dispatchEvent(new MouseEvent(e, opts));
                    return true;
                } catch { return false; }
            }
        },

        async getText(selector, timeout = 30, checkVisible = true) {
            const el = await Waiters.waitForElement(selector, timeout, checkVisible);
            if (!el) return null;
            return (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
                ? el.value?.trim() || ''
                : el.innerText?.trim() || el.textContent?.trim() || '';
        },

        redirect(url) {
            if (!url || typeof url !== 'string') return false;
            try {
                const parsed = new URL(url, location.href);
                if (!['http:', 'https:'].includes(parsed.protocol)) return false;
                window.location.assign(parsed.href);
                return true;
            } catch { return false; }
        },

        popupsToRedirects() {
            window.open = url => { if (url) this.redirect(url); return window; };
            console.log('[SLM] window.open → redirects instead of popup');
        },

        _origOpen: window.open,

        blockPopups() {
            // No sobreescribir si ya está bloqueado
            if (window.open === this._fakeOpen) return;
            console.log('[SLM] window.open → blocked (fake window)');
            window.open = this._fakeOpen;
        },

        restorePopups() {
            window.open = this._origOpen;
            console.log('[SLM] window.open → restored');
        },

        _fakeOpen: () => new Proxy(
            {
                closed:   false,
                opener:   null,
                name:     '',
                location: { href: 'about:blank', replace: () => {} },
                close:    () => {},
                focus:    () => {},
                blur:     () => {},
                print:    () => {},
                postMessage: () => {}
            },
            {
                get: (t, p) => (p in t ? t[p] : undefined),
                set: (t, p, v) => { t[p] = v; return true; }
            }
        )
    };

    // =========================================================================
    // 5. STRING UTILS
    // =========================================================================
    const StringUtils = {
        toNumber(str, dec = -1, dS = '.', tS = '') {
            if (typeof str === 'number') return str;
            if (!str) return 0;
            let s = String(str).trim();
            if (tS) s = s.replaceAll(tS, '');
            if (dS && dS !== '.') s = s.replaceAll(dS, '.');
            s = s.replace(/[^0-9.\-]/g, '');
            const n = parseFloat(s);
            if (isNaN(n)) return 0;
            if (dec !== -1) { const f = 10 ** dec; return Math.round(n * f) / f; }
            return n;
        },

        getBetween(str, left, right) {
            if (!str) return '';
            let s = str;
            if (left)  { const i = s.indexOf(left);  if (i === -1) return ''; s = s.slice(i + left.length); }
            if (right) { const i = s.indexOf(right);  if (i !== -1) s = s.slice(0, i); }
            return s.trim();
        },

        decodeBase64(str, times = 1) {
            try { let d = str; for (let i = 0; i < times; i++) d = atob(d); return d; }
            catch { return str; }
        },

        encodeBase64(str, times = 1) {
            try { let e = str; for (let i = 0; i < times; i++) e = btoa(e); return e; }
            catch { return str; }
        },

        rot13: str => str.replace(/[A-Za-z]/g, c =>
            String.fromCharCode((c.charCodeAt(0) % 32 + 13) % 26 + (c < 'a' ? 65 : 97))
        ),

        getUrlParam:    name => new URLSearchParams(location.search).get(name),
        getAllUrlParams: name => new URLSearchParams(location.search).getAll(name),

        extractUrl(str) {
            if (!str) return null;
            try { const d = decodeURIComponent(str); if (/^https?:\/\//.test(d)) return d; } catch {}
            try { const b = atob(str);               if (/^https?:\/\//.test(b)) return b; } catch {}
            return /^https?:\/\//.test(str) ? str : null;
        }
    };

    // =========================================================================
    // 6. CAPTCHA
    // =========================================================================
    const Captcha = (() => {
        const safeGetResponse = obj => {
            try { return !!(obj?.getResponse?.()); } catch { return false; }
        };

        const PRESENT_SELECTORS = [
            '>CSS> .cf-turnstile',
            '>CSS> .g-recaptcha',
            '>CSS> .h-captcha',
            '>CSS> iframe[src*="hcaptcha.com"]',
            '>CSS> iframe[src*="recaptcha"]',
            '>CSS> input[name="cf-turnstile-response"]'
        ];

        // [value!=""] requiere XPath — no es CSS estándar
        const _resolved = () => {
            try {
                return (
                    safeGetResponse(window.hcaptcha)  ||
                    safeGetResponse(window.turnstile)  ||
                    safeGetResponse(window.grecaptcha) ||
                    Browser.elementExists('>XPATH> //input[@name="cf-turnstile-response" and @value!=""]') ||
                    Browser.elementExists('>CSS> .iconcaptcha-modal__body-checkmark')
                );
            } catch { return false; }
        };

        return {
            isPresent() {
                try { return PRESENT_SELECTORS.some(sel => Browser.elementExists(sel)); }
                catch { return false; }
            },

            isResolved: _resolved,

            waitForResolution(callback, checkInterval = 1000, maxAttempts = 120) {
                let attempts = 0;
                const id = setInterval(() => {
                    try {
                        if (_resolved()) { clearInterval(id); callback(); return; }
                        if (++attempts >= maxAttempts) {
                            clearInterval(id);
                            console.warn('[SLM] Captcha: max attempts reached');
                        }
                    } catch (e) { console.error('[SLM] Captcha check error:', e.message); }
                }, checkInterval);
                return id;
            },

            waitForResolutionPromise(timeout = 30, checkInterval = 1000) {
                const safeTimeout = Math.max(timeout, 5);
                return new Promise((resolve, reject) => {
                    let id;
                    const tid = setTimeout(() => {
                        clearInterval(id);
                        reject(new Error(`[SLM] Captcha timeout after ${safeTimeout}s`));
                    }, safeTimeout * 1000);

                    id = setInterval(() => {
                        try {
                            if (_resolved()) { clearInterval(id); clearTimeout(tid); resolve(); }
                        } catch (e)         { clearInterval(id); clearTimeout(tid); reject(e); }
                    }, checkInterval);
                });
            },

            async openHCaptchaWhenVisible(timeout = 15) {
                const iframe = await Waiters.waitForElement(
                    '>CSS> iframe[src*="hcaptcha.com"]', timeout, true);
                if (!iframe) return false;
                try { window.hcaptcha.execute(); return true; }
                catch (e) { console.warn('[SLM] hcaptcha.execute() failed:', e.message); return false; }
            }
        };
    })();

    // =========================================================================
    // 7. DOCUMENT SMART CONTROLLER
    // =========================================================================
    const DocumentSmartController = (() => {
        const ORIG = {
            hasFocus:        Document.prototype.hasFocus,
            activeElement:   Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement'),
            hidden:          Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')?.get,
            visibilityState: Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')?.get,
        };

        const blocked = { focus: false, hidden: false, visibilityState: false, activeElement: false };

        // null      → inactivo, listeners no hacen nada (páginas normales sin impacto)
        // 'visible' | 'invisible' → re-aplica si la página intenta revertirlo
        let _persistMode         = null;
        let _persistentListeners = false;

        const defineProp = (target, prop, descriptor) => {
            try {
                Object.defineProperty(target, prop, { configurable: true, enumerable: true, ...descriptor });
                return true;
            } catch { return false; }
        };

        const warn = prop =>
            console.log(`%c⛔ [SLM] uBO controls "${prop}" — cannot modify`, 'color:#ff6600');

        // ── Detección de uBlock Origin ────────────────────────────────────────
        const UBO = {
            _SIGS: ['setConstant','trapProp','thisScript','normalValue','cloakFunc','logPrefix'],

            _hasSignature(getter) {
                if (!getter) return false;
                const s = getter.toString();
                return this._SIGS.some(sig => s.includes(sig));
            },

            detectActiveElement() {
                if (Array.isArray(window.uBO_scriptletsInjected) &&
                    window.uBO_scriptletsInjected.some(s =>
                        s.includes('activeElement') || s.includes('trusted-set') || s.includes('"tagName"')))
                    return true;

                const desc = Object.getOwnPropertyDescriptor(document, 'activeElement');
                if (desc?.get && this._hasSignature(desc.get)) return true;

                try {
                    const el = document.activeElement;
                    if (el?.tagName && !('ownerDocument' in el && 'nodeType' in el && 'getAttribute' in el))
                        return true;
                } catch {}
                return false;
            },

            detect() {
                blocked.activeElement = this.detectActiveElement();

                const focusDesc = Object.getOwnPropertyDescriptor(document, 'hasFocus');
                blocked.focus = focusDesc?.get
                    ? this._hasSignature(focusDesc.get)
                    : document.hasFocus !== ORIG.hasFocus;

                for (const key of ['hidden', 'visibilityState']) {
                    const desc = Object.getOwnPropertyDescriptor(document, key);
                    blocked[key] = !!(desc?.get && this._hasSignature(desc.get));
                }

                if (Array.isArray(window.uBO_scriptletsInjected)) {
                    for (const s of window.uBO_scriptletsInjected) {
                        if (s.includes('hasFocus'))                                          blocked.focus           = true;
                        if (s.includes('visibilitychange') || s.includes('visibilityState')) blocked.visibilityState = true;
                        if (s.includes('hidden') && !s.includes('visibility'))               blocked.hidden          = true;
                    }
                }
            }
        };

        const triggerVis = () => {
            try { document.dispatchEvent(new Event('visibilitychange')); } catch {}
        };

        // ── Setters ───────────────────────────────────────────────────────────
        const Props = {
            setFocus(mode) {
                if (blocked.focus) return warn('hasFocus'), false;
                const fn = mode === 'true' ? () => true : mode === 'false' ? () => false : ORIG.hasFocus;
                defineProp(document, 'hasFocus', { value: fn, writable: true });
                Document.prototype.hasFocus = fn;
                return true;
            },
            setHidden(value) {
                if (blocked.hidden) return warn('hidden'), false;
                if (value === 'original')
                    return ORIG.hidden ? defineProp(document, 'hidden', { get: ORIG.hidden }) : false;
                return defineProp(document, 'hidden', { get: () => value });
            },
            setVisibilityState(value) {
                if (blocked.visibilityState) return warn('visibilityState'), false;
                if (value === 'original')
                    return ORIG.visibilityState
                        ? defineProp(document, 'visibilityState', { get: ORIG.visibilityState })
                        : false;
                return defineProp(document, 'visibilityState', { get: () => value });
            },
            setActiveElement(tagName) {
                if (blocked.activeElement) return warn('activeElement'), false;
                if (tagName === 'original')
                    return ORIG.activeElement ? defineProp(document, 'activeElement', ORIG.activeElement) : false;

                const tag  = tagName.toUpperCase();
                const fake = {
                    tagName: tag, nodeType: 1, nodeName: tag, localName: tagName.toLowerCase(),
                    namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument: document,
                    parentNode: null, parentElement: null, childNodes: [], children: [],
                    firstChild: null, lastChild: null, previousSibling: null, nextSibling: null,
                    attributes: {}, style: {}, id: '', className: '',
                    classList: { value:'', add:()=>{}, remove:()=>{}, contains:()=>false, toggle:()=>false },
                    innerHTML: '', outerHTML: `<${tagName.toLowerCase()}></${tagName.toLowerCase()}>`,
                    textContent: '', innerText: '', value: '', checked: false,
                    disabled: false, readOnly: false, src: '', href: '', type: '',
                    getAttribute:          () => null, setAttribute:       () => {},
                    removeAttribute:       () => {},   hasAttribute:       () => false,
                    hasAttributes:         () => false,
                    getBoundingClientRect: () => ({ top:0, left:0, bottom:0, right:0, width:0, height:0 }),
                    getClientRects: () => [], matches:      () => false, closest:        () => null,
                    contains:       () => false, querySelector: () => null, querySelectorAll: () => []
                };
                return defineProp(document, 'activeElement', { get: () => fake });
            }
        };

        const _getStatus = () => ({
            ubo: { ...blocked },
            values: {
                focus:           document.hasFocus(),
                hidden:          document.hidden,
                visibilityState: document.visibilityState,
                activeElement:   document.activeElement?.tagName || 'N/A'
            }
        });

        // ── API ───────────────────────────────────────────────────────────────
        const api = {
            status()   { const s = _getStatus(); console.log('📊 [SLM] Document status:', s); return s; },
            getStatus: _getStatus,

            focus: {
                true:     () => Props.setFocus('true'),
                false:    () => Props.setFocus('false'),
                original: () => Props.setFocus('original'),
                toggle:   () => Props.setFocus(document.hasFocus() ? 'false' : 'true')
            },
            hidden: {
                true:     () => { Props.setHidden(true);       triggerVis(); },
                false:    () => { Props.setHidden(false);      triggerVis(); },
                original: () => { Props.setHidden('original'); triggerVis(); }
            },
            state: {
                visible:   () => { Props.setVisibilityState('visible');   triggerVis(); },
                hidden:    () => { Props.setVisibilityState('hidden');     triggerVis(); },
                prerender: () => { Props.setVisibilityState('prerender'); triggerVis(); },
                original:  () => { Props.setVisibilityState('original');  triggerVis(); }
            },
            active: {
                iframe:   () => Props.setActiveElement('IFRAME'),
                div:      () => Props.setActiveElement('DIV'),
                body:     () => Props.setActiveElement('BODY'),
                input:    () => Props.setActiveElement('INPUT'),
                button:   () => Props.setActiveElement('BUTTON'),
                a:        () => Props.setActiveElement('A'),
                span:     () => Props.setActiveElement('SPAN'),
                set:   tag => Props.setActiveElement(tag),
                original: () => Props.setActiveElement('original')
            },

            visible() {
                _persistMode = 'visible';
                if (!blocked.focus)           Props.setFocus('true');
                if (!blocked.hidden)          Props.setHidden(false);
                if (!blocked.visibilityState) Props.setVisibilityState('visible');
                triggerVis();
            },

            invisible() {
                _persistMode = 'invisible';
                if (!blocked.focus)           Props.setFocus('false');
                if (!blocked.hidden)          Props.setHidden(true);
                if (!blocked.visibilityState) Props.setVisibilityState('hidden');
                triggerVis();
            },

            reset() {
                _persistMode = null;
                if (!blocked.focus)           Props.setFocus('original');
                if (!blocked.hidden)          Props.setHidden('original');
                if (!blocked.visibilityState) Props.setVisibilityState('original');
                if (!blocked.activeElement)   Props.setActiveElement('original');
                triggerVis();
            },

            // ─────────────────────────────────────────────────────────────────
            // persist() — registra 3 listeners UNA sola vez.
            // • Solo actúan si _persistMode !== null → sin impacto en páginas
            //   normales donde nadie llama visible()/invisible().
            // • _applying previene recursión infinita:
            //   invisible() → triggerVis() → 'visibilitychange' → listener
            //   → _applying=true → return → sin recursión.
            // • No usa Object.defineProperty → no choca con uBO.
            // ─────────────────────────────────────────────────────────────────
            persist() {
                if (_persistentListeners) return;
                _persistentListeners = true;

                let _applying = false;

                const _reapply = () => {
                    if (_applying || _persistMode === null) return;
                    _applying = true;
                    try {
                        if      (_persistMode === 'invisible') api.invisible();
                        else if (_persistMode === 'visible')   api.visible();
                    } finally {
                        _applying = false;
                    }
                };

                document.addEventListener('visibilitychange', _reapply, true);
                window.addEventListener('focus',              _reapply, true);
                window.addEventListener('blur',               _reapply, true);

                console.log('[SLM] DocumentSmartController: persistent listeners registered');
            }
        };

        UBO.detect();
        return api;
    })();

    // =========================================================================
    // 8. SAFE HELPERS
    // =========================================================================
    function safeProp(propKey, setterFn, label) {
        try {
            if (DocumentSmartController.getStatus().ubo[propKey]) {
                console.log(`ℹ️ [SLM] uBO blocks ${label}`);
                return false;
            }
            setterFn();
            return true;
        } catch (e) {
            console.warn(`⚠️ [SLM] Error in safe${label}: ${e.message}`);
            return false;
        }
    }

    window.safeSetFocus = v =>
        safeProp('focus', () => {
            (DocumentSmartController.focus[v] ?? DocumentSmartController.focus.original)();
        }, 'focus');

    window.safeSetHidden = v =>
        safeProp('hidden', () => {
            (DocumentSmartController.hidden[v] ?? DocumentSmartController.hidden.original)();
        }, 'hidden');

    window.safeSetVisibilityState = v =>
        safeProp('visibilityState', () => {
            (DocumentSmartController.state[v] ?? DocumentSmartController.state.original)();
        }, 'visibilityState');

    window.safeSetActiveElement = tag =>
        safeProp('activeElement', () => DocumentSmartController.active.set(tag), 'activeElement');

    for (const tag of ['Iframe','Div','Body','Input','Button','A','Span'])
        window[`safeActive${tag}`] = () => window.safeSetActiveElement(tag.toUpperCase());
    window.safeActiveOriginal = () => window.safeSetActiveElement('original');

    window.safeVisible       = () => { try { DocumentSmartController.visible();   return true; } catch { return false; } };
    window.safeInvisible     = () => { try { DocumentSmartController.invisible(); return true; } catch { return false; } };
    window.safeResetDocument = () => { try { DocumentSmartController.reset();     return true; } catch { return false; } };
    window.safeStatus        = () => DocumentSmartController.status();
    window.safeDetectUBO     = () => console.log('🔍 uBO:', DocumentSmartController.getStatus().ubo);

    // =========================================================================
    // 9. ROUTER
    // =========================================================================
    const Router = {
        routes: [],

        register(domains, handler, options = {}) {
            (Array.isArray(domains) ? domains : [domains])
                .forEach(d => this.routes.push({ domain: d, handler, options }));
        },

        async run() {
            const { hostname: host, href, pathname } = location;
            if (!/^https?:\/\/.+/.test(href)) return;

            const matches = this.routes.filter(r => {
                const hit = typeof r.domain === 'string'
                    ? host.includes(r.domain)
                    : r.domain.test(href);
                return hit && (!r.options.path || pathname.includes(r.options.path));
            });

            for (const m of matches) {
                console.log(`✅ [SLM] Running: ${m.domain} (${pathname})`);
                try { await m.handler(); }
                catch (e) { console.error(`[SLM] Error in ${m.domain}:`, e); }
            }
        }
    };

    // =========================================================================
    // 10. SITE SCRIPTS
    // =========================================================================
    const SiteScripts = {
        register() {

            Router.register(
                ['barlianta.com','jobpagol.com','cararabic.com','teknoventure.biz.id',
                 'postalcode.com.pk','esladvice.com','progame.biz.id'],
                async () => {
                    await Waiters.waitForAnyVisible('>CSS> .cf-turnstile, #count, #click', 10);

                    if (Browser.elementExists('>CSS> #click', true)) {
                        await Waiters.waitForElement(
                            ">XPATH> //p[@id='click' and contains(., 'Open Any Article')]", 10, true);
                        safeInvisible();
                        safeActiveIframe();
                        await Waiters.waitForElement(
                            ">XPATH> //p[@id='click' and (contains(., 'Read The Article') or contains(., 'Keep The Article'))]",
                            10, true);
                        const articleText  = await Browser.getText('>CSS> #click');
                        const timerArticle = StringUtils.toNumber(StringUtils.getBetween(articleText, 'For ', ' More'));
                        await Waiters.sleep(timerArticle * 1000);
                        await Waiters.waitForElement(">CSS> [class^='btn-']:not([disabled])", 10, true);
                        safeResetDocument();
                        safeActiveOriginal();
                    }

                    if (Browser.elementExists('>CSS> .cf-turnstile')) {
                        await Captcha.waitForResolutionPromise(60);
                        await Waiters.waitForElement(">CSS> [class^='btn-']:not([disabled])", 10, true);
                    }

                    if (Browser.elementExists('>CSS> #count', true)) {
                        await Waiters.waitForElement(
                            ">XPATH> //*[@id='count'][number(text()) = number(text())]", 10, true);
                        const wait = StringUtils.toNumber(await Browser.getText('>CSS> #count'));
                        await Waiters.sleep(wait * 1000);
                        await Waiters.waitForElement(">CSS> [class^='btn-']:not([disabled])", 10, true);
                    }

                    await Browser.click(">CSS> [class^='btn-']:not([disabled])");

                    if (Browser.elementExists(">CSS> [id^='mainBtn']", true)) {
                        await Waiters.waitForElement(
                            ">XPATH> //button[starts-with(@id, 'mainBtn') and contains(., 'Wait')]");
                        const txt   = await Browser.getText(">CSS> [id^='mainBtn']");
                        const timer = StringUtils.toNumber(StringUtils.getBetween(txt, 'Wait', 'Seconds'));
                        await Waiters.sleep(timer * 1000);
                        await Browser.click(">CSS> [id^='mainBtn']:not([disabled])");
                    }
                }
            );

            Router.register(['maqal360.com','diudemy.com'], async () => {
                safeVisible();
                await Waiters.waitForElement(">XPATH> //*[@id='timer']", 10, true);
                const secs = StringUtils.toNumber(await Browser.getText('>CSS> #timer'));
                await Waiters.sleep(secs * 1000);
                await Waiters.waitForElement(">XPATH> //a[@id='skip-btn' and not(@href='#')]", 10);
                await Browser.click(">XPATH> //a[@id='skip-btn' and not(@href='#')]");
            });

            Router.register(['luckywatch.pro'], async () => {
                safeVisible();
                const btn = ">XPATH> //*[@id='__nuxt']/div/main/div[2]/div[2]/div[2]/button[not(@disabled)]";
                await Waiters.waitForElement(btn, 10, true);
                await Browser.click(btn);
                await Waiters.sleep(2000);
                const watchBtn = ">XPATH> //button[contains(@class, 'btn-primary') and .//span[text()=' Watch video']]";
                if (Browser.elementExists(watchBtn)) {
                    await Browser.click(watchBtn);
                    await Waiters.sleep(1000);
                }
            });

            Router.register(['fc-lc.xyz'], async () => {
                await Waiters.waitForElement('>CSS> .box-main, .verify-wrapper', 10, true);

                if (Browser.elementExists('>CSS> .h-captcha')) {
                    console.log('[SLM] fc-lc: hCaptcha detected');
                    await Captcha.waitForResolutionPromise(60);
                    await Waiters.waitForElement('>CSS> #hCaptchaShortlink', 10, true);
                    await Browser.click('>CSS> #hCaptchaShortlink');
                }

                if (Browser.elementExists('>CSS> #turnstile-container')) {
                    console.log('[SLM] fc-lc: Turnstile detected');
                    await Captcha.waitForResolutionPromise(60);
                    await Waiters.waitForElement('>CSS> #submitBtn', 10, true);
                    await Browser.click('>CSS> #submitBtn');
                }
            });

            Router.register(['jobzhub.store'], async () => {
                await Waiters.waitForElement('>CSS> #next, #countdown', 10, true);

                if (Browser.elementExists('>CSS> #countdown', true)) {
                    await Waiters.waitForElement(
                        '>XPATH> //*[@id="timer"][number(text()) = number(text())]', 10, true);
                    const wait = StringUtils.toNumber(
                        await Browser.getText('>XPATH> //*[@id="timer"][number(text()) = number(text())]'));
                    await Waiters.sleep(wait * 1000);
                    await Captcha.waitForResolutionPromise(60);
                    await Waiters.waitForElement('>CSS> #surl', 10, true);
                    await Browser.click('>CSS> #surl');
                }

                await Browser.click('>CSS> #next');
                await Waiters.waitForElement(
                    '>XPATH> //*[@id="next" and contains(text(), "Please Wait")]', 10, true);
                const txt   = await Browser.getText('>XPATH> //*[@id="next" and contains(text(), "Please Wait")]');
                const timer = StringUtils.toNumber(StringUtils.getBetween(txt, 'Wait', 'Seconds'));
                await Waiters.sleep(timer * 1000);
                await Waiters.waitForElement('>CSS> #scroll', 10, true);
                await Browser.click('>CSS> #scroll');
                await Waiters.waitForElement('>CSS> #glink', 10, true);
                await Browser.click('>CSS> #glink');
            });

            Router.register('viefaucet.com', async () => {
                safeInvisible();
                Browser.blockPopups();

                console.log('[SLM] viefaucet: invisible mode + popups blocked');

                SPAManager.onLeave(() => {
                    safeResetDocument();
                    Browser.restorePopups();
                    console.log('[SLM] viefaucet: state restored');
                });

            }, { path: '/ptc/window' });
        }
    };

    // =========================================================================
    // 11. PUBLIC API
    // =========================================================================
    window.SLM = {
        version: '4.6',
        config:  Config.settings,
        waiters: {
            sleep:      ms     => Waiters.sleep(ms),
            element:    (...a) => Waiters.waitForElement(...a),
            anyVisible: (...a) => Waiters.waitForAnyVisible(...a),
            any:        (...a) => Waiters.waitForAny(...a),
            hide:       (...a) => Waiters.waitForHide(...a),
            text:       (...a) => Waiters.waitForText(...a)
        },
        browser: {
            get:               (...a) => Browser.getElement(...a),
            exists:            (...a) => Browser.elementExists(...a),
            click:             (...a) => Browser.click(...a),
            text:              (...a) => Browser.getText(...a),
            redirect:          url   => Browser.redirect(url),
            popupsToRedirects: ()    => Browser.popupsToRedirects(),
            blockPopups:       ()    => Browser.blockPopups(),
            restorePopups:     ()    => Browser.restorePopups()
        },
        string: {
            toNumber:     StringUtils.toNumber.bind(StringUtils),
            between:      StringUtils.getBetween.bind(StringUtils),
            decodeBase64: StringUtils.decodeBase64.bind(StringUtils),
            encodeBase64: StringUtils.encodeBase64.bind(StringUtils),
            rot13:        StringUtils.rot13,
            extractUrl:   StringUtils.extractUrl.bind(StringUtils),
            getParam:     StringUtils.getUrlParam,
            getAllParams:  StringUtils.getAllUrlParams
        },
        captcha: {
            isPresent:    () => Captcha.isPresent(),
            isResolved:   () => Captcha.isResolved(),
            wait:         (cb, interval, max) => Captcha.waitForResolution(cb, interval, max),
            waitPromise:  (timeout, interval) => Captcha.waitForResolutionPromise(timeout, interval),
            openHCaptcha: timeout => Captcha.openHCaptchaWhenVisible(timeout)
        },
        document: DocumentSmartController,
        router: {
            register: (d, h, o) => Router.register(d, h, o),
            run:      ()        => Router.run()
        },
        spa: {
            onLeave: fn => SPAManager.onLeave(fn)
        },
        safe: {
            focus:          safeSetFocus,
            hidden:         safeSetHidden,
            state:          safeSetVisibilityState,
            active:         safeSetActiveElement,
            activeIframe:   safeActiveIframe,
            activeDiv:      safeActiveDiv,
            activeBody:     safeActiveBody,
            activeInput:    safeActiveInput,
            activeButton:   safeActiveButton,
            activeA:        safeActiveA,
            activeSpan:     safeActiveSpan,
            activeOriginal: safeActiveOriginal,
            visible:        safeVisible,
            invisible:      safeInvisible,
            reset:          safeResetDocument,
            status:         safeStatus,
            detectUBO:      safeDetectUBO
        }
    };

    // =========================================================================
    // 12. INIT
    // =========================================================================
    (async () => {
        await Config.detectOptimalSettings();
        SiteScripts.register();

        // persist() — listeners globales sin efecto hasta que alguien llame
        // safeVisible/safeInvisible. No impacta páginas normales.
        DocumentSmartController.persist();

        // SPAManager — intercepta pushState/replaceState/popstate para
        // re-ejecutar el Router y limpiar estado en cada navegación SPA.
        SPAManager.init();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => Router.run(), { once: true });
        } else {
            setTimeout(() => Router.run(), 50);
        }

        const { ubo }    = DocumentSmartController.getStatus();
        const uboBlocked = Object.keys(ubo).filter(k => ubo[k]);
        console.log(
            '%c✅ [SLM] v4.6 ready — window.SLM available',
            'background:#00aa00;color:white;padding:2px 5px;border-radius:3px'
        );
        if (uboBlocked.length)
            console.log(`%c⚠️ uBO blocks ${uboBlocked.length} property(ies): ${uboBlocked.join(', ')}`, 'color:#ffaa00');
    })();
})();
