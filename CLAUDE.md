# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Target Inspector** — a Chrome extension (Manifest V3) that intercepts Adobe Target / Alloy SDK personalization responses on **any http/https site** (`*://*/*`) and renders them in the popup: which A/B and XT activities fired (and whether Alloy actually rendered them), which mboxes are in use vs. free, the data-layer pushes, and the Adobe Launch (Tags) property and rules of the page.

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
  │    + onBeforeNetworkRequest/onNetworkError → hitRequest/hitError (Hits tab); onNetworkResponse
  │      also carries requestId/statusCode so content.js completes the matching hit
  │    + onContentRendering/onContentHiding → renderEvent (status + activity IDs only;
  │      measured shapes: started = {scope, propositions}, succeeded = {<scope>: [props]})
  ├─ Launch: an accessor on window._satellite attaches a monitor to _satellite._monitors
  │    (ruleCompleted / ruleConditionFailed) the moment the Launch library assigns its
  │    object. It deliberately does NOT pre-create window._satellite (Adobe's documented
  │    `window._satellite = window._satellite || {}` pattern): pages doing
  │    `if (window._satellite) _satellite.track(...)` before Launch loads would throw.
  │    Rules are batched (300ms) into one launchRules message; failed conditions are
  │    summarized (extension, kind, detail like the cookie name) plus `code`: the customCode source (settings.source is a function → toString) or the settings as JSON for other kinds, capped at 8000 chars in content.js. Dedup includes `code` — two customCode conditions only differ there. Rules carry `actions` — completed AND failed (for failed ones the popup labels them "no se ejecutaron": it's what the rule would have done) (module, language, code or settings JSON, or `externalUrl` while an external customCode is still a URL), sent ONCE per rule+status per load by inject.js (`launchActionsSent`, keyed `id|status` since content.js keeps one entry per status: some actions are ~90KB and scroll rules fire dozens of times) and capped at 12000 chars × 10 actions in content.js. Consequence: after Limpiar, rules that fire again come back without actions until the next load. The popup fills each code `<pre>` lazily on open (re-escaping every action on every batch was heavy).
  │    launchInfo (property/environment/build) is polled until buildInfo exists (30s).
  ├─ Wraps every Alloy instance (window.alloy + names in window.__alloyNS) in a Proxy to
  │    read decisionScopes / personalization.decisionScopes before they're sent. Proxy, not a
  │    new function: the base snippet's queue keeps its .q, which the library reads on load.
  │    Re-checked every 100ms for 30s, since the library replaces the queue function.
  ├─ Scans [data-mbox] DOM nodes (+ MutationObserver, 200ms debounce, for SPAs)
  ├─ Hooks .push on window.digitalData AND window.adobeDataLayer (two-layer defineProperty,
  │    see inject.js); items already in the array when hooked are reported once, zero-arg
  │    push() calls are ignored. Only arrays or objects that already have their own push are
  │    hooked — a plain-object digitalData (W3C style, e.g. bbva.pe) is left untouched.
  │    Each push carries `layer`, stored on the event.
  ├─ Whole file is one IIFE: nothing leaks into the page's globals except the guard,
  │    __alloyMonitors, the two data-layer accessors and the window._satellite accessor. Each section has its own try/catch.
  └─ Wrapped in a window.__mboxInspectorInjected guard — safe to reinject on demand
       │  window.postMessage({ source: 'mbox-inspector', type, ... })
       ▼
content.js (world: ISOLATED, run_at: document_start)
  ├─ Only script with chrome.storage access; pure postMessage → storage bridge
  ├─ Validates every message's shape/size before storing (the "mbox-inspector" marker
  │    authenticates nothing — any page script can post it; popup.js escapes on render too)
  ├─ On load: if origin+pathname+search changed vs. stored tabUrl, wipes requests/domMboxes/
  │    instanceInfo/launchInfo — NOT digitalDataEvents, which persists across navigation on purpose
  │    (each entry carries its own pageUrl; see "Event persistence" below).
  │    renderEvents/launchRules/hits are wiped on EVERY load, reloads included: they describe
  │    one load, and keeping them doubled every rule's count (×2) on reload.
  └─ Wrapped in a window.__mboxInspectorContentActive guard — safe to reinject on demand
       │  chrome.storage.local: { requests[≤50], domMboxes[], digitalDataEvents[≤500],
       │                          instanceInfo, renderEvents[≤200], launchRules[≤400], launchCode:*, hits[≤100],
       │                          launchInfo, tabUrl }
       ▼
popup.js  (popup.html, mounted only inside the independent window)
  ├─ render()             → "Actividades" tab
    ├─ renderEventos()      → "Eventos" tab, grouped by page of the crawl (see below)
  ├─ renderHits()         → "Hits" tab: one row per Edge call, response joined by requestId
  ├─ renderLaunch()       → "Launch" tab: property card (environment badge, warning when
  │                          not production) + rules, chips by result, text search
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

Message types (`content.js` switches on `event.data.type`): `alloyResponse` (full payload, unshifted onto `requests`, capped at 50), `domMboxes` (union-merged into `domMboxes`), `decisionScopes` (also merged into `domMboxes`, `__view__` filtered out), `instanceInfo` (orgId/edgeConfigId/edgeDomain, merged into a **list keyed by instance name** — sites like bbva.pe run two Alloy instances with different datastreams; the footer shows "N instancias" with all of them in the tooltip; a legacy single-object value is read as a one-item list), `digitalDataPush` (unshifted onto `digitalDataEvents` with `pageUrl` attached, capped at 500), `pageSdk` (`{atjs, atjsVersion}`, reset on page change), `renderEvent` (appended to `renderEvents` in arrival order — `getRenderState` in popup.js walks them in order — only known statuses accepted, capped at 200), `launchInfo` (replaces `launchInfo`), `launchRules` (a batch, **aggregated** into `launchRules` by `ruleId|status` with a `count`, first/last time and up to 5 distinct failed conditions; capped at 400 distinct entries).

### Hits (`renderHits`) and the Actividades empty-state diagnosis

`hitRequest` (from `onBeforeNetworkRequest`, body cloned via JSON) is appended to `hits` with a summary computed in content.js (`summarizeHitBody`: eventTypes, decisionScopes, activity IDs of `decisioning.propositionDisplay` propositions). `alloyResponse` now carries `requestId`/`statusCode`: content.js fills `status`/`handleTypes`/`decisions` on the matching hit **even when the payload is too large to store**, and stores `requestId` on the `requests` entry. The popup shows the response body by looking it up in `requests` — it is never duplicated into `hits`. Request/Response `<pre>`s are filled lazily on open (responses run 50-115KB).

When Actividades has nothing to show (no `requests`, **or** responses with zero decisions — elpais.com/ibm.com/redhat.com used to show an empty list with only the tenant note), `whyNoActivitiesHtml` explains why, in this order: (1) at.js without Alloy (`pageSdk`, posted by inject.js section 6 — it only reads `window.adobe.target`, never calls it); (2) only if no decision call went out: a Target-named rule (`TARGET_RULE_RE`) blocked by a consent-looking cookie (`CONSENT_COOKIE_RE`), else N rules blocked by consent cookies; (3) Alloy configured: decision calls without activities (mentions `no-offers`), calls without decisions, or no calls in this load. A Target-named rule that failed on path/valueComparison is deliberately NOT used as the reason — nvidia.com/whirlpool.com have dozens, for other pages, and pointing at one was misleading. Found live on viabcp.com: without accepting cookies the "Adobe Target" rule requires `politica_privacidad_personalizacion` and Target is never called — that's what "no cargan las actividades" was in a fresh Brave profile. The "Capturar ahora" button is hidden when a reason is shown.

### Sites it has been run against

viabcp.com, interbank.pe, bbva.pe (Alloy + Launch, the reference set) and, with/without-extension comparison, americanexpress.com, redhat.com, lenovo.com, nvidia.com, cloudflare.com, elpais.com, pwc.com, whirlpool.com, ibm.com, infosys.com, canada.ca, allianz.com, aboutamazon.com, bankofamerica.com: zero new page errors, zero leaked globals, zero popup errors. Five of them run **at.js** (allianz 2.10.2, canada 2.11.4, infosys 2.11.7, pwc 2.9.0, whirlpool 2.10.2) — Launch/Eventos work there, Actividades only explains it. Heaviest Launch properties: nvidia.com (313 rules, ~890KB of storage per load) and lenovo.com (318 rules, ~660KB), still far from the 10MB quota.

### Rendering state (`getRenderState`, Actividades)

Per activity ID: `rendering-started` → *Sin confirmar* until `rendering-succeeded` (→ *Renderizada*) or `rendering-failed` (→ *Falló el render*, error in the tooltip). An activity that never appears gets *Sin render automático* — but only when at least one rendering event was captured; with none (capture started late, or old SDK) no badge is shown, since nothing is known. On bbva.pe the named-scope activities of the second instance correctly show *Sin render automático* (the page applies them). Prehiding (`hide-containers` → `show-containers`) becomes a note above the list with the hidden time in ms, or a warning if content is still hidden.

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

### mBox classification (`mboxSectionHtml`, a section of Actividades)

mBoxes used to be its own tab. It was empty or one row on all 17 sites tested and it was what pushed "Launch" off-screen at 380px, so it is now a collapsible `<details class="mbox-section">` rendered by `renderMboxDock` into `#mbox-dock`, a strip fixed **below** the Actividades list (not inside it: at the end of a scrolling list nobody found it — the user reported "no veo los mbox"). Closed by default, its summary always visible; opened, its rows scroll on their own (`.mbox-section__rows`, max 38vh). It is shown under the empty states too (e.g. free `[data-mbox]` with no Target response). On 100% VEC pages it still shows, as a static line saying the page uses no named mboxes — omitting it entirely made the feature look removed; it renders nothing only when there are no Target responses either. Open state lives in `mboxSectionOpen`; `setBlocked`/`showStale` empty the dock.

Cross-references the DOM set (`domMboxes`) against the responded set (scopes Target answered):

- **En uso** — in DOM *and* Target responded (green: the good outcome).
- **Libre** — in DOM, no Target response (neutral, not green — it is not a success).
- **Solo Alloy** — Target responded but no `[data-mbox]` element (e.g. VEC/decisionScope-only).

The summary in the section header uses the same three categories, so "en uso" + "libres" always equals the DOM count. Each scope lists **every** activity that answered on it (it used to keep only the first, and bbva.pe showed an activity different from the two Actividades listed for the same scope).

**"mbox" vs. "decision scope" — same concept, two names.** Sites on Web SDK (Alloy) are where Adobe renamed the legacy "mbox" to "decision scope" — they're the same thing under different SDKs/eras. Many front-ends still use the `mbox` convention in the DOM (`[data-mbox]`), while Alloy requests/responds in terms of scopes. This extension straddles both worlds on purpose: `domMboxes` is what we scan from the DOM (the `mbox` side), and `decisionScopes`/`scope` in the Alloy payload is what Target actually requested/answered (the "decision scope" side). The **Alloy** category above exists specifically for scopes Target answered that have no matching `[data-mbox]` element, and `__view__` is the special scope the VEC (Visual Experience Composer) uses. Don't "unify" this terminology later — collapsing it loses the distinction the classification logic depends on.

### Impression notified (Actividades)

Target counts an impression only when Alloy notifies the display (`decisioning.propositionDisplay`, or propositions inside another event's `_experience.decisioning` — `summarizeHitBody` in content.js collects both into `displayedActivities`). When hits were captured in this load, each rendered activity says "impresión notificada" or counts toward a warn note ("N actividades renderizadas no notificaron el display…", with a "Ver Hits" button). Without hits nothing is claimed — "not notified" would be false if capture started late. bbva.pe is the real case: 3 rendered activities, `sendDisplayEvent: false`, zero notifications in the load.

### Cross-tab shortcuts and live rendering

Any `[data-goto="<tab>"]` button activates that tab (diagnoses say "Abre Hits", the display note has "Ver Hits"). Live re-renders go through `scheduleLiveRender`: at most one paint per tab every `LIVE_RENDER_MS` (400ms), first paint of a burst immediate, last one always painted.

### Launch code lives outside `launchRules`

The code/settings of each rule's conditions and actions is stored under its own key `launchCode:<rule.key>` → `{ c: [...], a: [...] }`, written only when it changes; `launchRules` keeps only metadata (`codeLength`, `codeTruncated`), and `launchCodeKeys` indexes the keys so content.js can remove them on every load reset. content.js also keeps the code in memory (`launchCodeMem`): dedup of conditions compares code without reading storage, and a rule re-created after Limpiar gets its actions back (inject.js only sends actions once per rule+status). The popup reads code lazily (`loadCode` on open/copy, `loadAllLaunchCode` only while a search is active) and keeps `launchCodeCache` fresh from `storage.onChanged` newValues. Measured on nvidia.com: `launchRules` went from ~890KB to ~180KB; on a real page load the popup's long tasks were the same before and after (~60–190ms total), so the gain is smaller writes on every rule that fires after load, not a fix of visible jank — an earlier "~1s re-render" figure came from a synthetic forced rewrite and did not reproduce in a real load.

## Gotchas

- `popup.js` hard-codes DOM IDs/classes it expects from `popup.html`: `#list`, `#count`, `#page-url`, `#ts`, `#clear`, `#tenant-input`, `#edge-info`, `#toast`/`#toast-text`/`#toast-action`, `#launch-info`, `#launch-list`, `#launch-filters`, `#launch-search`/`#launch-search-bar`, `#hits-list`, `#hits-summary`, `#mbox-dock`, `.tabs__item[data-tab]` (real `<button role="tab">`s — keyboard nav lives in `activateTab`), `.panel`, `.url-bar__indicator` (state via `--ok/--warn/--error` modifiers, set by `setIndicator`, never inline styles). Renaming in the HTML silently breaks rendering (e.g. `#tenant-input` is read by `setupTenantInput`).
- Every captured value interpolated into `innerHTML` goes through `escapeHtml` (which also escapes quotes, since values land in `title`/`href`/`data-*` attributes). The extension runs on arbitrary sites and the page controls activity names, scopes, mbox names and event payloads — MV3's CSP blocks inline scripts but not injected links/iframes/forms. Don't add a template interpolation of payload data without it.
- Colors, type sizes and fonts are tokens on `:root` in `popup.html` (semantic names: `--ink-3`, `--type-ab`, `--danger`…). Every text/background pair was measured at ≥4.5:1, and the type floor is 11px — add new UI through the tokens, not raw hex or smaller sizes.
- Fonts are bundled (`assets/fonts/`, IBM Plex latin subset, OFL license alongside) and declared with `@font-face` in `popup.html` — the window makes no external requests. Don't reintroduce the Google Fonts `<link>`.
- "Página no inspeccionable" / "pestaña cerrada" are a terminal state (`blockedState`, set via `setBlocked`): every render function starts with `showBlockedIn(listId)` and bails if it's set, so all four tabs show the notice and live updates from other tabs can't paint over it. A new render function needs the same guard.
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
