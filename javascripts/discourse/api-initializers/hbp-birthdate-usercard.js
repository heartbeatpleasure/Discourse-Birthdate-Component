import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";
import I18n from "I18n";

// User field label to check (admin-configurable via theme settings.yml)
// When this checkbox is enabled, we hide the user's age on user cards (and we
// also remove the setting field from public rendering if it ever becomes public).
function getHideAgeFieldName() {
  try {
    // `settings` is provided by Discourse Theme Components at runtime
    // eslint-disable-next-line no-undef
    const v = settings?.hide_age_user_field_name;
    if (v && String(v).trim().length) return String(v).trim();
  } catch (_) {}

  return "Hide my age on my profile";
}

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

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function isTruthy(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return ["true", "t", "1", "yes", "y", "on", "checked"].includes(s);
}

function getSite(api) {
  try {
    return (
      api?.container?.lookup?.("site:main") ||
      api?.container?.lookup?.("service:site") ||
      null
    );
  } catch (_) {
    return null;
  }
}

function getSiteUserFields(api) {
  const site = getSite(api);
  return site?.user_fields || site?.get?.("user_fields") || [];
}

function normalizeLabel(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/:$/, "")
    .toLowerCase();
}

function getUserFieldIdByName(api, fieldName) {
  const target = normalizeLabel(fieldName);
  if (!target) return null;

  const defs = getSiteUserFields(api);
  if (!Array.isArray(defs)) return null;

  const match = defs.find((f) => {
    const name = f?.name ?? f?.get?.("name") ?? "";
    return normalizeLabel(name) === target;
  });

  return match?.id ?? match?.get?.("id") ?? null;
}

function getUserFieldValue(user, fieldId) {
  if (!user || fieldId === null || fieldId === undefined) return null;

  const uf = user.user_fields;
  if (!uf) return null;

  if (!Array.isArray(uf) && typeof uf === "object") {
    return uf[String(fieldId)] ?? uf[fieldId] ?? null;
  }

  if (Array.isArray(uf)) {
    const item = uf.find((x) => {
      const id = x?.id ?? x?.field_id ?? x?.user_field_id;
      return String(id) === String(fieldId);
    });
    return item?.value ?? item?.field_value ?? item?.val ?? null;
  }

  return null;
}

function shouldHideAge(api, user) {
  const fieldName = getHideAgeFieldName();
  const fieldId = getUserFieldIdByName(api, fieldName);
  if (!fieldId) return false;
  return isTruthy(getUserFieldValue(user, fieldId));
}

function getFieldRows(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(".public-user-field"));
}

function getFieldLabelEl(row) {
  if (!row) return null;

  return (
    row.querySelector(".user-field-name") ||
    row.querySelector(":scope > span:first-child") ||
    row.querySelector("dt") ||
    null
  );
}

function getFieldValueEl(row) {
  if (!row) return null;

  return (
    row.querySelector(".user-field-value") ||
    row.querySelector(":scope > span:last-child") ||
    row.querySelector("dd") ||
    null
  );
}

function removeFieldRowsByLabel(root, labelToRemove) {
  const target = normalizeLabel(labelToRemove);
  if (!root || !target) return;

  getFieldRows(root).forEach((row) => {
    const labelEl = getFieldLabelEl(row);
    if (!labelEl) return;
    if (normalizeLabel(labelEl.textContent) === target) {
      row.remove();
    }
  });
}

function findCardPublicFieldsContainer(card) {
  if (!card) return null;

  return (
    card.querySelector(".public-user-fields") ||
    card.querySelector(".user-card-public-fields") ||
    null
  );
}

function ensureCardPublicFieldsContainer(card) {
  let container = findCardPublicFieldsContainer(card);
  if (container) return container;

  const content =
    card.querySelector(".card-content") ||
    card.querySelector(".user-card-contents") ||
    card;

  if (!content) return null;

  container = document.createElement("div");
  container.className = "public-user-fields";

  const beforeEl =
    content.querySelector(".user-card-badges") ||
    content.querySelector(".badges") ||
    null;

  if (beforeEl?.parentNode) {
    beforeEl.parentNode.insertBefore(container, beforeEl);
  } else {
    content.appendChild(container);
  }

  return container;
}

function buildAgeRow(ageLabel, age) {
  const row = document.createElement("div");
  row.className = "public-user-field hbp-userfield-age";
  row.setAttribute("data-hbp-field", "age");

  const label = document.createElement("span");
  label.className = "user-field-name";
  label.textContent = `${ageLabel}:`;

  const value = document.createElement("span");
  value.className = "user-field-value";
  value.textContent = String(age);

  row.appendChild(label);
  row.appendChild(value);
  return row;
}

function parseMetaUser(metaEl) {
  if (!metaEl) return null;

  let userFields = {};
  try {
    const raw = metaEl.dataset?.hbpUserFields;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        userFields = parsed;
      }
    }
  } catch (_) {}

  return {
    user_fields: userFields,
    hbp_birthdate_age: metaEl.dataset?.hbpAge,
  };
}

function applyAgeClasses(root) {
  const ageLabel = normalizeLabel(t("hbp_birthdate.age", "Age"));

  getFieldRows(root).forEach((row) => {
    const labelEl = getFieldLabelEl(row);
    if (!labelEl) return;

    if (normalizeLabel(labelEl.textContent) !== ageLabel) return;

    row.classList.add("hbp-userfield-age");
    row.setAttribute("data-hbp-field", "age");
    labelEl.classList.add("user-field-name");

    const valueEl = getFieldValueEl(row);
    if (valueEl) valueEl.classList.add("user-field-value");
  });
}

function applyCardAgeFiltering(api, card) {
  if (!card) return;

  const ageLabel = (t("hbp_birthdate.age", "Age") || "Age").trim();
  const metaEl = card.querySelector(".hbp-birthday-meta");
  if (!metaEl) {
    removeFieldRowsByLabel(card, getHideAgeFieldName());
    applyAgeClasses(card);
    return;
  }

  const user = parseMetaUser(metaEl);
  const age = toInt(user?.hbp_birthdate_age);
  const hideAge = shouldHideAge(api, user);

  removeFieldRowsByLabel(card, getHideAgeFieldName());
  removeFieldRowsByLabel(card, ageLabel);

  if (!hideAge && age !== null && age >= 0) {
    const container = ensureCardPublicFieldsContainer(card);
    if (container) {
      container.prepend(buildAgeRow(ageLabel, age));
    }
  }

  applyAgeClasses(card);
}

function getProfileRoot() {
  return (
    document.querySelector(".user-main") ||
    document.querySelector(".user-content") ||
    document.querySelector(".user-profile") ||
    null
  );
}

function getProfileUsername() {
  const path = window.location?.pathname || "";
  const m = path.match(/^\/u\/([^/]+)/i);
  if (!m) return null;

  try {
    return decodeURIComponent(m[1]);
  } catch (_) {
    return m[1];
  }
}

const userCache = new Map();

async function fetchUserForProfile(username) {
  const key = String(username || "").trim().toLowerCase();
  if (!key) return null;

  if (userCache.has(key)) {
    return userCache.get(key);
  }

  const promise = ajax(`/u/${encodeURIComponent(key)}.json`)
    .then((result) => result?.user || result || null)
    .catch(() => null);

  userCache.set(key, promise);
  return promise;
}

async function applyProfileAgeFiltering(api) {
  const root = getProfileRoot();
  if (!root) return;

  const ageLabel = (t("hbp_birthdate.age", "Age") || "Age").trim();
  removeFieldRowsByLabel(root, getHideAgeFieldName());

  const username = getProfileUsername();
  if (!username) {
    applyAgeClasses(root);
    return;
  }

  const user = await fetchUserForProfile(username);
  if (shouldHideAge(api, user)) {
    removeFieldRowsByLabel(root, ageLabel);
  }

  removeFieldRowsByLabel(root, getHideAgeFieldName());
  applyAgeClasses(root);
}

export default apiInitializer("0.11.1", (api) => {
  let timer = null;
  let profileRun = 0;

  const schedule = () => {
    if (timer) return;

    timer = setTimeout(() => {
      timer = null;

      document.querySelectorAll(".user-card").forEach((card) => {
        applyCardAgeFiltering(api, card);
      });

      const runId = ++profileRun;
      applyProfileAgeFiltering(api).finally(() => {
        if (runId !== profileRun) return;
      });
    }, 50);
  };

  schedule();
  api.onPageChange(() => schedule());

  const observer = new MutationObserver(() => schedule());
  observer.observe(document.body, { childList: true, subtree: true });
});
