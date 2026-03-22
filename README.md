# ShortLink Master (SLM)

> A professional userscript framework for bypassing shortlinks with full browser document control.

[![Version](https://img.shields.io/badge/version-4.8-blue.svg)](https://github.com/Suurp/ShorLink-Master)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/Suurp/ShorLink-Master/blob/main/LICENSE)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-compatible-orange.svg)](https://www.tampermonkey.net/)
[![Violentmonkey](https://img.shields.io/badge/Violentmonkey-compatible-purple.svg)](https://violentmonkey.github.io/)

---

## Table of Contents

- [What is SLM?](#what-is-slm)
- [Inspiration & Credits](#inspiration--credits)
- [Installation](#installation)
- [Recommended Setup — uBlock Origin](#recommended-setup--ublock-origin)
- [Architecture](#architecture)
- [API Reference](#api-reference)
  - [SLM.waiters](#slmwaiters)
  - [SLM.browser](#slmbrowser)
  - [SLM.string](#slmstring)
  - [SLM.captcha](#slmcaptcha)
  - [SLM.document](#slmdocument)
  - [SLM.safe](#slmsafe)
  - [SLM.router](#slmrouter)
  - [SLM.uboOverride](#slmubooverride)
  - [SLM.spa](#slmspa)
- [Adding a New Site](#adding-a-new-site)
- [Usage Examples](#usage-examples)
- [Selector System](#selector-system)
- [Supported Sites](#supported-sites)
- [Changelog](#changelog)

---

## What is SLM?

SLM is a Tampermonkey/Violentmonkey userscript that provides a modular framework for automating shortlink bypasses. It includes:

- **Router** — multi-site routing with support for strings, RegExp and path-specific handlers
- **SPAManager** — detects SPA navigations (pushState, replaceState, popstate) and re-runs the Router automatically, executing registered cleanup functions on path change
- **UBOOverride** — instead of yielding to uBlock Origin scriptlets, actively attempts to override them using a 4-technique cascade (instance redefine, prototype redefine, delete+redefine, prototype Proxy). Reports the real outcome per property: `overridden`, `impossible` (JS spec limit), or `proxied`
- **Waiters** — async waiting with timeout, adaptive backoff and text/condition support
- **Browser** — smart DOM cache that automatically invalidates disconnected nodes, plus `blockPopups` / `restorePopups` for `window.open` control
- **Document Smart Controller** — manipulate `hasFocus`, `hidden`, `visibilityState` and `activeElement` with automatic uBlock Origin interference detection
- **Captcha** — unified detection and resolution waiting for hCaptcha, reCAPTCHA, Cloudflare Turnstile and IconCaptcha
- **String Utils** — base64, ROT13 and obfuscated URL extraction helpers

---

## Inspiration & Credits

SLM didn't emerge from nothing. These projects directly influenced its design:

### 🤖 [Browser Automation Studio](https://bablosoft.com/shop/BrowserAutomationStudio) — Bablosoft

SLM's chainable selector system (`>CSS>`, `>XPATH>`, `>FRAME>`, `>SHADOW>`, `>AT>`) is **directly inspired** by the element selection engine of Browser Automation Studio (BAS). BAS introduced the idea of composing selectors with type prefixes to navigate complex DOM structures — including iframes, Shadow DOM and index-based selection — declaratively, without writing imperative traversal code. If you work with browser automation at a professional level, BAS is well worth exploring.

---

### 📜 [Bypass All Shortlinks — Bloggerpermula](https://greasyfork.org/en/scripts/431691-bypass-all-shortlinks) — Greasy Fork

The original userscript by **Bloggerpermula** on Greasy Fork was one of the first to demonstrate that dozens of shortlinks could be bypassed from a single unified script. The principle of covering multiple domains in one file is the same core idea behind SLM's Router — though SLM rewrites it with async/await, structured error handling, and without the unbounded `setInterval` loops present in the original.

---

### 🔧 [Bypass All Shortlinks Debloated — Amm0ni4](https://codeberg.org/Amm0ni4/bypass-all-shortlinks-debloated) — Codeberg

The **debloated** fork by **Amm0ni4** on Codeberg demonstrated the value of cleaning up, modularizing, and keeping the supported site list actively maintained. Their work is a direct reference for how to organize site scripts and which captcha and timer patterns appear most frequently in the wild. Several ideas around Cloudflare Turnstile and hCaptcha detection in SLM originated from studying the handlers in this fork.

---

## Installation

### Option 1 — Install directly (recommended)

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
2. Click the install button:

[![Install](https://img.shields.io/badge/Install-userscript-blue?style=for-the-badge)](https://raw.githubusercontent.com/Suurp/ShorLink-Master/main/slm.user.js)

### Option 2 — Manual installation

1. Open the Tampermonkey dashboard → **Create new script**
2. Copy the contents of [`slm.user.js`](slm.user.js)
3. Save with `Ctrl+S`

---

## Recommended Setup — uBlock Origin

SLM works on its own, but it works **significantly better** alongside [uBlock Origin](https://ublockorigin.com/). Many shortlink sites rely on aggressive ad networks, tracking scripts, popups and redirect chains that slow down or interfere with the bypass process. uBlock Origin blocks these at the network level before they even load, which means:

- **Fewer redirects to handle** — unwanted popups and interstitial ads are killed before SLM ever sees them
- **Captchas appear cleaner** — ad scripts that inject fake captcha overlays or hijack focus are blocked
- **Timers run uninterrupted** — background scripts that steal `document.focus` or modify `visibilityState` are neutralized before SLM's Document Smart Controller even needs to act
- **Less noise in the DOM** — fewer injected elements means selectors resolve faster and cache hits are more reliable

### Recommended filter list

For the best experience with shortlink bypassing, add the custom filter list from this repository:

> 🔗 **[github.com/Suurp/uBlock-CustomFilters](https://github.com/Suurp/uBlock-CustomFilters)**

These filters are specifically tuned for shortlink sites and complement SLM directly — blocking the ad layers, fake countdown overlays and forced-focus scripts that SLM would otherwise have to work around at runtime.

**How to add the filter list in uBlock Origin:**

1. Open the uBlock Origin dashboard → **Filter lists** tab
2. Scroll to the bottom → **Import** (under "Custom")
3. Paste the raw URL of the filter list from the repository above
4. Click **Apply changes**

---

## Architecture

```
SLM v4.8
├── Config          — Automatic performance detection and interval tuning
├── Cache           — Selector/XPath cache with TTL and live node validation
├── UBOOverride     — Active uBO override engine: 4-technique cascade, result tracking per property
├── SPAManager      — SPA navigation detection (pushState/replaceState/popstate) + cleanup registry
├── Waiters         — Async waiting (element, visibility, text, hide)
├── Browser         — DOM interaction (get, exists, click, getText, redirect, blockPopups)
├── StringUtils     — Text utilities (numbers, base64, ROT13, URL extraction)
├── Captcha         — Unified hCaptcha/reCAPTCHA/Turnstile detection and waiting
├── DocumentSmartController — focus/hidden/visibilityState/activeElement control
├── SafeHelpers     — Safe wrappers for window.safe* with override-aware status
├── Router          — Handler registration and execution by domain/RegExp/path
└── SiteScripts     — Per-site scripts (registered into Router)
```

---

## API Reference

All modules are accessible from the browser console via `window.SLM`.

---

### SLM.waiters

Async waiting functions. All return `null` if the timeout expires.

#### `SLM.waiters.sleep(ms)`

Pauses execution for a given number of milliseconds.

```javascript
await SLM.waiters.sleep(2000); // wait 2 seconds
```

---

#### `SLM.waiters.element(selector, timeout?, checkVisible?)`

Waits until an element exists (or is visible). Returns the element or `null`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `selector` | `string` | — | CSS selector, XPath or chained selector |
| `timeout` | `number` | `30` | Maximum wait time in seconds |
| `checkVisible` | `boolean` | `false` | If `true`, also verifies the element is visible |

```javascript
// Wait until element exists
const btn = await SLM.waiters.element('#submit-btn');

// Wait until visible
const btn = await SLM.waiters.element('#submit-btn', 15, true);

// With XPath
const el = await SLM.waiters.element(">XPATH> //button[contains(., 'Continue')]", 20, true);
```

---

#### `SLM.waiters.anyVisible(selectorList, timeout?)`

Waits until **any** of the comma-separated selectors becomes visible. Useful when a page can show different elements depending on its state.

```javascript
// Waits for a captcha, counter, or button — whichever appears first
const el = await SLM.waiters.anyVisible('.cf-turnstile, #count, #start-btn', 10);
```

---

#### `SLM.waiters.any(selectorList, timeout?)`

Same as `anyVisible` but only requires DOM existence, not visibility.

```javascript
const el = await SLM.waiters.any('#btn-go, #btn-continue', 15);
```

---

#### `SLM.waiters.hide(selector, timeout?)`

Waits until an element **disappears** from the DOM or becomes hidden. Returns `true` when gone, `false` if the timeout expires.

```javascript
const hidden = await SLM.waiters.hide('#loading-overlay', 10);
if (hidden) console.log('Overlay is gone');
```

---

#### `SLM.waiters.text(selector, condition, timeout?)`

Waits until an element's text satisfies a condition. `condition` can be a string (includes check), a function, or a RegExp.

```javascript
// Wait for text to contain "Ready"
const text = await SLM.waiters.text('#status', 'Ready', 15);

// With a function
const text = await SLM.waiters.text('#timer', t => parseInt(t) <= 0, 30);

// With RegExp
const text = await SLM.waiters.text('#msg', /completed|done/i, 20);
```

---

### SLM.browser

DOM interaction utilities.

#### `SLM.browser.exists(selector, checkVisible?)`

Checks whether an element exists (or is visible). Returns `boolean`.

```javascript
if (SLM.browser.exists('.cf-turnstile')) {
    console.log('A Turnstile captcha is present');
}

if (SLM.browser.exists('#btn', true)) {
    console.log('Button exists and is visible');
}
```

---

#### `SLM.browser.click(selector, timeout?)`

Waits for the element to be visible and clicks it. Tries `el.click()` first; if that fails, dispatches `mousedown → mouseup → click` events manually. Returns `boolean`.

```javascript
const clicked = await SLM.browser.click('#continue-btn');
if (!clicked) console.warn('Could not click the button');
```

---

#### `SLM.browser.text(selector, timeout?, checkVisible?)`

Gets the text content of an element, or `value` if it is an input/textarea.

```javascript
const timerText = await SLM.browser.text('#countdown');
const seconds   = SLM.string.toNumber(timerText);
```

---

#### `SLM.browser.redirect(url)`

Redirects to a URL after validating the protocol (`http` / `https` only). Safer than assigning `location.href` directly.

```javascript
SLM.browser.redirect('https://example.com/destination');
```

---

#### `SLM.browser.popupsToRedirects()`

Intercepts `window.open()` so that instead of opening a popup it redirects in the same tab.

```javascript
SLM.browser.popupsToRedirects();
// From now on, window.open('url') redirects instead of opening a popup
```

---

#### `SLM.browser.blockPopups()`

Replaces `window.open()` with a **fake window** that silently does nothing. Unlike `popupsToRedirects()`, this does not cause any navigation — the popup is simply swallowed. The fake window implements the minimum interface that sites typically inspect (`closed`, `opener`, `close`, `focus`, `location`, `postMessage`) so that no errors are thrown when the site tries to interact with the returned object.

The original `window.open` is saved once at script load time, so calling `blockPopups()` multiple times is safe and idempotent.

```javascript
SLM.browser.blockPopups();
// window.open() now returns a fake window and opens nothing
```

---

#### `SLM.browser.restorePopups()`

Restores `window.open()` to the original browser implementation captured at script load time.

```javascript
SLM.browser.restorePopups();
// window.open() behaves normally again
```

Typical usage with `SPAManager.onLeave()` to auto-restore when leaving a path:

```javascript
Router.register('example.com', async () => {
    SLM.browser.blockPopups();

    SLM.spa.onLeave(() => {
        SLM.browser.restorePopups(); // runs automatically on SPA navigation
    });
}, { path: '/ptc' });
```

---

### SLM.string

Text and URL utilities.

#### `SLM.string.toNumber(str, decimals?, decimalSep?, thousandsSep?)`

Converts variable-format text to a number.

```javascript
SLM.string.toNumber('15 seconds')             // → 15
SLM.string.toNumber('1.500,75', 2, ',', '.')  // → 1500.75
SLM.string.toNumber('Wait 30 Sec')            // → 30
```

---

#### `SLM.string.between(str, left, right)`

Extracts the text between two delimiters.

```javascript
SLM.string.between('Wait 30 Seconds', 'Wait ', ' Seconds') // → "30"
SLM.string.between('For 5 More seconds', 'For ', ' More')  // → "5"
```

---

#### `SLM.string.decodeBase64(str, times?)`

Decodes base64, optionally multiple times.

```javascript
SLM.string.decodeBase64('aHR0cHM6Ly9leGFtcGxlLmNvbQ==') // → "https://example.com"
SLM.string.decodeBase64('dGVzdA==', 1)                   // → "test"
```

---

#### `SLM.string.rot13(str)`

Applies ROT13 encoding. Some shortlinks obfuscate their destination URLs using this cipher.

```javascript
SLM.string.rot13('uggcf://rkcbfr.ph') // → "https://expose.cu"
```

---

#### `SLM.string.extractUrl(str)`

Extracts a URL from a string that may be encoded with `encodeURIComponent` or base64.

```javascript
SLM.string.extractUrl('aHR0cHM6Ly9leGFtcGxlLmNvbQ==') // → "https://example.com"
SLM.string.extractUrl('https%3A%2F%2Fexample.com')     // → "https://example.com"
SLM.string.extractUrl('https://example.com')           // → "https://example.com"
```

---

#### `SLM.string.getParam(name)` / `SLM.string.getAllParams(name)`

Gets parameters from the current page URL.

```javascript
// URL: https://site.com/go?url=https%3A%2F%2Fdestination.com&ref=123
SLM.string.getParam('url')      // → "https://destination.com"
SLM.string.getAllParams('tag')  // → ["a", "b"] if ?tag=a&tag=b
```

---

### SLM.captcha

Captcha detection and resolution waiting.

**Supported captchas:**
- Cloudflare Turnstile (`.cf-turnstile`)
- hCaptcha (`.h-captcha`)
- Google reCAPTCHA (`.g-recaptcha`)
- IconCaptcha (`.iconcaptcha-modal__body-checkmark`)

---

#### `SLM.captcha.isPresent()`

Returns `true` if any supported captcha is present on the page.

```javascript
if (SLM.captcha.isPresent()) {
    console.log('A captcha needs to be solved');
}
```

---

#### `SLM.captcha.isResolved()`

Returns `true` if the captcha has already been solved.

```javascript
if (SLM.captcha.isResolved()) {
    await SLM.browser.click('#submit');
}
```

---

#### `SLM.captcha.waitPromise(timeout?, checkInterval?)`

Waits (as a Promise) for the captcha to be solved. Rejects if the timeout expires.

> ⚠️ The effective minimum timeout is 5 seconds (guard against accidental `timeout=0`).

```javascript
try {
    await SLM.captcha.waitPromise(60); // wait up to 60 seconds
    await SLM.browser.click('#continue');
} catch (e) {
    console.error('User did not solve the captcha in time');
}
```

---

#### `SLM.captcha.openHCaptcha(timeout?)`

Calls `hcaptcha.execute()` once the invisible hCaptcha iframe becomes visible. Useful for invisible hCaptcha that does not trigger on its own.

```javascript
await SLM.captcha.openHCaptcha(15);
await SLM.captcha.waitPromise(60);
```

---

### SLM.document

Control over browser document properties. In v4.8 this no longer just detects uBO and yields — it actively attempts to override uBO scriptlets using `UBOOverride`. The result per property (`overridden`, `impossible`, `proxied`) is available via `status()`.

#### `SLM.document.status()` / `SLM.document.getStatus()`

`status()` prints to console and returns the full state including override results. `getStatus()` returns silently (for internal use).

```javascript
const st = SLM.document.status();
// {
//   overrideStatus: {
//     focus: false,           // false = free or successfully overridden
//     hidden: false,
//     visibilityState: false,
//     activeElement: 'impossible'  // JS spec limit — non-configurable
//   },
//   values: { focus: true, hidden: false, visibilityState: "visible", activeElement: "BODY" },
//   overrideResults: { 'doc.hidden': 'overridden', 'doc.hasFocus': 'overridden', ... }
// }
```

---

#### `SLM.document.visible()` / `SLM.document.invisible()`

Quick mode: applies all visibility-related properties at once.

```javascript
// Simulate the page being focused and visible
SLM.document.visible();

// Simulate the page being in the background
SLM.document.invisible();

// Restore all original browser values
SLM.document.reset();
```

---

#### Granular control

```javascript
// hasFocus
SLM.document.focus.true();     // document.hasFocus() → true
SLM.document.focus.false();    // document.hasFocus() → false
SLM.document.focus.toggle();   // toggles the current value
SLM.document.focus.original(); // restore real browser value

// document.hidden
SLM.document.hidden.true();
SLM.document.hidden.false();
SLM.document.hidden.original();

// visibilityState
SLM.document.state.visible();
SLM.document.state.hidden();
SLM.document.state.prerender();
SLM.document.state.original();

// activeElement (simulate a focused element)
SLM.document.active.iframe();      // activeElement.tagName → "IFRAME"
SLM.document.active.div();
SLM.document.active.input();
SLM.document.active.set('VIDEO'); // any tag name
SLM.document.active.original();
```

---

### SLM.safe

uBO-aware wrappers for all document controls. In v4.8 these wrappers attempt to **actively override** uBO scriptlets via `UBOOverride`. They only return `false` when a property is truly `non-configurable` (a JS spec limit that no script can bypass). All are also available as global functions (`window.safeVisible()`, etc.).

```javascript
SLM.safe.visible();               // invisible mode: tries to override uBO if needed
SLM.safe.invisible();
SLM.safe.reset();
SLM.safe.focus('true');           // 'true' | 'false' | 'original'
SLM.safe.hidden('false');
SLM.safe.state('visible');        // 'visible' | 'hidden' | 'prerender' | 'original'
SLM.safe.active('IFRAME');        // any tagName string
SLM.safe.activeIframe();          // tag shortcuts
SLM.safe.activeDiv();
SLM.safe.activeBody();
SLM.safe.activeInput();
SLM.safe.activeButton();
SLM.safe.status();                // prints full status including override results
SLM.safe.detectUBO();             // prints UBOOverride.results per property
```

---

### SLM.router

Register and execute handlers by domain, RegExp, or path.

#### `SLM.router.register(domains, handler, options?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `domains` | `string \| string[] \| RegExp` | Domain(s) or regular expression to match |
| `handler` | `async function` | Function executed when the URL matches |
| `options.path` | `string` | (optional) Pathname that must be present within the domain |

```javascript
// Single domain
SLM.router.register('example.com', async () => {
    await SLM.browser.click('#continue');
});

// Multiple domains sharing the same logic
SLM.router.register(['site-a.com', 'site-b.net'], async () => {
    await SLM.waiters.sleep(3000);
    await SLM.browser.click('.btn-go');
});

// RegExp — subdomains or naming variants
SLM.router.register(/shrink(me|earn)\.(io|com)/, async () => {
    // ...
});

// Same domain, different routes
SLM.router.register('example.com', downloadHandler, { path: '/download' });
SLM.router.register('example.com', linkHandler,     { path: '/go' });
```

---

### SLM.uboOverride

The active uBO override engine. Rather than detecting uBO and yielding, SLM v4.8 **attempts to win the property back** using a 4-technique cascade. Each technique is tried in order, stopped as soon as one succeeds. Results are tracked per property and exposed here.

---

**The 4 override techniques:**

| # | Technique | How it works | When it succeeds |
|---|-----------|-------------|-----------------|
| T1 | Instance `defineProperty` | `Object.defineProperty(document, prop, ...)` | uBO used `configurable:true` (most common case) |
| T2 | Prototype `defineProperty` | `Object.defineProperty(Document.prototype, prop, ...)` | uBO defined on instance but left the prototype free |
| T3 | Delete + redefine | `delete document[prop]` then `defineProperty` | uBO's descriptor is `configurable:true` — delete removes it |
| T4 | Prototype Proxy | Wraps the entire prototype in a Proxy intercepting the target property | All other techniques failed, but `setPrototypeOf` is allowed |

---

**The 3 possible results per property:**

| Result | Meaning | Console color |
|--------|---------|--------------|
| `overridden` | SLM won — property is under SLM control | 🟢 Green |
| `impossible` | `configurable:false` — a JS spec limit, no script can bypass this | 🔴 Red |
| `proxied` | A global `window` Proxy is active — cannot be removed | 🟠 Orange |

---

#### `SLM.uboOverride.results`

Object with the override result for each property attempted so far.

```javascript
SLM.uboOverride.results
// Example output:
// {
//   'doc.hidden':          'overridden',
//   'doc.visibilityState': 'overridden',
//   'doc.hasFocus':        'overridden',
//   'doc.activeElement':   'impossible',
//   'win.open':            'overridden'
// }
```

---

#### `SLM.uboOverride.override(prop, descriptor)`

Manually attempt to override a `document` property using the 4-technique cascade.

```javascript
// Override document.hidden to always return false
SLM.uboOverride.override('hidden', { get: () => false });
// → 'overridden' | 'impossible' | 'proxied'

// Override document.visibilityState
SLM.uboOverride.override('visibilityState', { get: () => 'visible' });
```

---

#### `SLM.uboOverride.overrideWin(prop, value)`

Attempt to override a `window` property. Uses direct assignment first, then falls back to the cascade.

```javascript
SLM.uboOverride.overrideWin('open', myFakeOpen);
// → 'overridden' | 'impossible' | 'proxied'
```

---

#### `SLM.uboOverride.clearCache()`

Clears cached results (except `impossible` — those cannot change). Called automatically on SPA navigation.

```javascript
SLM.uboOverride.clearCache();
```

---

#### `SLM.uboOverride.signatures`

Returns the known uBO scriptlet signatures used to identify injected getters/setters.

```javascript
SLM.uboOverride.signatures
// → ['setConstant', 'trapProp', 'thisScript', 'normalValue', 'cloakFunc', 'logPrefix', 'noopFunc', 'trueFunc', 'falseFunc']
```

---

### SLM.spa

SPA navigation manager. Detects URL changes caused by `pushState`, `replaceState`, `popstate` and DOM mutations, then re-runs the Router and executes any registered cleanup functions.

#### `SLM.spa.onLeave(fn)`

Registers a cleanup function that runs **once** the next time the user navigates away from the current path. After it runs it is removed — it will not fire again unless re-registered.

Use this inside a site script handler to undo any side effects (document state changes, `window.open` overrides, timers, etc.) that should not persist across SPA navigations.

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `function` | Called once when the path changes away from the current one |

```javascript
Router.register('my-spa.com', async () => {
    // Apply side effects
    SLM.safe.invisible();
    SLM.browser.blockPopups();

    // Register cleanup — runs automatically when the user leaves this path
    SLM.spa.onLeave(() => {
        SLM.safe.reset();
        SLM.browser.restorePopups();
    });
}, { path: '/ptc/window' });
```

You can register multiple `onLeave` calls — they all run in order:

```javascript
SLM.spa.onLeave(() => SLM.safe.reset());
SLM.spa.onLeave(() => SLM.browser.restorePopups());
SLM.spa.onLeave(() => console.log('cleanup done'));
```

**How SPAManager detects navigation:**

| Mechanism | Covers |
|-----------|--------|
| `history.pushState` intercept | React Router, Vue Router, Next.js, etc. |
| `history.replaceState` intercept | Programmatic URL replacement |
| `window.popstate` listener | Browser back / forward buttons |
| `MutationObserver` fallback | Hash routing and frameworks that mutate the DOM without history API |

---

## Adding a New Site

To add support for a new shortlink, edit the `SiteScripts.register()` section and add a `Router.register` call:

```javascript
Router.register(['new-site.com'], async () => {
    // 1. Wait for the key element to load
    await Waiters.waitForElement('>CSS> #timer', 10, true);

    // 2. Read the timer value
    const secs = StringUtils.toNumber(await Browser.getText('>CSS> #timer'));
    await Waiters.sleep(secs * 1000);

    // 3. If there is a captcha, wait for it to be solved
    if (Captcha.isPresent()) {
        await Captcha.waitForResolutionPromise(60);
    }

    // 4. Click the final button
    await Browser.click('>CSS> #get-link');
});
```

### Recipe: shortlinks with an intermediate article

Some shortlinks display an article that must be "read" before continuing:

```javascript
Router.register(['article-site.com'], async () => {
    await Waiters.waitForElement(">XPATH> //p[@id='click' and contains(., 'Open')]", 10, true);

    // Simulate focus so the timer advances
    safeInvisible();
    safeActiveIframe();

    // Wait for the article to reveal the continue button
    await Waiters.waitForElement(
        ">XPATH> //p[@id='click' and contains(., 'Read The Article')]", 15, true);

    const txt   = await Browser.getText('>CSS> #click');
    const timer = StringUtils.toNumber(StringUtils.getBetween(txt, 'For ', ' More'));
    await Waiters.sleep(timer * 1000);

    safeResetDocument();
    safeActiveOriginal();

    await Browser.click(">CSS> [class^='btn-']:not([disabled])");
});
```

### Recipe: shortlinks with base64 / ROT13 obfuscated URLs

```javascript
Router.register(['obfuscated-site.com'], async () => {
    await Waiters.waitForElement('>CSS> #encoded-link', 10);

    const raw        = await Browser.text('>CSS> #encoded-link');
    const decodedB64 = StringUtils.extractUrl(raw);  // tries base64 and URI decode
    const decodedR13 = StringUtils.rot13(raw);        // tries ROT13

    const finalUrl = decodedB64 || decodedR13;
    if (finalUrl) Browser.redirect(finalUrl);
});
```

---

## Usage Examples

### From the browser console

All methods are available on `window.SLM` from the DevTools Console on any page where the script is active.

```javascript
// Print full document state
SLM.document.status();

// Simulate the page being focused (useful to unblock timers)
SLM.safe.visible();

// Wait 5 seconds then click a button
await SLM.waiters.sleep(5000);
await SLM.browser.click('#my-button');

// Get text from an element using XPath
const txt = await SLM.browser.text(">XPATH> //h1[contains(@class,'title')]");
console.log(txt);

// Safe redirect
SLM.browser.redirect('https://destination.com');

// Detect which properties uBO is blocking
SLM.safe.detectUBO();

// Register a new site on the fly (without editing the script)
SLM.router.register('another-site.com', async () => {
    await SLM.waiters.sleep(3000);
    await SLM.browser.click('.skip-btn');
});
SLM.router.run(); // manually trigger the router
```

---

## Selector System

SLM uses a chainable selector system with type prefixes, directly inspired by [Browser Automation Studio](https://bablosoft.com/shop/BrowserAutomationStudio):

| Prefix | Description | Example |
|--------|-------------|---------|
| `>CSS>` | Standard CSS selector (default) | `>CSS> #btn.active` |
| `>XPATH>` | Full XPath expression | `>XPATH> //button[contains(.,'OK')]` |
| `>MATCH>` | Partial text content match | `>MATCH> Continue` |
| `>SHADOW>` | Enter a Shadow DOM root | `>CSS> my-component >SHADOW> button` |
| `>FRAME>` | Enter an iframe's document | `>CSS> iframe#ads >FRAME> >CSS> .skip` |
| `>AT>` | Select by index from a result array | `>CSS> .item >AT> 2` |

If no prefix is specified, `>CSS>` is assumed automatically:

```javascript
// These two are equivalent
SLM.browser.exists('#my-button');
SLM.browser.exists('>CSS> #my-button');
```

### Chained selectors

```javascript
// Enter an iframe, then find an element inside
await SLM.browser.click('>CSS> iframe#payment >FRAME> >CSS> button.submit');

// Enter Shadow DOM
await SLM.browser.click('>CSS> custom-player >SHADOW> >CSS> .play-btn');

// Select the 3rd element in a list (zero-indexed)
const el = SLM.browser.get('>CSS> .result-item >AT> 2');

// XPath with specific text
await SLM.browser.click(">XPATH> //a[contains(text(), 'Get Link')]");
```

---

## Supported Sites

| Site | Captcha | Timer | Article |
|------|---------|-------|---------|
| barlianta.com | Turnstile | ✅ | ✅ |
| jobpagol.com | Turnstile | ✅ | ✅ |
| cararabic.com | Turnstile | ✅ | ✅ |
| teknoventure.biz.id | Turnstile | ✅ | ✅ |
| postalcode.com.pk | Turnstile | ✅ | ✅ |
| esladvice.com | Turnstile | ✅ | ✅ |
| progame.biz.id | Turnstile | ✅ | ✅ |
| maqal360.com | — | ✅ | — |
| diudemy.com | — | ✅ | — |
| luckywatch.pro | — | — | — |
| fc-lc.xyz | hCaptcha / Turnstile | — | — |
| jobzhub.store | Captcha | ✅ | — |
| viefaucet.com | — | — | — |

---

## Changelog

### v4.8
- **Strategy change: from defensive (UBOGuard) to offensive (UBOOverride)**
- Replaced `UBOGuard` (detect + skip) with `UBOOverride` (detect + attempt to win)
- `UBOOverride` uses a 4-technique cascade per property: T1 instance `defineProperty` → T2 prototype `defineProperty` → T3 delete+redefine → T4 prototype Proxy wrapper
- Each property now has a tracked result: `overridden` / `impossible` / `proxied` instead of a simple boolean
- `defineProp()` now calls `UBOOverride.overrideDocumentProp()` — every write in the script actively fights uBO instead of yielding
- `Browser.blockPopups()` uses `UBOOverride.overrideWindowProp('open', ...)` — fights uBO over `window.open` too
- `DocumentSmartController.visible()` and `invisible()` no longer check `blocked` flags before setting — they attempt the override directly and report the result
- `status()` now returns `overrideStatus` and `overrideResults` instead of `ubo` boolean flags
- `safeDetectUBO()` now prints `UBOOverride.results` (real outcomes) instead of detection flags
- `SLM.uboOverride` exposed in public API with `results`, `override`, `overrideWin`, `clearCache`, `signatures`
- `UBOOverride` cache cleared on SPA navigation (except `impossible` entries — those are permanent)
- Init log now distinguishes `non-configurable` (red ⛔) from `proxied` (orange ⚠️) instead of a generic "uBO blocks" message
- Version bumped to 4.8

### v4.7
- Added `UBOGuard` — global proactive uBO detection module with 4-method coverage (signature scan, descriptor flags, write-revert test, `uBO_scriptletsInjected` array)
- `defineProp()` now routes through `UBOGuard.isBlocked()` before every `Object.defineProperty` — protected properties are silently skipped, no errors thrown
- `Browser.blockPopups()` now checks `UBOGuard.isWindowPropBlocked('open')` before overwriting `window.open`
- `DocumentSmartController` UBO detection refactored to use `UBOGuard` as primary source, removing internal duplication
- `UBOGuard` cache cleared automatically on SPA navigation
- `SLM.uboGuard` exposed in public API with `isDocumentPropBlocked`, `isWindowPropBlocked`, `isBlocked`, `clearCache`, `signatures`
- Version bumped to 4.7

### v4.6
- Added `SPAManager` — detects SPA navigations via `pushState`, `replaceState`, `popstate` and `MutationObserver`, re-runs Router on path change with debounce
- Added `SPAManager.onLeave(fn)` — registers cleanup functions that run automatically when leaving the current path
- Added `Browser.blockPopups()` — replaces `window.open` with a fully-typed fake window (idempotent, safe to call multiple times)
- Added `Browser.restorePopups()` — restores the original `window.open` captured at script load time
- `SLM.spa.onLeave` exposed in public API
- `SLM.browser.blockPopups` and `SLM.browser.restorePopups` exposed in public API
- Added support for `viefaucet.com` (SPA, `/ptc/window` path, invisible mode + popup blocking)
- Version bumped to 4.6

### v4.5
- Added `DocumentSmartController.persist()` — global listeners that re-apply `visible`/`invisible` mode if the page tries to revert it
- Fix: infinite recursion in `persist()` listeners — added `_applying` re-entrancy guard
- `_persistMode` state: `null` (inactive), `'visible'`, `'invisible'` — no impact on normal pages
- `reset()` now clears `_persistMode`

### v4.4
- Added `Waiters.waitForAny` — waits for DOM existence without requiring visibility
- Added `Waiters.waitForText` — waits for a text condition (string, function or RegExp)
- Added `Browser.redirect` — safe redirect with protocol validation
- Added `Browser.popupsToRedirects` — `window.open` interceptor
- Added `StringUtils.encodeBase64`, `StringUtils.rot13`, `StringUtils.extractUrl`
- Added `Captcha.openHCaptchaWhenVisible` — automatic invisible hCaptcha execution
- Router now accepts RegExp and a `path` option for same-domain multi-route handlers
- Router now executes all matches, not just the first — enables per-path handlers on the same domain
- Added support for `jobzhub.store`

### v4.3
- Cache now invalidates disconnected DOM nodes via `Node.isConnected`
- Split `status()` (with console log) from `getStatus()` (silent) to prevent console spam
- `safeProp` refactored: setter is now evaluated at call time, not at definition time
- Fix: `waitForResolutionPromise(0)` now enforces a minimum of 5 seconds
- Fix: XPath selector for `cf-turnstile-response` (`[value!=""]` requires XPath, not CSS)

### v4.2
- Full refactor: unified Cache, async/await Waiters, Browser with pre-compiled `TOKEN_RE`
- `DocumentSmartController` split into `UBO`, `Props` and `Controller` submodules
- Generic `safeProp()` replaces all duplicated safe helpers
- `safeActive*` shortcuts generated via loop

### v4.1
- First public version with Document Smart Controller
- uBO signature detection for `hasFocus`, `hidden`, `visibilityState` and `activeElement`

---

## License

MIT — free to use, modify and distribute.
