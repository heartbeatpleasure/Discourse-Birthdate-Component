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

function text(el) {
  return (el?.textContent || "").trim();
}

function isMissingTranslation(v) {
  return (
    !v ||
    String(v).startsWith("[") ||
    (String(v).includes(".js.") && String(v).endsWith("]"))
  );
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
  const inside = details.querySelector(".select-kit-body");
  if (inside) return normalizeBodyEl(inside);

  const ctrl =
    details.querySelector("[aria-controls]") ||
    details.querySelector("summary[aria-controls]") ||
    details.querySelector(".select-kit-header-wrapper[aria-controls]");
  const ctrlId = ctrl?.getAttribute?.("aria-controls");
  if (ctrlId) {
    const target = document.getElementById(ctrlId);
    if (target) return normalizeBodyEl(target);
  }

  const trigger = getTriggerEl(details);
  const tr = trigger.getBoundingClientRect();

  let best = null;
  let bestScore = Infinity;

  document
    .querySelectorAll(".select-kit-body, .select-kit-collection")
    .forEach((b) => {
      const bb = normalizeBodyEl(b);
      if (!bb || !isVisible(bb)) return;
      const br = bb.getBoundingClientRect();

      const score =
        Math.abs(br.top - tr.bottom) + Math.abs(br.left - tr.left) * 0.7;

      if (score < bestScore) {
        bestScore = score;
        best = bb;
      }
    });

  return best;
}

// Important: Discourse's select-kit already positions dropdowns correctly (also inside modals).
// The previous version tried to manually reposition the dropdown, which can break when you
// scroll inside the signup modal (the scroll container is not the window). That is exactly
// the "opens too low after scroll" bug you reported.
//
// We now only add a styling hook class, and leave positioning to select-kit.
function styleDropdownBody(details) {
  const body = findOpenBody(details);
  if (!body) return;
  body.classList.add("hbp-birthdate-dropdown");

  // Keep the dropdown width aligned with the trigger, without touching positioning.
  // (Positioning is handled by select-kit and works correctly in scrollable modals.)
  const trigger = getTriggerEl(details);
  const rect = trigger.getBoundingClientRect();
  const width = Math.max(160, Math.round(rect.width));
  body.style.boxSizing = "border-box";
  body.style.width = `${width}px`;
  body.style.minWidth = `${width}px`;
  body.style.maxWidth = `${width}px`;
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

  const syncOpenList = () => {
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

    // Styling hook only; positioning is handled by Discourse's select-kit.
    styleDropdownBody(details);
  };

  syncHeaderFromValue();

  if (!details.dataset.hbpBirthdateHooked) {
    details.dataset.hbpBirthdateHooked = "1";

    details.addEventListener("toggle", () => {
      syncHeaderFromValue();

      setTimeout(() => syncOpenList(), 0);
      setTimeout(() => syncOpenList(), 40);
      setTimeout(() => syncOpenList(), 120);

      if (details.open) {
        // Add the styling hook as soon as the dropdown is in the DOM.
        setTimeout(() => styleDropdownBody(details), 0);
      }
    });

    details.addEventListener("click", () => {
      syncHeaderFromValue();
      setTimeout(() => {
        syncHeaderFromValue();
        syncOpenList();
      }, 0);
      setTimeout(() => syncHeaderFromValue(), 60);
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

  // ✅ Labels now match Theme translations (Day / Month / Year)
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
