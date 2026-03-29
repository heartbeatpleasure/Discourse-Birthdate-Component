import Component from "@glimmer/component";
import I18n from "I18n";

function translatedTitle() {
  try {
    if (typeof themePrefix === "function") {
      const translated = I18n.t(themePrefix("hbp_birthdate.birthday_today_title"));
      if (translated && !String(translated).startsWith("[")) {
        return translated;
      }
    }
  } catch (_) {}

  try {
    const translated = I18n.t("js.hbp_birthdate.birthday_today_title");
    if (translated && !String(translated).startsWith("[")) {
      return translated;
    }
  } catch (_) {}

  return "Happy birthday!";
}

export default class HbpBirthdateBirthdayIcon extends Component {
  get title() {
    return translatedTitle();
  }

  <template>
    {{#if @outletArgs.user.hbp_birthdate_birthday_today}}
      <span class="hbp-birthday-icon" title={{this.title}}>
        🎂
      </span>
    {{/if}}
  </template>
}
