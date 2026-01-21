import { apiInitializer } from "discourse/lib/api";
import I18n from "I18n";

const DEBUG = false;

const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Keep anchor state per <details>
const ANCHORS = new WeakMap();

function text(el) {
  return (el?.textContent || "").trim();
}

/**
 * Try multiple translation namespaces:
 * - themePrefix("hbp_birthdate.day")  (theme component translations)
 * - "js.hbp_birthdate.day"           (core js namespace)
 * - "hbp_birthdate.day"              (plain)
 */
function t(key, fallback = "") {
  const candidates = [];

  try {
    if (typeof themePrefix === "function") {
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

function setNiceLabel(fieldEl, key, fallback) {
  const labelEl = fieldEl.querySelector("label.control-label");
  if (!labelEl) return;

  const nice = t(key, fallback);
  if (nice) labelEl.textContent = nice;

  fieldEl.classList.add("hbp-birthdate-field");
}

function monthFromValue(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(0?[1-9]|1[0-2])$/);
  if (!m) return null;
  const n = parseInt(s, 10);
  return MONTHS_EN[n - 1] || null;
}

function getFieldValue(fieldEl, detailsEl) {
  const nativeSelect = fieldEl.querySelector("select");
  if (nativeSelect) return nativeSelect.value ?? "";

  const hidden = detailsEl.querySelector('input[type="hidden"]');
  if (hidden) return hidden.value ?? "";

  const v1 = detailsEl.getAttribute("data-value");
  if (v1 !== null && v1 !== undefined) return v1;

  const v2 = detailsEl.dataset?.value;
  if (v2 !== null && v2 !== undefined) return v2;

  const summary = detailsEl.querySelector("summary");
  const v3 = summary?.getAttribute?.("data-value");
  if (v3 !== null && v3 !== undefined) return v3;

  const v4 = summary?.dataset?.value;
  if (v4 !== null && v4 !== undefined) return v4;

  return "";
}

function getHeaderNameEl(details) {
  return (
    details.querySelector(".select-kit-selected-name .name") ||
    details.querySelector(".select-kit-selected-name") ||
    null
  );
}

function setHeaderLabel(details, label) {
  const nameEl = getHeaderNameEl(details);
  if (!nameEl) return;
  if (text(nameEl) !== label) nameEl.textContent = label;
}

function relabelEmptyOption(bodyEl, desiredSelectLabel) {
  if (!bodyEl) return;

  const selectors = [
    '.select-kit-row[data-value=""] .name',
    '.select-kit-row[data-value=""]',
    '.select-kit-row.is-none .name',
    '.select-kit-row.is-none',
    'li[data-value=""] .name',
    'li[data-value=""]',
  ];

  for (const sel of selectors) {
    const el = bodyEl.querySelector(sel);
    if (el) {
      if (el.classList?.contains("select-kit-row") || el.tagName === "LI") {
        const name = el.querySelector?.(".name");
        if (name) name.textContent = desiredSelectLabel;
        else el.textContent = desiredSelectLabel;
      } else {
        el.textContent = desiredSelectLabel;
      }
      return;
    }
  }

  bodyEl.querySelectorAll(".select-kit-row, li").forEach((row) => {
    const rowText = text(row);
    if (
      rowText === "(select an option)" ||
      rowText.toLowerCase() === "select an option"
    ) {
      const name = row.querySelector?.(".name");
      if (name) name.textContent = desiredSelectLabel;
      else row.textContent = desiredSelectLabel;
    }
  });
}

function getTriggerEl(details) {
  return (
    details.querySelector(".select-kit-header") ||
    details.querySelector(".select-kit-header-wrapper") ||
    details.querySelector("summary") ||
    details
  );
}

function isVisible(el) {
  if (!el) return false;
  const cs = window.getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function normalizeBodyEl(el) {
  if (!el) return null;
  if (el.classList?.contains("select-kit-collection")) {
    return el.closest(".select-kit-body") || el.parentElement || el;
  }
  const body = el.closest?.(".select-kit-body");
  return body || el;
}

function findOpenBody(details) {
  // 1) Most reliable: inside this details
  const inside =
    details.querySelector(".select-kit-body.is-expanded") ||
    details.querySelector(".select-kit-body");
  if (inside && isVisible(inside)) return normalizeBodyEl(inside);

  // 2) aria-controls linkage (if present)
  const trigger = getTriggerEl(details);
  const ctrlId =
    trigger?.getAttribute?.("aria-controls") ||
    details.querySelector("[aria-controls]")?.getAttribute?.("aria-controls");
  if (ctrlId) {
    const target = document.getElementById(ctrlId);
    if (target) {
      const norm = normalizeBodyEl(target);
      if (norm && isVisible(norm)) return norm;
    }
  }

  // 3) Fallback: choose the closest *expanded* body in the document
  const tr = trigger.getBoundingClientRect();
  const candidates = Array.from(
    document.querySelectorAll(
      ".select-kit-body.is-expanded, .select-kit-body[aria-hidden='false'], .select-kit-collection.is-expanded"
    )
  )
    .map(normalizeBodyEl)
    .filter((el) => el && isVisible(el));

  let best = null;
  let bestScore = Infinity;

  candidates.forEach((b) => {
    const br = b.getBoundingClientRect();
    const score =
      Math.abs(br.top - tr.bottom) + Math.abs(br.left - tr.left) * 0.7;
    if (score < bestScore) {
      bestScore = score;
      best = b;
    }
  });

  if (best) return best;

  // 4) Last resort: any visible select-kit body
  const any = Array.from(
    document.querySelectorAll(".select-kit-body, .select-kit-collection")
  )
    .map(normalizeBodyEl)
    .find((el) => el && isVisible(el));

  return any || null;
}

function isVisiblyMisaligned(body, triggerRect, expectedWidth) {
  const br = body.getBoundingClientRect();
  const leftDiff = Math.abs(br.left - triggerRect.left);
  const widthDiff = Math.abs(br.width - expectedWidth);

  // Vertical: accept either "below" or "flipped above".
  const expectedBelowTop = triggerRect.bottom;
  const expectedAboveTop = triggerRect.top - br.height;
  const topDiff = Math.min(
    Math.abs(br.top - expectedBelowTop),
    Math.abs(br.top - expectedAboveTop)
  );

  return leftDiff > 12 || widthDiff > 16 || topDiff > 14;
}

function clearManualStyles(body) {
  body.classList.remove("hbp-birthdate-dropdown--manual");
  body.style.position = "";
  body.style.left = "";
  body.style.top = "";
  body.style.right = "";
  body.style.bottom = "";
  body.style.inset = "";
  body.style.transform = "";
  body.style.marginLeft = "";
  body.style.maxHeight = "";
  body.style.overflowY = "";
  body.style.width = "";
  body.style.minWidth = "";
  body.style.maxWidth = "";
  body.style.boxSizing = "";
}

function applyWidthToTrigger(body, details) {
  const trigger = getTriggerEl(details);
  const rect = trigger.getBoundingClientRect();
  const width = Math.max(160, Math.round(rect.width));

  body.classList.add("hbp-birthdate-dropdown");
  body.style.boxSizing = "border-box";
  body.style.width = `${width}px`;
  body.style.minWidth = `${width}px`;
  body.style.maxWidth = `${width}px`;

  return { triggerRect: rect, width };
}

// If an element has a transformed ancestor, position:fixed becomes relative to that ancestor.
function findFixedContainingBlock(el) {
  let p = el?.parentElement;
  while (p && p !== document.documentElement) {
    const cs = window.getComputedStyle(p);
    const hasTransform = cs.transform && cs.transform !== "none";
    const hasPerspective = cs.perspective && cs.perspective !== "none";
    const hasFilter = cs.filter && cs.filter !== "none";
    const willChange = (cs.willChange || "").toLowerCase();

    if (
      hasTransform ||
      hasPerspective ||
      hasFilter ||
      willChange.includes("transform") ||
      willChange.includes("perspective")
    ) {
      return p;
    }

    p = p.parentElement;
  }
  return null;
}

function positionDropdownUnderTrigger(details, { force = false } = {}) {
  const body = findOpenBody(details);
  if (!body) return;

  const { triggerRect, width } = applyWidthToTrigger(body, details);

  // The bug (after scrolling, menu opens too low) is a vertical misalignment.
  // Force manual positioning when:
  // - caller requests it (force)
  // - or we can see it's misaligned
  const manual = force || isVisiblyMisaligned(body, triggerRect, width);

  if (!manual) {
    clearManualStyles(body);
    return;
  }

  body.classList.add("hbp-birthdate-dropdown--manual");

  // Force a consistent coordinate system (viewport). This avoids container scroll offsets
  // that can be incorrectly added by select-kit on first open.
  body.style.position = "fixed";
  body.style.transform = "none";
  body.style.inset = "auto";
  body.style.right = "auto";
  body.style.bottom = "auto";
  body.style.marginLeft = "0";

  const padding = 8;

  // Decide flip (up/down)
  const currentRect = body.getBoundingClientRect();
  const bodyHeight = Math.max(40, Math.round(currentRect.height || 0));
  const spaceBelow = window.innerHeight - triggerRect.bottom - padding;
  const spaceAbove = triggerRect.top - padding;
  const openUp = bodyHeight > spaceBelow && spaceAbove > spaceBelow;

  let left = Math.round(triggerRect.left);
  let top = openUp
    ? Math.round(triggerRect.top - bodyHeight)
    : Math.round(triggerRect.bottom);

  // Clamp inside viewport
  const maxLeft = Math.max(padding, window.innerWidth - width - padding);
  left = Math.min(Math.max(left, padding), maxLeft);
  top = Math.max(padding, top);

  // Limit height so it never runs off-screen
  const maxHeight = openUp
    ? Math.max(120, Math.round(triggerRect.top - padding))
    : Math.max(120, Math.round(window.innerHeight - top - padding));
  body.style.maxHeight = `${maxHeight}px`;
  body.style.overflowY = "auto";

  // Handle transformed ancestors (fixed containing block)
  const cb = findFixedContainingBlock(body);
  if (cb) {
    const cbr = cb.getBoundingClientRect();
    left -= Math.round(cbr.left);
    top -= Math.round(cbr.top);
  }

  body.style.left = `${left}px`;
  body.style.top = `${top}px`;
}

function stopAnchor(details) {
  const state = ANCHORS.get(details);
  if (!state) return;

  state.stopped = true;

  if (state.raf) cancelAnimationFrame(state.raf);
  if (state.moveRaf) cancelAnimationFrame(state.moveRaf);
  if (state.observer) state.observer.disconnect();

  if (state.onMove) {
    window.removeEventListener("scroll", state.onMove, true);
    window.removeEventListener("resize", state.onMove);
  }

  // Clean any manual styles that might stick around
  const body = findOpenBody(details);
  if (body) clearManualStyles(body);

  ANCHORS.delete(details);
}

function startAnchor(details, syncOpenList) {
  stopAnchor(details);

  const state = {
    stopped: false,
    raf: null,
    moveRaf: null,
    frames: 0,
    maxFrames: 75, // ~1.25s of "last write wins" positioning
    observer: null,
    observedBody: null,
    onMove: null,
  };

  const schedule = () => {
    if (state.stopped || !details.open) return;
    if (state.moveRaf) return;
    state.moveRaf = requestAnimationFrame(() => {
      state.moveRaf = null;
      syncOpenList(true);
    });
  };

  state.onMove = () => schedule();

  window.addEventListener("scroll", state.onMove, true);
  window.addEventListener("resize", state.onMove);

  const ensureObserver = () => {
    const body = findOpenBody(details);
    if (!body || state.observedBody === body) return;

    if (state.observer) state.observer.disconnect();

    const obs = new MutationObserver(() => {
      // select-kit may rewrite inline styles after open; we re-apply ours.
      schedule();
    });

    obs.observe(body, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    state.observer = obs;
    state.observedBody = body;
  };

  const tick = () => {
    if (state.stopped || !details.open) return;

    ensureObserver();
    syncOpenList(true);

    state.frames++;
    if (state.frames < state.maxFrames) {
      state.raf = requestAnimationFrame(tick);
    } else {
      state.raf = null;
      // After the initial "fight" with late style updates, keep event-driven updates only.
    }
  };

  ANCHORS.set(details, state);

  // Kick off immediately
  state.raf = requestAnimationFrame(tick);
}

function decorateBirthdateSelect(fieldEl, { isMonth = false } = {}) {
  const details = fieldEl.querySelector("details.select-kit");
  if (!details) return;

  const desiredSelect = t("hbp_birthdate.select", "Select");

  const syncHeaderFromValue = () => {
    const rawValue = getFieldValue(fieldEl, details);
    const value = String(rawValue ?? "").trim();

    if (!value) {
      setHeaderLabel(details, desiredSelect);
      return;
    }

    if (isMonth) {
      const label = monthFromValue(value) || value;
      setHeaderLabel(details, label);
    } else {
      setHeaderLabel(details, value);
    }
  };

  const syncOpenList = (force = false) => {
    if (!details.open) return;

    const body = findOpenBody(details);
    if (!body) return;

    relabelEmptyOption(body, desiredSelect);

    if (isMonth) {
      body
        .querySelectorAll(".select-kit-row .name, .select-kit-row, li")
        .forEach((node) => {
          if (node.closest(".select-kit-filter")) return;
          const mapped = monthFromValue(text(node));
          if (mapped) node.textContent = mapped;
        });
    }

    positionDropdownUnderTrigger(details, { force });
  };

  syncHeaderFromValue();

  if (!details.dataset.hbpBirthdateHooked) {
    details.dataset.hbpBirthdateHooked = "1";

    details.addEventListener("toggle", () => {
      syncHeaderFromValue();

      if (details.open) {
        // Start anchoring; this corrects the "open after scroll" bug reliably.
        startAnchor(details, syncOpenList);

        // Also run a few delayed syncs for safety.
        setTimeout(() => syncOpenList(true), 0);
        setTimeout(() => syncOpenList(true), 60);
        setTimeout(() => syncOpenList(true), 180);
        setTimeout(() => syncOpenList(true), 350);
      } else {
        stopAnchor(details);
      }
    });

    details.addEventListener("click", () => {
      // Keep header synced and (if open) re-anchor
      syncHeaderFromValue();
      if (details.open) syncOpenList(true);
    });
  }
}

function isBefore(a, b) {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function firstInDom(nodes) {
  const list = (nodes || []).filter(Boolean);
  if (!list.length) return null;

  let first = list[0];
  for (const n of list.slice(1)) {
    if (n && isBefore(n, first)) first = n;
  }
  return first;
}

/**
 * Heading is optional:
 * - If group_label is empty in Theme translations, we don't render the heading (and thus no spacing)
 */
function ensureBirthdateHeading(groupEl) {
  if (!groupEl) return;
  if (groupEl.querySelector(".hbp-birthdate-group__heading")) return;

  const label = (t("hbp_birthdate.group_label", "Birthdate") || "").trim();
  const helpText = (t("hbp_birthdate.group_help", "") || "").trim();

  // If label is explicitly empty, do not insert heading/subheading at all.
  if (!label) return;

  const heading = document.createElement("div");
  heading.className = "hbp-birthdate-group__heading";
  heading.textContent = label;
  groupEl.insertBefore(heading, groupEl.firstChild);

  if (helpText) {
    const helpEl = document.createElement("div");
    helpEl.className = "hbp-birthdate-group__subheading";
    helpEl.textContent = helpText;
    groupEl.insertBefore(helpEl, heading.nextSibling);
  }
}

function ensureGroupRow(groupEl) {
  let row = groupEl.querySelector(".hbp-birthdate-group__row");
  if (!row) {
    row = document.createElement("div");
    row.className = "hbp-birthdate-group__row";
    groupEl.appendChild(row);
  }
  return row;
}

function needsRowFix(row, day, month, year) {
  if (!row || !day || !month || !year) return false;

  if (day.parentElement !== row) return true;
  if (month.parentElement !== row) return true;
  if (year.parentElement !== row) return true;

  const kids = Array.from(row.children);
  const iD = kids.indexOf(day);
  const iM = kids.indexOf(month);
  const iY = kids.indexOf(year);

  if (iD === -1 || iM === -1 || iY === -1) return true;
  return !(iD < iM && iM < iY);
}

function ensureBirthdateGroup(day, month, year) {
  if (!day || !month || !year) return;

  const existingGroup =
    day.closest(".hbp-birthdate-group") ||
    month.closest(".hbp-birthdate-group") ||
    year.closest(".hbp-birthdate-group");

  if (existingGroup) {
    ensureBirthdateHeading(existingGroup);
    const row = ensureGroupRow(existingGroup);

    if (!needsRowFix(row, day, month, year)) return;

    if (day.parentElement !== row) row.appendChild(day);
    if (month.parentElement !== row) row.appendChild(month);
    if (year.parentElement !== row) row.appendChild(year);

    row.insertBefore(day, month);
    row.insertBefore(month, year);
    return;
  }

  const first = firstInDom([day, month, year]);
  if (!first?.parentNode) return;

  const group = document.createElement("div");
  group.className = "hbp-birthdate-group";

  const row = document.createElement("div");
  row.className = "hbp-birthdate-group__row";

  group.appendChild(row);
  first.parentNode.insertBefore(group, first);

  ensureBirthdateHeading(group);

  row.appendChild(day);
  row.appendChild(month);
  row.appendChild(year);
}

function enhanceRoot(root) {
  const day = root.querySelector(".user-field-hbp_birth_day");
  const month = root.querySelector(".user-field-hbp_birth_month");
  const year = root.querySelector(".user-field-hbp_birth_year");

  if (day && !day.dataset.hbpEnhanced) {
    setNiceLabel(day, "hbp_birthdate.day", "Day");
    day.dataset.hbpEnhanced = "1";
  }

  if (month && !month.dataset.hbpEnhanced) {
    setNiceLabel(month, "hbp_birthdate.month", "Month");
    month.dataset.hbpEnhanced = "1";
  }

  if (year && !year.dataset.hbpEnhanced) {
    setNiceLabel(year, "hbp_birthdate.year", "Year");
    year.dataset.hbpEnhanced = "1";
  }

  if (day) decorateBirthdateSelect(day, { isMonth: false });
  if (month) decorateBirthdateSelect(month, { isMonth: true });
  if (year) decorateBirthdateSelect(year, { isMonth: false });

  ensureBirthdateGroup(day, month, year);

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.info("[hbp-birthdate] enhanced", {
      day: !!day,
      month: !!month,
      year: !!year,
    });
  }
}

function enhance() {
  const roots = new Set();

  document.querySelectorAll(".user-field-hbp_birth_day").forEach((day) => {
    roots.add(day.closest("form") || day.closest(".user-fields") || document);
  });

  if (roots.size === 0) roots.add(document);
  roots.forEach((r) => enhanceRoot(r));
}

let enhanceTimer = null;
function scheduleEnhance() {
  if (enhanceTimer) return;
  enhanceTimer = setTimeout(() => {
    enhanceTimer = null;
    enhance();
  }, 60);
}

export default apiInitializer("0.11.1", (api) => {
  scheduleEnhance();
  api.onPageChange(() => scheduleEnhance());

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n?.nodeType !== 1) continue;

        if (
          n.matches?.(
            ".user-field-hbp_birth_day,.user-field-hbp_birth_month,.user-field-hbp_birth_year"
          ) ||
          n.querySelector?.(
            ".user-field-hbp_birth_day,.user-field-hbp_birth_month,.user-field-hbp_birth_year"
          )
        ) {
          scheduleEnhance();
          return;
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
});
