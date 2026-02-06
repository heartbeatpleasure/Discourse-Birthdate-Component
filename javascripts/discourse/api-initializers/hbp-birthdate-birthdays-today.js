import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";
import I18n from "I18n";
import * as getUrlMod from "discourse-common/lib/get-url";

// getURL compat (named vs default export)
const _getURL = getUrlMod?.getURL || getUrlMod?.default;

function safeGetURL(path) {
  try {
    if (typeof _getURL === "function") return _getURL(path);
  } catch (_) {}
  return path || "";
}

// Theme settings (global `settings` in theme components)
function sObj() {
  // eslint-disable-next-line no-undef
  return typeof settings === "object" && settings ? settings : {};
}

function sBool(key, fallback) {
  const v = sObj()[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return fallback;
}

function sInt(key, fallback) {
  const v = parseInt(sObj()[key], 10);
  return Number.isFinite(v) ? v : fallback;
}

function sStr(key, fallback) {
  const v = sObj()[key];
  return typeof v === "string" && v.trim().length ? v.trim() : fallback;
}

// Robust i18n lookup (themePrefix + js.*)
function t(key, fallback = "") {
  const candidates = [];
  try {
    // eslint-disable-next-line no-undef
    if (typeof themePrefix === "function") {
      // eslint-disable-next-line no-undef
      candidates.push(themePrefix(key));
    }
  } catch (_) {}

  candidates.push(`js.${key}`);
  candidates.push(key);

  for (const k of candidates) {
    try {
      const v = I18n.t(k);
      if (v && !String(v).startsWith("[")) return v;
    } catch (_) {}
  }

  return fallback;
}

function clear(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

function holderPlacement(el) {
  const p = el?.dataset?.hbpPlacement;
  if (p === "sidebar" || p === "sidebar-footer") return "sidebar";
  return "home";
}

function getUsername(user) {
  // Prefer the canonical username (preserves case) for `data-user-card`
  const raw = user?.username || user?.username_lower;
  if (!raw) return null;
  return String(raw).trim();
}

function getUsernameLower(user) {
  // Always use lowercase in profile URLs
  const raw = user?.username_lower || user?.username;
  if (!raw) return null;
  return String(raw).toLowerCase();
}

function avatarSrc(user, size) {
  const tpl = user?.avatar_template;
  if (!tpl) return "";
  return safeGetURL(String(tpl).replace("{size}", String(size)));
}

function profileHref(usernameLower) {
  // Always use lowercase in URL
  return safeGetURL(`/u/${encodeURIComponent(usernameLower)}`);
}

// --- User card opener (robust) ---
// Some Discourse builds don't expose `discourse/lib/show-user-card` to themes.
// So we use multiple fallbacks:
// 1) trigger appEvents (card:show / user-card:show)
// 2) "proxy click" inside #main-outlet so core's delegated handlers pick it up.

let _appEvents = null;

function setAppEventsFromApi(api) {
  try {
    _appEvents =
      api?.container?.lookup?.("service:app-events") ||
      api?.container?.lookup?.("app-events:main") ||
      null;
  } catch (_) {
    _appEvents = null;
  }
}

function tryTriggerUserCard(username, targetEl, originalEvent) {
  if (!_appEvents || typeof _appEvents.trigger !== "function") return false;

  let ok = false;
  try {
    _appEvents.trigger("card:show", username, targetEl, originalEvent);
    ok = true;
  } catch (_) {}

  try {
    _appEvents.trigger("user-card:show", { username });
    ok = true;
  } catch (_) {}

  return ok;
}

let _userCardProxy = null;

function ensureUserCardProxy() {
  if (_userCardProxy && document.contains(_userCardProxy)) return _userCardProxy;

  const a = document.createElement("a");
  a.id = "hbp-birthdays-usercard-proxy";
  a.setAttribute("aria-hidden", "true");
  a.tabIndex = -1;
  a.style.position = "fixed";
  a.style.left = "-9999px";
  a.style.top = "-9999px";
  a.style.width = "1px";
  a.style.height = "1px";
  a.style.opacity = "0";
  a.style.pointerEvents = "none";
  a.style.zIndex = "999999";

  const host =
    document.getElementById("main-outlet") ||
    document.getElementById("whos-online") ||
    document.body;
  host.appendChild(a);

  _userCardProxy = a;
  return a;
}

function proxyClickUserCard(username, href, sourceEl) {
  const a = ensureUserCardProxy();

  a.setAttribute("data-user-card", username);
  a.setAttribute("title", username);
  a.href = href;

  // Position the proxy at the avatar location so the card anchors nicely.
  try {
    const r = sourceEl?.getBoundingClientRect?.();
    if (r) {
      a.style.left = `${Math.max(0, r.left)}px`;
      a.style.top = `${Math.max(0, r.top)}px`;
      a.style.width = `${Math.max(1, r.width)}px`;
      a.style.height = `${Math.max(1, r.height)}px`;
    }
  } catch (_) {}

  try {
    a.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
    );
    return true;
  } catch (_) {
    return false;
  }
}

function openUserCard(username, href, sourceEl, originalEvent) {
  const ok1 = tryTriggerUserCard(username, sourceEl, originalEvent);
  const ok2 = proxyClickUserCard(username, href, sourceEl);
  return ok1 || ok2;
}

// Track whether the user card actually opened (DOM changes)
let _userCardMutatedAt = 0;
let _userCardObsInstalled = false;

function installUserCardMutationObserver() {
  if (_userCardObsInstalled) return;
  _userCardObsInstalled = true;

  const attach = () => {
    const el = document.getElementById("user-card");
    if (!el || el.__hbpBirthdaysObserved) return;

    el.__hbpBirthdaysObserved = true;
    const obs = new MutationObserver(() => {
      _userCardMutatedAt = Date.now();
    });

    obs.observe(el, { childList: true, subtree: true, attributes: true });
  };

  attach();

  // In case the card element isn't ready yet
  const bodyObs = new MutationObserver(() => attach());
  bodyObs.observe(document.body, { childList: true, subtree: true });
}

function isUserCardVisible() {
  const el = document.getElementById("user-card");
  if (!el) return false;

  try {
    const s = window.getComputedStyle(el);
    if (!s) return false;
    if (s.display === "none") return false;
    if (s.visibility === "hidden") return false;

    const op = parseFloat(s.opacity || "1");
    if (Number.isFinite(op) && op <= 0.01) return false;

    const r = el.getBoundingClientRect?.();
    if (r && (r.width <= 1 || r.height <= 1)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function buildAvatarLink(user, size) {
  const username = getUsername(user);
  const usernameLower = getUsernameLower(user);
  if (!username || !usernameLower) return null;

  const displayName = (user?.name || username).trim();

  const a = document.createElement("a");
  a.className = "hbp-birthdays-online__user trigger-user-card";
  a.href = profileHref(usernameLower);
  a.setAttribute("data-user-card", username);
  a.title = displayName;

  const img = document.createElement("img");
  img.className = "hbp-birthdays-online__avatar avatar";
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = displayName;
  img.src = avatarSrc(user, size);
  img.setAttribute("data-user-card", username);

  a.appendChild(img);
  return a;
}

function renderRow(holder, payload, placement) {
  const users = Array.isArray(payload?.users) ? payload.users : [];
  const total = typeof payload?.total === "number" ? payload.total : users.length;

  const hideIfEmpty = sBool("birthdays_widget_hide_if_empty", false);
  if (hideIfEmpty && users.length === 0) {
    clear(holder);
    return;
  }

  const labelFromSetting = sStr("birthdays_widget_label", "");
  const label =
    labelFromSetting || t("hbp_birthdate.birthdays_today_title", "Today's birthdays");

  const maxUsers = Math.max(1, sInt("birthdays_widget_max_users", 8));
  const avatarSize = placement === "sidebar" ? 32 : 48;

  const root = document.createElement("div");
  root.className = `hbp-birthdays-online hbp-birthdays-online--${placement}`;

  const labelEl = document.createElement("span");
  labelEl.className = "hbp-birthdays-online__label";
  labelEl.textContent = label;

  const countEl = document.createElement("span");
  countEl.className = "hbp-birthdays-online__count";
  countEl.textContent = users.length ? `(${total || 0}):` : `(${total || 0})`;

  root.appendChild(labelEl);
  root.appendChild(countEl);

  if (users.length === 0) {
    const emptyEl = document.createElement("span");
    emptyEl.className = "hbp-birthdays-online__empty";
    emptyEl.textContent = t("hbp_birthdate.birthdays_today_none", "No birthdays today");
    root.appendChild(emptyEl);
  } else {
    const list = document.createElement("span");
    list.className = "hbp-birthdays-online__list";

    const visible = users.slice(0, maxUsers);
    for (const u of visible) {
      const av = buildAvatarLink(u, avatarSize);
      if (av) list.appendChild(av);
    }

    if (users.length > visible.length) {
      const more = document.createElement("span");
      more.className = "hbp-birthdays-online__more";
      more.textContent = `+${users.length - visible.length}`;
      list.appendChild(more);
    }

    root.appendChild(list);
  }

  clear(holder);
  holder.appendChild(root);
}

let cachePayload = null;
let cacheDay = null;
let cachePromise = null;

function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

function loadBirthdaysToday() {
  const key = todayKey();
  if (cachePayload && cacheDay === key) return Promise.resolve(cachePayload);
  if (cachePromise && cacheDay === key) return cachePromise;

  cacheDay = key;
  const endpoint = sStr("birthdays_widget_endpoint", "/hbp/birthdays/today.json");

  cachePromise = ajax(endpoint)
    .then((payload) => {
      cachePayload = payload;
      return payload;
    })
    .catch((e) => {
      console.warn("[hbp-birthdate] birthdays fetch failed", e);
      return cachePayload || { users: [], total: 0 };
    })
    .finally(() => {
      cachePromise = null;
    });

  return cachePromise;
}

function updateAll() {
  const enabled = sBool("birthdays_widget_enabled", explainedDefault(true));
  const showTop = sBool("birthdays_widget_show_top", true);
  const showSidebar = sBool("birthdays_widget_show_sidebar", true);

  const holders = Array.from(document.querySelectorAll("[data-hbp-birthdays-today]"));
  if (!holders.length) return;

  if (!enabled) {
    holders.forEach((el) => clear(el));
    return;
  }

  const homeHolders = holders.filter((h) => holderPlacement(h) === "home");
  const sidebarHolders = holders.filter((h) => holderPlacement(h) === "sidebar");

  if (!showTop) homeHolders.forEach((el) => clear(el));
  if (!showSidebar) sidebarHolders.forEach((el) => clear(el));

  if (!showTop && !showSidebar) return;

  loadBirthdaysToday().then((payload) => {
    try {
      if (showTop) homeHolders.forEach((el) => renderRow(el, payload, "home"));

      if (showSidebar && sidebarHolders.length) {
        renderRow(sidebarHolders[0], payload, "sidebar");
        sidebarHolders.slice(1).forEach((el) => clear(el));
      }
    } catch (e) {
      console.warn("[hbp-birthdate] birthdays render failed", e);
    }
  });
}

function explainedDefault(v) {
  return v;
}

// Install one delegated click handler for our birthdays row
let _clickHandlerInstalled = false;
function installUserCardClickHandler() {
  if (_clickHandlerInstalled) return;
  _clickHandlerInstalled = true;

  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented) return;
      if (e.button && e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target;
      if (!target) return;

      const link = target.closest?.(".hbp-birthdays-online a[data-user-card]");
      if (!link) return;

      const username = String(link.getAttribute("data-user-card") || "").trim();
      const href = String(link.getAttribute("href") || "").trim();
      if (!username || !href) return;

      e.preventDefault();
      e.stopPropagation();

      installUserCardMutationObserver();
      const mutatedBefore = _userCardMutatedAt;

      const sourceEl = link.querySelector?.("img") || link;
      openUserCard(username, href, sourceEl, e);

      window.setTimeout(() => {
        if (isUserCardVisible()) return;
        if (_userCardMutatedAt === mutatedBefore) {
          try {
            window.location.assign(href);
          } catch (_) {}
        }
      }, 1200);
    },
    true
  );
}

export default apiInitializer("0.11.1", (api) => {
  setAppEventsFromApi(api);
  installUserCardMutationObserver();
  installUserCardClickHandler();

  updateAll();
  api.onPageChange(() => updateAll());

  // connectors can appear async
  let tmr = null;
  const schedule = () => {
    if (tmr) return;
    tmr = setTimeout(() => {
      tmr = null;
      updateAll();
    }, 50);
  };

  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes || []) {
        if (!(node instanceof HTMLElement)) continue;
        if (
          node.matches?.("[data-hbp-birthdays-today]") ||
          node.querySelector?.("[data-hbp-birthdays-today]")
        ) {
          schedule();
          return;
        }
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
});
