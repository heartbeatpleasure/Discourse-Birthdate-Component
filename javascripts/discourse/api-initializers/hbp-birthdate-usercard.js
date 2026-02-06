import { apiInitializer } from "discourse/lib/api";
import I18n from "I18n";
import { computed } from "@ember/object";

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
  // site.user_fields is typically an array of UserField models
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

  // Some serializers send an object map {"<id>": "value"}
  if (!Array.isArray(uf) && typeof uf === "object") {
    return uf[String(fieldId)] ?? uf[fieldId] ?? null;
  }

  // Some serializers send an array of objects [{id, value}, ...]
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

function removeFieldByLabel(fields, labelToRemove) {
  const target = normalizeLabel(labelToRemove);
  if (!target) return fields;
  return (fields || []).filter((f) => {
    const name = f?.field?.name ?? f?.name ?? f?.field_name ?? f?.label ?? "";
    return normalizeLabel(name) !== target;
  });
}

export default apiInitializer("0.11.1", (api) => {
  const pluginId = "hbp-birthdate-usercard";

  // 1) Voeg Age toe als public user field (zoals jouw werkende versie)
  //    - maar: respecteer het user field "Hide my age on my profile"
  //      (theme setting: hide_age_user_field_name)
  try {
    api.modifyClass("component:user-card-contents", {
      pluginId,

      publicUserFields: computed(
        "user.user_fields",
        "user.user_fields.@each.value",
        "user.hbp_birthdate_age",
        function () {
          const original = this._super(...arguments) || [];
          let fields = Array.isArray(original) ? original.slice() : [];

          const age = toInt(this.user?.hbp_birthdate_age);
          const ageLabel = (t("hbp_birthdate.age", "Age") || "Age").trim();

          // Verwijder de "hide age" user field uit de openbare rendering
          // (mocht die ooit op 'Show on user card/profile' worden gezet).
          fields = removeFieldByLabel(fields, getHideAgeFieldName());

          // Als user heeft aangevinkt om leeftijd te verbergen: nooit tonen.
          if (shouldHideAge(api, this.user)) {
            // Ook defensief: verwijder Age als het op een andere manier in de lijst zit.
            fields = removeFieldByLabel(fields, ageLabel);
            return fields;
          }

          if (!age || age < 0) return fields;

          // voorkom dubbele Age-regel
          const filtered = removeFieldByLabel(fields, ageLabel);

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
    console.warn(
      `[${pluginId}] Could not modify component:user-card-contents`,
      e
    );
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

  // 3) (Voorbereiding) Verberg Age ook op de user profile page als die daar via
  //    public user fields getoond wordt.
  //    Dit voegt GEEN age toe aan het profiel; het filtert alleen.
  const patchProfileComponent = (componentName) => {
    try {
      api.modifyClass(componentName, {
        pluginId,

        publicUserFields: computed(
          "user.user_fields",
          "user.user_fields.@each.value",
          "model.user_fields",
          "model.user_fields.@each.value",
          "user.hbp_birthdate_age",
          "model.hbp_birthdate_age",
          function () {
            const original = this._super(...arguments) || [];
            let fields = Array.isArray(original) ? original.slice() : [];

            const ageLabel = (t("hbp_birthdate.age", "Age") || "Age").trim();
            const user = this.user || this.model || this.userModel || null;

            // Altijd hide-field zelf weghalen uit openbare rendering
            fields = removeFieldByLabel(fields, getHideAgeFieldName());

            // Age conditioneel weghalen
            if (shouldHideAge(api, user)) {
              fields = removeFieldByLabel(fields, ageLabel);
            }

            return fields;
          }
        ),
      });
    } catch (_) {
      // no-op (component bestaat niet in deze Discourse versie / layout)
    }
  };

  // We proberen een paar mogelijke componenten (afhankelijk van Discourse versie/theme).
  patchProfileComponent("component:user-profile-primary");
  patchProfileComponent("component:user-profile-secondary");
  patchProfileComponent("component:user-profile");

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
