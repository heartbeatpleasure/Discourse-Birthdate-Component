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

function displayNameFor(user) {
  const username = getUsername(user) || "";
  const name = typeof user?.name === "string" ? user.name.trim() : "";
  return name || username;
}

// --- User card opener (robust) ---
// Some Discourse builds don't expose `discourse/lib/show-user-card` to themes.
// So we use multiple fallbacks:
// 1) trigger appEvents (card:show / user-card:show)
// 2) "proxy click" inside #main-outlet so core's delegated handlers pick it up.

let _appEvents = null;

function setAppEventsFromApi(api) {
  try {
    // Avoid the legacy `app-events:main` alias.
    // `service:app-events` is the supported lookup.
    _appEvents = api?.container?.lookup?.("service:app-events") || null;
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

function proxyClickUserCard(username, href, sourceEl, focusReturnEl) {
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

    // Keep focus on the real, visible trigger instead of the invisible proxy.
    window.requestAnimationFrame(() => {
      try {
        if (document.activeElement === a) {
          a.blur();
        }
      } catch (_) {}

      try {
        if (
          focusReturnEl &&
          document.contains(focusReturnEl) &&
          typeof focusReturnEl.focus === "function"
        ) {
          focusReturnEl.focus({ preventScroll: true });
        }
      } catch (_) {}
    });

    return true;
  } catch (_) {
    return false;
  }
}

function openUserCard(username, href, sourceEl, originalEvent, focusReturnEl) {
  const ok1 = tryTriggerUserCard(username, sourceEl, originalEvent);
  const ok2 = proxyClickUserCard(username, href, sourceEl, focusReturnEl || sourceEl);
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

  const displayName = displayNameFor(user);

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

function buildOverlayUserLink(user) {
  const username = getUsername(user);
  const usernameLower = getUsernameLower(user);
  if (!username || !usernameLower) return null;

  const displayName = displayNameFor(user);
  const href = profileHref(usernameLower);

  const a = document.createElement("a");
  a.className = "hbp-birthdays-overlay__user trigger-user-card";
  a.href = href;
  a.setAttribute("data-user-card", username);
  a.title = displayName;

  const img = document.createElement("img");
  img.className = "hbp-birthdays-overlay__avatar avatar";
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = "";
  img.src = avatarSrc(user, 64);
  img.setAttribute("data-user-card", username);

  const text = document.createElement("span");
  text.className = "hbp-birthdays-overlay__user-text";

  const nameEl = document.createElement("span");
  nameEl.className = "hbp-birthdays-overlay__name";
  nameEl.textContent = displayName;

  const usernameEl = document.createElement("span");
  usernameEl.className = "hbp-birthdays-overlay__username";
  usernameEl.textContent = `@${username}`;

  text.appendChild(nameEl);
  text.appendChild(usernameEl);

  a.appendChild(img);
  a.appendChild(text);
  return a;
}

let _birthdaysOverlay = null;
let _birthdaysOverlayTrigger = null;
let _birthdaysOverlayPositionHandler = null;
let _birthdaysOverlayKeyHandler = null;
let _birthdaysOverlayId = 0;
let _birthdaysOverlayPositionRaf = null;

function isNarrowViewport() {
  try {
    return (
      window.matchMedia?.("(max-width: 767px)")?.matches ||
      window.innerWidth < 768
    );
  } catch (_) {
    return false;
  }
}

function positionBirthdaysOverlay() {
  if (!_birthdaysOverlay || !_birthdaysOverlayTrigger) return;

  const panel = _birthdaysOverlay.querySelector(".hbp-birthdays-overlay__panel");
  if (!panel) return;

  if (!document.contains(_birthdaysOverlayTrigger)) {
    closeBirthdaysOverlay({ restoreFocus: false });
    return;
  }

  if (isNarrowViewport()) {
    panel.style.left = "";
    panel.style.top = "";
    panel.style.width = "";
    return;
  }

  try {
    const triggerRect = _birthdaysOverlayTrigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || 0;
    const margin = 12;
    const width = Math.min(380, Math.max(280, viewportWidth - margin * 2));

    panel.style.width = `${width}px`;
    panel.style.left = "0px";
    panel.style.top = "0px";

    const panelRect = panel.getBoundingClientRect();
    let left = triggerRect.left;
    let top = triggerRect.bottom + 8;

    left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

    if (top + panelRect.height > viewportHeight - margin) {
      top = triggerRect.top - panelRect.height - 8;
    }
    if (top < margin) top = margin;

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  } catch (_) {}
}

function scheduleBirthdaysOverlayPosition() {
  if (_birthdaysOverlayPositionRaf) return;
  _birthdaysOverlayPositionRaf = window.requestAnimationFrame(() => {
    _birthdaysOverlayPositionRaf = null;
    positionBirthdaysOverlay();
  });
}

function installBirthdaysOverlayListeners() {
  if (!_birthdaysOverlayPositionHandler) {
    _birthdaysOverlayPositionHandler = () => scheduleBirthdaysOverlayPosition();
  }

  if (!_birthdaysOverlayKeyHandler) {
    _birthdaysOverlayKeyHandler = (e) => {
      if (e.key === "Escape" || e.key === "Esc") {
        closeBirthdaysOverlay();
      }
    };
  }

  window.addEventListener("resize", _birthdaysOverlayPositionHandler, { passive: true });
  window.addEventListener("scroll", _birthdaysOverlayPositionHandler, {
    passive: true,
    capture: true,
  });
  document.addEventListener("keydown", _birthdaysOverlayKeyHandler, true);
}

function removeBirthdaysOverlayListeners() {
  if (_birthdaysOverlayPositionHandler) {
    window.removeEventListener("resize", _birthdaysOverlayPositionHandler);
    window.removeEventListener("scroll", _birthdaysOverlayPositionHandler, true);
  }

  if (_birthdaysOverlayKeyHandler) {
    document.removeEventListener("keydown", _birthdaysOverlayKeyHandler, true);
  }

  if (_birthdaysOverlayPositionRaf) {
    window.cancelAnimationFrame(_birthdaysOverlayPositionRaf);
    _birthdaysOverlayPositionRaf = null;
  }
}

function closeBirthdaysOverlay(options = {}) {
  const restoreFocus = options.restoreFocus !== false;
  const overlay = _birthdaysOverlay;
  const trigger = _birthdaysOverlayTrigger;

  removeBirthdaysOverlayListeners();

  _birthdaysOverlay = null;
  _birthdaysOverlayTrigger = null;

  if (trigger) {
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-controls");
  }

  try {
    overlay?.remove?.();
  } catch (_) {}

  if (
    restoreFocus &&
    trigger &&
    document.contains(trigger) &&
    typeof trigger.focus === "function"
  ) {
    try {
      trigger.focus({ preventScroll: true });
    } catch (_) {}
  }
}

function openBirthdaysOverlay({ users, total, label, trigger }) {
  if (!trigger || !Array.isArray(users) || users.length === 0) return;

  if (_birthdaysOverlay && _birthdaysOverlayTrigger === trigger) {
    closeBirthdaysOverlay();
    return;
  }

  closeBirthdaysOverlay({ restoreFocus: false });

  const overlayId = `hbp-birthdays-overlay-${++_birthdaysOverlayId}`;
  const count = typeof total === "number" ? total : users.length;
  const closeLabel = t("hbp_birthdate.birthdays_today_close", "Close birthdays");

  const overlay = document.createElement("div");
  overlay.className = "hbp-birthdays-overlay";

  const scrim = document.createElement("button");
  scrim.type = "button";
  scrim.className = "hbp-birthdays-overlay__scrim";
  scrim.tabIndex = -1;
  scrim.setAttribute("aria-label", closeLabel);
  scrim.addEventListener("click", () => closeBirthdaysOverlay());

  const panel = document.createElement("div");
  panel.className = "hbp-birthdays-overlay__panel";
  panel.id = overlayId;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", `${overlayId}-title`);
  panel.tabIndex = -1;

  const header = document.createElement("div");
  header.className = "hbp-birthdays-overlay__header";

  const title = document.createElement("h3");
  title.className = "hbp-birthdays-overlay__title";
  title.id = `${overlayId}-title`;
  title.textContent = `${label} (${count || 0})`;

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "hbp-birthdays-overlay__close";
  closeButton.setAttribute("aria-label", closeLabel);
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => closeBirthdaysOverlay());

  header.appendChild(title);
  header.appendChild(closeButton);

  const body = document.createElement("div");
  body.className = "hbp-birthdays-overlay__body";

  const list = document.createElement("div");
  list.className = "hbp-birthdays-overlay__list";

  for (const user of users) {
    const link = buildOverlayUserLink(user);
    if (!link) continue;
    list.appendChild(link);
  }

  body.appendChild(list);
  panel.appendChild(header);
  panel.appendChild(body);
  overlay.appendChild(scrim);
  overlay.appendChild(panel);

  document.body.appendChild(overlay);

  _birthdaysOverlay = overlay;
  _birthdaysOverlayTrigger = trigger;

  trigger.setAttribute("aria-expanded", "true");
  trigger.setAttribute("aria-controls", overlayId);

  installBirthdaysOverlayListeners();
  positionBirthdaysOverlay();

  window.requestAnimationFrame(() => {
    try {
      closeButton.focus({ preventScroll: true });
    } catch (_) {}
  });
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
      const hiddenCount = users.length - visible.length;
      const moreLabel = `${t(
        "hbp_birthdate.birthdays_today_show_all",
        "Show all birthdays"
      )} (${total || users.length})`;

      const more = document.createElement("button");
      more.type = "button";
      more.className = "hbp-birthdays-online__more";
      more.textContent = `+${hiddenCount}`;
      more.setAttribute("aria-haspopup", "dialog");
      more.setAttribute("aria-expanded", "false");
      more.setAttribute("aria-label", moreLabel);
      more.title = moreLabel;
      more.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openBirthdaysOverlay({ users, total, label, trigger: more });
      });
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

      const link = target.closest?.(
        ".hbp-birthdays-online a[data-user-card], .hbp-birthdays-overlay a[data-user-card]"
      );
      if (!link) return;

      const username = String(link.getAttribute("data-user-card") || "").trim();
      const href = String(link.getAttribute("href") || "").trim();
      if (!username || !href) return;

      e.preventDefault();
      e.stopPropagation();

      installUserCardMutationObserver();
      const mutatedBefore = _userCardMutatedAt;

      const sourceEl = link.querySelector?.("img") || link;
      const inBirthdaysOverlay = Boolean(link.closest?.(".hbp-birthdays-overlay"));
      const focusReturnEl = inBirthdaysOverlay ? _birthdaysOverlayTrigger || link : link;

      openUserCard(username, href, sourceEl, e, focusReturnEl);

      if (inBirthdaysOverlay) {
        // Avoid stacking the birthday list overlay on top of Discourse's user card
        // (and its birthday confetti). The user card has already been triggered
        // and the invisible proxy has been positioned at this click target.
        window.requestAnimationFrame(() =>
          closeBirthdaysOverlay({ restoreFocus: false })
        );
      }

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
  api.onPageChange(() => {
    closeBirthdaysOverlay({ restoreFocus: false });
    updateAll();
  });

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
