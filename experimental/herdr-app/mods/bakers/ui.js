import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { settings } from "herdr";

const BRAND = { bg: "#e9a13b", ink: "#1b1206" };
const BUTTON = {
  plain: (t) => ({ border: t.border, bg: t.background, text: t.foreground }),
  danger: (t) => ({ border: t.ansi1, bg: t.background, text: t.ansi1 }),
  primary: (t) => ({ border: t.solid, bg: t.solid, text: t.solid_foreground }),
};

export const mark = () => div().w(16).h(16).flex_none().flex().items_center().justify_center().rounded(4)
  .bg(BRAND.bg).text_color(BRAND.ink).text_size(11).font_semibold().child("b");

export const mono = () => settings().font_family ?? "JetBrains Mono";

// A soft fill in a theme color: #rrggbb plus alpha.
export const tint = (color, alpha) => (color.length === 7 ? color + alpha : color);

export const label = (text, t) => div().text_size(11).text_color(t.dim).child(text.toUpperCase());

export const pill = (text, t, filled) => div().px(7).h(20).flex().items_center().rounded(5).text_size(12)
  .when(filled, (e) => e.bg(t.accent).text_color(t.background))
  .when(!filled, (e) => e.border_1().border_color(t.border).text_color(t.muted))
  .child(text);

export function button(id, text, t, onClick, kind = "plain", disabled = false) {
  const look = BUTTON[kind](t);
  return h_flex().id(id).h(30).px(12).flex_none().items_center().rounded(8).border_1().text_size(12)
    .border_color(look.border).bg(look.bg).text_color(look.text)
    .when(disabled, (e) => e.opacity(0.5))
    .when(!disabled, (e) => e.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => onClick(cx)))
    .child(text);
}
