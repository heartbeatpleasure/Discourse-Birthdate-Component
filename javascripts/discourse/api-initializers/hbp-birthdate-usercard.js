import { apiInitializer } from "discourse/lib/api";
import I18n from "I18n";
import { computed } from "@ember/object";

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

function normalizeLabel(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/:$/, "")
    .toLowerCase();
}

export default apiInitializer("0.11.1", (api) => {
  const pluginId = "hbp-birthdate-usercard";

  // 1) Voeg Age toe als public user field (zoals jouw werkende versie)
  try {
    api.modifyClass("component:user-card-contents", {
      pluginId,

      publicUserFields: computed(
        "user.user_fields",
        "user.user_fields.@each.value",
        "user.hbp_birthdate_age",
        function () {
          const original = this._super(...arguments) || [];
          const fields = Array.isArray(original) ? original.slice() : [];

          const age = toInt(this.user?.hbp_birthdate_age);
          if (!age || age < 0) return fields;

          const ageLabel = (t("hbp_birthdate.age", "Age") || "Age").trim();

          // voorkom dubbele Age-regel
          const filtered = fields.filter((f) => {
            const name =
              f?.field?.name ?? f?.name ?? f?.field_name ?? f?.label ?? "";
            return (
              String(name).trim().toLowerCase() !== ageLabel.toLowerCase()
            );
          });

          filtered.unshift({
            field: { name: ageLabel },
            value: String(age),
          });

          return filtered;
        }
      ),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[${pluginId}] Could not modify component:user-card-contents`, e);
  }

  // 2) Zorg dat Age exact dezelfde classes krijgt als de andere velden:
  //    - label span => .user-field-name (bold via core/theme CSS)
  //    - value span => .user-field-value
  const applyAgeClasses = () => {
    const ageLabel = normalizeLabel(t("hbp_birthdate.age", "Age"));

    document.querySelectorAll(".user-card").forEach((card) => {
      card.querySelectorAll(".public-user-field").forEach((row) => {
        // Pak label element (Discourse varianten: .user-field-name of eerste span)
        const labelEl =
          row.querySelector(".user-field-name") ||
          row.querySelector(":scope > span:first-child");

        if (!labelEl) return;

        const labelTxt = normalizeLabel(labelEl.textContent);
        if (labelTxt !== ageLabel) return;

        // Markeer row (handig voor toekomst; geen styling nodig)
        row.classList.add("hbp-userfield-age");
        row.setAttribute("data-hbp-field", "age");

        // Forceer dezelfde classes als de rest
        labelEl.classList.add("user-field-name");

        const valueEl =
          row.querySelector(".user-field-value") ||
          row.querySelector(":scope > span:last-child");

        if (valueEl) valueEl.classList.add("user-field-value");
      });
    });
  };

  let timer = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      applyAgeClasses();
    }, 50);
  };

  schedule();
  api.onPageChange(() => schedule());

  const observer = new MutationObserver(() => schedule());
  observer.observe(document.body, { childList: true, subtree: true });
});
