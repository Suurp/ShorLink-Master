// ==UserScript==
// @name         ShortLink Master (SLM)
// @version      4.4
// @description  Framework profesional para bypass de shortlinks + Control total de document
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    if (window.self !== window.top) return;

    // =========================================================================
    // 0. CONFIGURACIÓN
    // =========================================================================
    const Config = {
        settings: { waitInterval: 250, fastMode: false, debug: false, cacheEnabled: true },

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
    const Cache = {
        _map: new Map(),
        TTL: { selector: 300_000, xpath: 120_000 },

        _isLive(value) {
            if (value instanceof Node) return value.isConnected;
            if (Array.isArray(value)) return value.length > 0 && value[0] instanceof Node
                ? value.every(n => n.isConnected)
                : true;
            return true;
        },

        get(key, ttl) {
            if (!Config.settings.cacheEnabled) return null;
            const entry = this._map.get(key);
            if (!entry || Date.now() - entry.ts >= ttl) return null;
            if (!this._isLive(entry.v)) { this._map.delete(key); return null; }
            return entry.v;
        },

        set(key, value) {
            if (Config.settings.cacheEnabled)
                this._map.set(key, { v: value, ts: Date.now() });
        },

        cleanup() {
            const now = Date.now();
            for (const [k, e] of this._map)
                if (now - e.ts > this.TTL.selector || !this._isLive(e.v))
                    this._map.delete(k);
        },

        clear() { this._map.clear(); }
    };

    setInterval(() => Cache.cleanup(), 300_000);

    let _lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== _lastUrl) { _lastUrl = location.href; Cache.clear(); }
    }).observe(document, { subtree: true, childList: true });

    // =========================================================================
    // 2. WAITERS
    // =========================================================================
    const Waiters = {
        sleep: ms => new Promise(r => setTimeout(r, ms)),

        async waitForElement(selector, timeout = 30, checkVisible = false) {
            const deadline  = Date.now() + timeout * 1000;
            const isComplex = selector.includes('XPATH') || selector.includes('contains') || selector.includes('text()');
            let interval = isComplex ? 200 : Config.settings.waitInterval;
            let attempts = 0;

            while (Date.now() < deadline) {
                const el = Browser.getElement(selector, false);
                if (el) {
                    if (!checkVisible) return el;
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) return el;
                }
                if (++attempts > 5) interval = Math.min(interval * 1.3, 500);
                await this.sleep(interval);
            }
            return null;
        },

        // Espera a que cualquiera de los selectores sea visible
        async waitForAnyVisible(selectorList, timeout = 30) {
            const selectors = selectorList.split(',').map(s => s.trim());
            const deadline  = Date.now() + timeout * 1000;
            let interval = 100, attempts = 0;

            while (Date.now() < deadline) {
                for (const sel of selectors) {
                    const el = Browser.getElement(sel, false);
                    if (el) {
                        const r = el.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) return el;
                    }
                }
                if (++attempts > 5) interval = Math.min(interval * 1.3, 400);
                await this.sleep(interval);
            }
            return null;
        },

        async waitForAny(selectorList, timeout = 30) {
            const selectors = selectorList.split(',').map(s => s.trim());
            const deadline  = Date.now() + timeout * 1000;
            let interval = 100, attempts = 0;

            while (Date.now() < deadline) {
                for (const sel of selectors) {
                    const el = Browser.getElement(sel, false);
                    if (el) return el;
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
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return true;
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
    // 3. BROWSER
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

                        case 'at':
                            return Array.isArray(ctx) ? ctx[parseInt(cmd.value, 10) || 0] : ctx;

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
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
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
                    ['mousedown', 'mouseup', 'click'].forEach(e =>
                        el.dispatchEvent(new MouseEvent(e, opts)));
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

        // Redirigir a una URL de forma centralizada y segura
        redirect(url) {
            if (!url || typeof url !== 'string') {
                console.warn('[SLM] redirect: URL inválida:', url);
                return false;
            }
            try {
                const parsed = new URL(url, location.href);
                if (!['http:', 'https:'].includes(parsed.protocol)) {
                    console.warn('[SLM] redirect: protocolo no permitido:', parsed.protocol);
                    return false;
                }
                window.location.assign(parsed.href);
                return true;
            } catch {
                console.warn('[SLM] redirect: URL malformada:', url);
                return false;
            }
        },

        popupsToRedirects() {
            window.open = (url) => {
                if (url) this.redirect(url);
                return window;
            };
            console.log('[SLM] window.open → redirige en lugar de abrir popup');
        }
    };

    // =========================================================================
    // 4. STRING UTILS
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
            try {
                const decoded = decodeURIComponent(str);
                if (/^https?:\/\//.test(decoded)) return decoded;
            } catch {}
            try {
                const b64 = atob(str);
                if (/^https?:\/\//.test(b64)) return b64;
            } catch {}
            if (/^https?:\/\//.test(str)) return str;
            return null;
        }
    };

    // =========================================================================
    // 5. CAPTCHA
    // =========================================================================
    const Captcha = (() => {
        const safeGetResponse = captchaObj => {
            try { return !!(captchaObj?.getResponse?.()); }
            catch { return false; }
        };

        const PRESENT_SELECTORS = [
            '>CSS> .cf-turnstile',
            '>CSS> .g-recaptcha',
            '>CSS> .h-captcha',
            '>CSS> iframe[src*="hcaptcha.com"]',
            '>CSS> iframe[src*="recaptcha"]',
            '>CSS> input[name="cf-turnstile-response"]'
        ];

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
                            console.warn('[SLM] Captcha: máximo de intentos alcanzado');
                        }
                    } catch (e) {
                        console.error('[SLM] Captcha check error:', e.message);
                    }
                }, checkInterval);
                return id;
            },

            waitForResolutionPromise(timeout = 30, checkInterval = 1000) {
                const safeTimeout = Math.max(timeout, 5);
                return new Promise((resolve, reject) => {
                    let id;
                    const tid = setTimeout(() => {
                        clearInterval(id);
                        reject(new Error(`[SLM] Captcha timeout después de ${safeTimeout}s`));
                    }, safeTimeout * 1000);

                    id = setInterval(() => {
                        try {
                            if (_resolved()) {
                                clearInterval(id); clearTimeout(tid); resolve();
                            }
                        } catch (e) {
                            clearInterval(id); clearTimeout(tid); reject(e);
                        }
                    }, checkInterval);
                });
            },

            async openHCaptchaWhenVisible(timeout = 15) {
                const iframe = await Waiters.waitForElement(
                    '>CSS> iframe[src*="hcaptcha.com"]', timeout, true
                );
                if (!iframe) return false;
                try { window.hcaptcha.execute(); return true; }
                catch (e) { console.warn('[SLM] hcaptcha.execute() falló:', e.message); return false; }
            }
        };
    })();

    // =========================================================================
    // 6. DOCUMENT SMART CONTROLLER
    // =========================================================================
    const DocumentSmartController = (() => {
        const ORIG = {
            hasFocus:        Document.prototype.hasFocus,
            activeElement:   Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement'),
            hidden:          Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')?.get,
            visibilityState: Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')?.get,
        };

        const blocked = { focus: false, hidden: false, visibilityState: false, activeElement: false };

        function defineProp(target, prop, descriptor) {
            try {
                Object.defineProperty(target, prop, { configurable: true, enumerable: true, ...descriptor });
                return true;
            } catch { return false; }
        }

        function warn(prop) {
            console.log(`%c⛔ [SLM] uBO controla "${prop}" — no modificable`, 'color:#ff6600');
        }

        const UBO = {
            _hasSignature(getter) {
                if (!getter) return false;
                const s = getter.toString();
                return ['setConstant','trapProp','thisScript','normalValue','cloakFunc','logPrefix']
                    .some(sig => s.includes(sig));
            },

            detectActiveElement() {
                if (Array.isArray(window.uBO_scriptletsInjected))
                    if (window.uBO_scriptletsInjected.some(s =>
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
                    window.uBO_scriptletsInjected.forEach(s => {
                        if (s.includes('hasFocus'))                                         blocked.focus           = true;
                        if (s.includes('visibilitychange') || s.includes('visibilityState')) blocked.visibilityState = true;
                        if (s.includes('hidden') && !s.includes('visibility'))              blocked.hidden          = true;
                    });
                }
            }
        };

        const triggerVis = () => {
            try { document.dispatchEvent(new Event('visibilitychange')); } catch {}
        };

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
                    return ORIG.activeElement
                        ? defineProp(document, 'activeElement', ORIG.activeElement)
                        : false;

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
                    removeAttribute:       () => {}, hasAttribute:         () => false,
                    hasAttributes:         () => false,
                    getBoundingClientRect: () => ({ top:0, left:0, bottom:0, right:0, width:0, height:0 }),
                    getClientRects:        () => [], matches:              () => false,
                    closest:               () => null, contains:           () => false,
                    querySelector:         () => null, querySelectorAll:   () => []
                };
                return defineProp(document, 'activeElement', { get: () => fake });
            }
        };

        function _getStatus() {
            return {
                ubo: { ...blocked },
                values: {
                    focus:           document.hasFocus(),
                    hidden:          document.hidden,
                    visibilityState: document.visibilityState,
                    activeElement:   document.activeElement?.tagName || 'N/A'
                }
            };
        }

        const api = {
            status() {
                const s = _getStatus();
                console.log('📊 [SLM] Document status:', s);
                return s;
            },
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
                if (!blocked.focus)           Props.setFocus('true');
                if (!blocked.hidden)          Props.setHidden(false);
                if (!blocked.visibilityState) Props.setVisibilityState('visible');
                triggerVis();
            },
            invisible() {
                if (!blocked.focus)           Props.setFocus('false');
                if (!blocked.hidden)          Props.setHidden(true);
                if (!blocked.visibilityState) Props.setVisibilityState('hidden');
                triggerVis();
            },
            reset() {
                if (!blocked.focus)           Props.setFocus('original');
                if (!blocked.hidden)          Props.setHidden('original');
                if (!blocked.visibilityState) Props.setVisibilityState('original');
                if (!blocked.activeElement)   Props.setActiveElement('original');
                triggerVis();
            }
        };

        UBO.detect();
        return api;
    })();

    // =========================================================================
    // 7. SAFE HELPERS
    // =========================================================================
    function safeProp(propKey, setterFn, label) {
        try {
            const st = DocumentSmartController.getStatus();
            if (st.ubo[propKey]) { console.log(`ℹ️ [SLM] uBO bloquea ${label}`); return false; }
            setterFn();
            return true;
        } catch (e) {
            console.warn(`⚠️ [SLM] Error en safe${label}: ${e.message}`);
            return false;
        }
    }

    window.safeSetFocus = v =>
        safeProp('focus', () => {
            const fn = DocumentSmartController.focus[v];
            if (fn) fn(); else DocumentSmartController.focus.original();
        }, 'focus');

    window.safeSetHidden = v =>
        safeProp('hidden', () => {
            const fn = DocumentSmartController.hidden[v];
            if (fn) fn(); else DocumentSmartController.hidden.original();
        }, 'hidden');

    window.safeSetVisibilityState = v =>
        safeProp('visibilityState', () => {
            const fn = DocumentSmartController.state[v];
            if (fn) fn(); else DocumentSmartController.state.original();
        }, 'visibilityState');

    window.safeSetActiveElement = tag =>
        safeProp('activeElement', () => DocumentSmartController.active.set(tag), 'activeElement');

    const _activeTags = ['Iframe','Div','Body','Input','Button','A','Span'];
    _activeTags.forEach(tag => {
        window[`safeActive${tag}`] = () => window.safeSetActiveElement(tag.toUpperCase());
    });
    window.safeActiveOriginal = () => window.safeSetActiveElement('original');

    window.safeVisible       = () => { try { DocumentSmartController.visible();   return true; } catch { return false; } };
    window.safeInvisible     = () => { try { DocumentSmartController.invisible(); return true; } catch { return false; } };
    window.safeResetDocument = () => { try { DocumentSmartController.reset();     return true; } catch { return false; } };
    window.safeStatus        = () => DocumentSmartController.status();
    window.safeDetectUBO     = () => console.log('🔍 uBO:', DocumentSmartController.getStatus().ubo);

    // =========================================================================
    // 8. ROUTER
    // =========================================================================
    const Router = {
        routes: [],

        register(domains, handler, options = {}) {
            (Array.isArray(domains) ? domains : [domains])
                .forEach(d => this.routes.push({ domain: d, handler, options }));
        },

        async run() {
            const host = location.hostname;
            const href = location.href;

            if (!/^https?:\/\/.+/.test(href)) return;

            const matches = this.routes.filter(r => {
                const domainMatch = typeof r.domain === 'string'
                    ? host.includes(r.domain)
                    : r.domain.test(href);
                if (!domainMatch) return false;
                if (r.options.path && !location.pathname.includes(r.options.path)) return false;
                return true;
            });

            if (!matches.length) return;

            for (const match of matches) {
                console.log(`✅ [SLM] Ejecutando: ${match.domain}`);
                try { await match.handler(); }
                catch (e) { console.error(`[SLM] Error en ${match.domain}:`, e); }
            }
        }
    };

    // =========================================================================
    // 9. SITE SCRIPTS
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
                    console.log('[SLM] fc-lc: hCaptcha detectado');
                    await Captcha.waitForResolutionPromise(60);
                    await Waiters.waitForElement('>CSS> #hCaptchaShortlink', 10, true);
                    await Browser.click('>CSS> #hCaptchaShortlink');
                }

                if (Browser.elementExists('>CSS> #turnstile-container')) {
                    console.log('[SLM] fc-lc: Turnstile detectado');
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
        }
    };

    // =========================================================================
    // 10. API PÚBLICA
    // =========================================================================
    window.SLM = {
        version: '4.4',
        config:  Config.settings,
        waiters: {
            sleep:      Waiters.sleep.bind(Waiters),
            element:    Waiters.waitForElement.bind(Waiters),
            anyVisible: Waiters.waitForAnyVisible.bind(Waiters),
            any:        Waiters.waitForAny.bind(Waiters),
            hide:       Waiters.waitForHide.bind(Waiters),
            text:       Waiters.waitForText.bind(Waiters)
        },
        browser: {
            get:              Browser.getElement.bind(Browser),
            exists:           Browser.elementExists.bind(Browser),
            click:            Browser.click.bind(Browser),
            text:             Browser.getText.bind(Browser),
            redirect:         (url) => Browser.redirect(url),
            popupsToRedirects:() => Browser.popupsToRedirects()
        },
        string: {
            toNumber:     StringUtils.toNumber,
            between:      StringUtils.getBetween,
            decodeBase64: StringUtils.decodeBase64,
            encodeBase64: StringUtils.encodeBase64,
            rot13:        StringUtils.rot13,
            extractUrl:   StringUtils.extractUrl,
            getParam:     StringUtils.getUrlParam,
            getAllParams:  StringUtils.getAllUrlParams
        },
        captcha: {
            isPresent:    () => Captcha.isPresent(),
            isResolved:   () => Captcha.isResolved(),
            wait:         (cb, interval, max) => Captcha.waitForResolution(cb, interval, max),
            waitPromise:  (timeout, interval) => Captcha.waitForResolutionPromise(timeout, interval),
            openHCaptcha: (timeout) => Captcha.openHCaptchaWhenVisible(timeout)
        },
        document: DocumentSmartController,
        router: {
            register: Router.register.bind(Router),
            run:      Router.run.bind(Router)
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
    // 11. INICIO
    // =========================================================================
    (async () => {
        await Config.detectOptimalSettings();
        SiteScripts.register();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => Router.run(), { once: true });
        } else {
            setTimeout(() => Router.run(), 50);
        }

        const { ubo } = DocumentSmartController.getStatus();
        const uboCount  = Object.values(ubo).filter(Boolean).length;
        const uboBlocked = Object.keys(ubo).filter(k => ubo[k]);
        console.log(
            '%c✅ [SLM] v4.4 listo — window.SLM disponible',
            'background:#00aa00;color:white;padding:2px 5px;border-radius:3px'
        );
        if (uboCount > 0)
            console.log(`%c⚠️ uBO bloquea ${uboCount} propiedad(es): ${uboBlocked.join(', ')}`, 'color:#ffaa00');
    })();
})();
