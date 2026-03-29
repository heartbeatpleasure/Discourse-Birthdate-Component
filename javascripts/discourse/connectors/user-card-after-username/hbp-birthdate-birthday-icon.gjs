export default <template>
  {{#if @outletArgs.user.hbp_birthdate_birthday_today}}
    <span
      class="hbp-birthday-icon"
      title={{i18n (theme-prefix "hbp_birthdate.birthday_today_title")}}
    >
      🎂
    </span>
  {{/if}}
</template>;
