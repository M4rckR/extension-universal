# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Target Inspector** — a Chrome extension (Manifest V3) that intercepts Adobe Target / Alloy SDK personalization responses on **any http/https site** (`*://*/*`) and renders them in the popup: which A/B and XT activities fired, and which mboxes are in use vs. free.

It works on any http/https site and the Adobe Target tenant used for the admin deep-links is user-configurable in the popup footer (`chrome.storage.local` key `tenant`). When `tenant` is empty, `getTargetUrl` returns `null` and the render hides the deep-links — the extension is otherwise fully functional.

There is **no build, no dependencies, and no tests**. It is plain HTML/CSS/JS loaded as an unpacked extension.

## Running / developing

1. `chrome://extensions/` → enable **Modo desarrollador** → **Cargar descomprimida** → select this folder.
2. Reload the extension icon (↻) in `chrome://extensions/` after **every** change to `inject.js`, `content.js`, `manifest.json`, or `background.js`. Edits to `popup.html`/`popup.js` just require closing and reopening the inspector window (click the toolbar icon again) — no `default_popup` means there's no popup to reopen, only the window.
3. Capture normally happens on **page load**. For a tab that was already open before the extension was (re)loaded, the empty state has a **"Capturar ahora"** button that reinjects `inject.js`/`content.js` on demand via `chrome.scripting.executeScript` — no page reload needed for that case.

## Reference material in this repo (not our code)

One unpacked-extension folder lives alongside the real source, for research only — it is never `require`d, built, or shipped:

- **`referencia/`** — Adobe's own official "Experience Platform Debugger" extension, unpacked, gitignored. Kept in case work ever needs network-level capture (`chrome.debugger` or `webRequest`) — the one thing its hooks cover that ours don't, since `inject.js` only sees what Alloy chooses to expose via `window.__alloyMonitors`/`postMessage`, not raw network traffic. Do not assume anything under `referencia/` is this project's code, and do not edit it.

## Architecture: four scripts, one-way data flow, window-only UI

Data flows one direction across two JavaScript worlds because of a Chrome constraint: only isolated-world scripts can touch `chrome.*` APIs, but only main-world scripts can see the page's `window.alloy`. There is no `default_popup` — `background.js` is the only entry point, opening `popup.html` in an independent `chrome.windows.create` window instead.

```
inject.js  (world: MAIN, run_at: document_start)
  ├─ Registers a hook in window.__alloyMonitors → catches every Alloy network response
  │    + onInstanceConfigured → orgId/edgeConfigId/edgeDomain for the active instance
  ├─ Monkey-patches window.alloy() to read decisionScopes before they're sent
  ├─ Scans [data-mbox] DOM nodes (+ MutationObserver, 200ms debounce, for SPAs)
  ├─ Hooks window.digitalData.push (two-layer defineProperty, see inject.js comments)
  └─ Wrapped in a window.__mboxInspectorInjected guard — safe to reinject on demand
       │  window.postMessage({ source: 'mbox-inspector', type, ... })
       ▼
content.js (world: ISOLATED, run_at: document_start)
  ├─ Only script with chrome.storage access; pure postMessage → storage bridge
  ├─ Validates every message's shape/size before storing (the "mbox-inspector" marker
  │    authenticates nothing — any page script can post it; popup.js escapes on render too)
  ├─ On load: if origin+pathname+search changed vs. stored tabUrl, wipes requests/domMboxes/
  │    instanceInfo — NOT digitalDataEvents, which persists across navigation on purpose
  │    (each entry carries its own pageUrl; see "Event persistence" below)
  └─ Wrapped in a window.__mboxInspectorContentActive guard — safe to reinject on demand
       │  chrome.storage.local: { requests[≤50], domMboxes[], digitalDataEvents[≤500],
       │                          instanceInfo, tabUrl }
       ▼
popup.js  (popup.html, mounted only inside the independent window)
  ├─ render()             → "Actividades" tab
  ├─ renderMboxes()       → "mBoxes" tab
  ├─ renderEventos()      → "Eventos" tab, grouped by page of the crawl (see below)
  ├─ renderInstanceInfo() → footer: orgId/edgeConfigId of the page's Alloy instance
  └─ chrome.storage.onChanged → live re-render of the active tab

background.js (service worker)
  ├─ chrome.action.onClicked → creates the inspector window (first click) or
  │    focuses the existing one (chrome.windows.get/update) — only entry point
  │    Clicking from a different tab retargets the existing window to that tab.
  └─ chrome.tabs/windows.onRemoved → clears the {windowId, tabId, sourceTabId}
       pointer when the INSPECTOR window/tab closes (tabId/windowId are the
       inspector's own; sourceTabId is the inspected tab — closing that one
       keeps the pointer so the next click can retarget)
```

Message types (`content.js` switches on `event.data.type`): `alloyResponse` (full payload, unshifted onto `requests`, capped at 50), `domMboxes` (union-merged into `domMboxes`), `decisionScopes` (also merged into `domMboxes`, `__view__` filtered out), `instanceInfo` (orgId/edgeConfigId/edgeDomain, overwrites the single stored value), `digitalDataPush` (unshifted onto `digitalDataEvents` with `pageUrl` attached, capped at 500).

### Event persistence (`digitalDataEvents` survives navigation)

Unlike `requests`/`domMboxes` (a snapshot of the *current* page, reset on every navigation), `digitalDataEvents` is a *log of the crawl* — each entry keeps the `pageUrl` it fired on, and `content.js`'s page-change reset deliberately skips this key. `popup.js`'s `renderEventos()` re-groups the flat list by consecutive `pageUrl` runs (`groupEventsByPage`), rendering one collapsible `.event-page` section per page visited (most recent expanded, older ones collapsed) — each section internally reuses the pre-existing consecutive-same-event-name grouping (`groupConsecutiveEvents`/`.event-group`) unchanged, so there is never a 3-level nested-toggle tree: collapsing a page hides everything under it in one click. Entries from before this persistence model shipped won't have `pageUrl` — `formatPageLabel` falls back to a "Página desconocida" bucket for those instead of breaking the grouping; no real migration was needed since this is a single-developer local tool.

Cap is 500 (not 50 like `requests`): measured live against a production site, a typical push (`trackScroll`/`trackAction`) is ~60-120B of raw JSON; with the `{payload,time,timeSincePageLoad,pageUrl}` wrapper each stored entry is ~300-500B, so 500 entries ≈ 250KB — a small fraction of the 10MB `chrome.storage.local` quota (no `unlimitedStorage` permission requested or needed). The number is sized to comfortably cover a 30-50 page crawl, not to avoid hitting quota.

`digitalDataEvents` is still wiped by the **Limpiar** button — an explicit "start over" action, unlike an ordinary navigation within the same crawl. Limpiar offers "Deshacer" for a few seconds (the previous arrays are kept in memory and merged back with anything captured meanwhile).

**Known limitation:** storage isn't partitioned by `tabId` (a content script can't cheaply learn its own tab ID — that requires a `chrome.runtime.sendMessage` round-trip to the service worker, which doesn't exist here). Two tabs of the same site open at once will interleave events into one timeline instead of two separate crawls. `requests`/`domMboxes` have the same root issue but it's contained to one page at a time; for persisted events it can span the whole crawl. Not solved — deliberately deferred, see README's "Limitación conocida".

### QA mode — removed

The QA tab (setting/clearing Adobe Target's `at_qa_mode` preview cookie from a pasted preview link, plus the "QA activo" banner on every tab) was removed on 2026-10-02. Everything tied to it went with it: `inject.js` no longer reads `document.cookie`, `content.js` no longer handles a `qaMode` message, and `popup.js` deletes any leftover `qaMode` key from storage on load. The full implementation and its research (the cookie's anatomy, the live `listedActivitiesOnly` comparison against a production site, and why `document.cookie` is enough because Alloy forwards `at_qa_mode` to the edge unconditionally) are not part of this repository's history.

Consequence worth knowing: a stale `at_qa_mode` cookie set by another tool still forces preview on Target's side, and nothing in this extension warns about it anymore — if Actividades shows unexpected decisions, check `document.cookie` on the page.

### On-demand reinjection (`chrome.scripting`, `.btn-inject` in the popup)

`manifest.json` declares the `scripting` permission. Both `inject.js` and `content.js` are idempotency-guarded (`window.__mboxInspectorInjected` / `window.__mboxInspectorContentActive`) specifically so the "Capturar ahora" button can call `chrome.scripting.executeScript` to inject them into a tab that was already open before the extension was loaded/reloaded — Chrome only auto-injects `content_scripts` into *new* page loads matching the manifest, not retroactively into already-open tabs. Without the guard, clicking the button on an already-active page would double-register the Alloy monitor and the postMessage listener, duplicating captured entries.

This was scoped deliberately narrow: no `webNavigation` permission, no SPA-route auto-detection — that's what Adobe's own "Experience Platform Debugger" extension does (persistent app window + `chrome.webNavigation.onHistoryStateUpdated` + on-demand `scripting.executeScript`), but it's overkill here and would widen the permission footprint on banking domains for a corner case (a tab open before extension reload). Alloy's monitor hooks already keep firing for the page's lifetime once registered, so ordinary SPA navigation within an already-injected page needs no extra handling. `background.js` exists (for the window-management entry point above), just not for this.

### Payload shape the popup parses

Personalization decisions live at `payload.handle[].payload` where `handle[].type === "personalization:decisions"`. Per decision `d`:

- `d.scope` — mbox name, or `__view__` (VEC / Visual Experience Composer).
- `d.scopeDetails.activity.{id,name}` and `d.scopeDetails.experience.{id,name}`.
- `d.items[0].meta["activity.name"]` / `["experience.name"]` — preferred source, with `scopeDetails` as fallback (see `getActivityInfo`).

Activities are deduplicated by `activity.id` before rendering.

### A/B vs. XT detection (`detectType`)

Adobe's payload does not label activity type, so `popup.js` infers it heuristically: experience name of "B" ⇒ AB; `A/B` or standalone `AB` token in the name ⇒ AB; standalone `XT` token ⇒ XT. When detection fails, `render()` shows **both** AB and XT links as guesses. The type maps to the Target UI URL segment (`ab_manual` vs `experience_targeting`) under the user-configured tenant (`chrome.storage.local` key `tenant`, empty by default) — see `getTargetUrl`.

This is a hard limitation of the `personalization:decisions` payload, not a gap in this extension: cross-checked against Adobe's own "Experience Platform Debugger" extension, whose 4MB UI bundle contains zero references to `personalization`, `decisionScopes`, or `scopeDetails` — its activity-type logic only exists for the legacy at.js trace system (`___target_traces`), which doesn't apply to Web SDK/Alloy integrations like this one. Don't spend time hunting for a hidden type field in the payload; there isn't one.

### mBox classification (`renderMboxes`)

Cross-references the DOM set (`domMboxes`) against the responded set (scopes Target answered):

- **En uso** — in DOM *and* Target responded.
- **Libre** — in DOM, no Target response.
- **Solo Alloy** — Target responded but no `[data-mbox]` element (e.g. VEC/decisionScope-only).

The summary line above the list (`#mbox-summary`) uses the same three categories, so "en uso" + "libres" always equals the DOM count.

**"mbox" vs. "decision scope" — same concept, two names.** Sites on Web SDK (Alloy) are where Adobe renamed the legacy "mbox" to "decision scope" — they're the same thing under different SDKs/eras. Many front-ends still use the `mbox` convention in the DOM (`[data-mbox]`), while Alloy requests/responds in terms of scopes. This extension straddles both worlds on purpose: `domMboxes` is what we scan from the DOM (the `mbox` side), and `decisionScopes`/`scope` in the Alloy payload is what Target actually requested/answered (the "decision scope" side). The **Alloy** category above exists specifically for scopes Target answered that have no matching `[data-mbox]` element, and `__view__` is the special scope the VEC (Visual Experience Composer) uses. Don't "unify" this terminology later — collapsing it loses the distinction the classification logic depends on.

**Every public page tested so far on the production site used to build this was 100% VEC** (`__view__`, zero `[data-mbox]` elements). `renderMboxes()` deliberately excludes `__view__` from the classification above, so on those pages `allMboxes` is always empty even though `requests` has real activities. `renderMboxes()` distinguishes the two empty cases instead of showing one generic "recargá" message for both: `requests.length === 0` ("Sin datos aún, recargá") vs. `requests.length > 0` but nothing fit the mbox classification ("esta página no usa mboxes nombrados — todo corre por VEC, mirá Actividades"). The tab is being kept for now specifically because authenticated/transactional flows weren't tested and are a plausible place for named mbox targeting — if it turns out to always be empty in practice, removing `renderMboxes`/`domMboxes`/the DOM scan in `inject.js`/the panel is a deliberate separate follow-up, not bundled with unrelated changes.

## Gotchas

- `popup.js` hard-codes DOM IDs/classes it expects from `popup.html`: `#list`, `#count`, `#page-url`, `#ts`, `#mbox-list`, `#clear`, `#tenant-input`, `#edge-info`, `#mbox-summary`, `#toast`/`#toast-text`/`#toast-action`, `.tabs__item[data-tab]` (real `<button role="tab">`s — keyboard nav lives in `activateTab`), `.panel`, `.url-bar__indicator` (state via `--ok/--warn/--error` modifiers, set by `setIndicator`, never inline styles). Renaming in the HTML silently breaks rendering (e.g. `#tenant-input` is read by `setupTenantInput`).
- Every captured value interpolated into `innerHTML` goes through `escapeHtml` (which also escapes quotes, since values land in `title`/`href`/`data-*` attributes). The extension runs on arbitrary sites and the page controls activity names, scopes, mbox names and event payloads — MV3's CSP blocks inline scripts but not injected links/iframes/forms. Don't add a template interpolation of payload data without it.
- Colors, type sizes and fonts are tokens on `:root` in `popup.html` (semantic names: `--ink-3`, `--type-ab`, `--danger`…). Every text/background pair was measured at ≥4.5:1, and the type floor is 11px — add new UI through the tokens, not raw hex or smaller sizes.
- Fonts are bundled (`assets/fonts/`, IBM Plex latin subset, OFL license alongside) and declared with `@font-face` in `popup.html` — the window makes no external requests. Don't reintroduce the Google Fonts `<link>`.
- "Página no inspeccionable" / "pestaña cerrada" are a terminal state (`blockedState`, set via `setBlocked`): every render function starts with `showBlockedIn(listId)` and bails if it's set, so all three tabs show the notice and live updates from other tabs can't paint over it. A new render function needs the same guard.
- Live re-renders (`storage.onChanged`) replace each list's `innerHTML`, so anything the user opened is tracked in memory (`openActivityContent`, `pageExpandOverrides`, `expandedEventGroups`, `openEventPayloads`) and restored with `scrollTop`. A new collapsible needs the same treatment or it'll snap shut on every incoming event.
- There is **no** allowed-domain list anymore. Injection is gated only by the `manifest.json` `host_permissions` + both `content_scripts.matches` blocks (all `*://*/*`); the popup's `isAllowedDomain` just checks the protocol is http/https so it can show the "no inspeccionable" state on `chrome://`/`about:` pages.
- Permissions are deliberately minimal for the Chrome Web Store: `storage` + `scripting` + `host_permissions: *://*/*`. There is **no** `tabs` permission — the host permission already exposes `tab.url` for http/https tabs, and on `chrome://` pages `url` comes back `undefined`, which `isAllowedDomain` treats as "no inspeccionable". Don't add `tabs` back; the Store flags unused permissions.
- Manifest icons are PNG (`assets/icon{16,32,48,128}.png`; the 128 has the Store's 16px transparent padding). The SVGs stay only for the `<img>` in the popup header — Chrome doesn't render SVG as an extension/toolbar icon. `npm`-free packaging lives in `store/package.sh` (zips only the runtime files into `dist/`).
- `popup.html` CSS uses BEM naming; keep it consistent when adding UI.
- `content.js` never calls `chrome.storage.local.get`/`.set` directly — always through `safeStorageGet`/`safeStorageSet`, which no-op if `chrome.runtime.id` is `undefined` (extension context invalidated, e.g. the extension got reloaded while this content script was still injected in an already-open tab — `inject.js` has no `chrome.*` bindings so it keeps posting messages regardless, and the orphaned `content.js` would otherwise throw "Extension context invalidated" on every one). Adding a new `chrome.storage.local` call site directly instead of through the wrappers reintroduces that noise. `popup.js`/`background.js` don't need this: they run as extension pages/the service worker, which get torn down (not orphaned) when the extension reloads.
- The version string lives in **two** places that must stay in sync: `manifest.json` (`version`) and `README.md` ("Versión" section). The footer reads it at runtime via `chrome.runtime.getManifest().version` (`renderInstanceInfo`), so there's no UI copy to bump.

## Domain scope

No per-domain configuration is needed: `manifest.json` already matches `*://*/*` in `host_permissions` and both `content_scripts[].matches` arrays, so the extension injects on every http/https site. `popup.js` has no allowed-domain list — `isAllowedDomain` only rejects non-web pages (`chrome://`, `about:`, etc.).

**Permission-footprint note:** matching `*://*/*` runs `inject.js` (world MAIN) on **all** sites, including banking/transactional ones. That footprint is accepted on purpose — the whole point is to work anywhere. Capture is purely observational: since the QA tab was removed, the extension never writes cookies or reloads the inspected page.
