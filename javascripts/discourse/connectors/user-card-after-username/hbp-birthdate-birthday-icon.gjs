import Component from "@glimmer/component";
import I18n from "I18n";

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
      if (v && !String(v).startsWith("[")) {
        return v;
      }
    } catch (_) {}
  }

  return fallback;
}

export default class HbpBirthdateBirthdayIconConnector extends Component {
  get user() {
    return this.args.outletArgs?.user || null;
  }

  get age() {
    const value = this.user?.hbp_birthdate_age;
    return value === null || value === undefined || value === ""
      ? ""
      : String(value);
  }

  get userFieldsJson() {
    try {
      const value = this.user?.user_fields;
      if (value && typeof value === "object") {
        return JSON.stringify(value);
      }
    } catch (_) {}

    return "{}";
  }

  get birthdayTitle() {
    return t("hbp_birthdate.birthday_today_title", "Happy birthday!");
  }

  get isBirthdayToday() {
    return Boolean(this.user?.hbp_birthdate_birthday_today);
  }

  <template>
    {{#if this.user}}
      <span
        class="hbp-birthday-meta"
        hidden
        data-hbp-age={{this.age}}
        data-hbp-user-fields={{this.userFieldsJson}}
      ></span>
    {{/if}}

    {{#if this.isBirthdayToday}}
      <span class="hbp-birthday-icon" title={{this.birthdayTitle}}>
        🎂
      </span>
    {{/if}}
  </template>
}
