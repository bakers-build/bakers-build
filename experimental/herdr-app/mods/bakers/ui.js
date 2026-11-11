import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings } from "herdr";
import { claudeColor } from "./derive.js";

const BRAND = { bg: "#e9a13b", ink: "#1b1206" };
const BUTTON = {
  plain: (t) => ({ border: t.input, bg: t.background, text: t.foreground }),
  danger: (t) => ({ border: t.ansi1, bg: t.background, text: t.ansi1 }),
  primary: (t) => ({ border: t.solid, bg: t.solid, text: t.solid_foreground }),
};

export const mark = () => div().w(16).h(16).flex_none().flex().items_center().justify_center().rounded(4)
  .bg(BRAND.bg).text_color(BRAND.ink).text_size(11).font_semibold().child("b");

export const mono = () => settings().font_family ?? "JetBrains Mono";

// A soft fill in a theme color: #rrggbb plus alpha.
export const tint = (color, alpha) => (color.length === 7 ? color + alpha : color);

export const label = (text, t) => div().text_size(11).font_semibold().text_color(t.dim).child(text.toUpperCase());

export const dot = (color) => div().w(8).h(8).flex_none().rounded(4).bg(color);

// No run: an empty ring; waiting for a conductor: a dashed one.
export const ring = (color, dashed) => div().w(8).h(8).flex_none().rounded(4).border_1().border_color(color).when(dashed, (e) => e.border_dashed());

export const statusColor = (status, t) => claudeColor(status, t.background) ?? t.dim;

// The agent's mark: its color while a run is active, a ring otherwise.
export const agentDot = (section, t) => (section?.kind === "run" ? dot(statusColor(section.status, t)) : ring(t.dim, section?.kind === "waiting"));

// What the tracker API cannot do yet.
export const chip = (text, t) => div().flex_none().px(5).h(16).flex().items_center().rounded(4).border_1().border_dashed().border_color(t.dim)
  .text_size(9.5).font_semibold().text_color(t.muted).child(text.toUpperCase());

export const pill = (text, t, strong) => div().flex_none().px(8).h(22).flex().items_center().rounded(11).border_1().text_size(12)
  .border_color(strong ? t.foreground : t.input).text_color(strong ? t.foreground : t.muted).when(strong, (e) => e.font_semibold())
  .child(text);

export const hint = (text, t) => div().text_size(11.5).text_color(t.dim).child(text);

export const chevron = (t) => svg("mods/workspace-chrome/chevron-down.svg").size(11).text_color(t.muted);

export function button(id, text, t, onClick, kind = "plain", disabled = false) {
  const look = BUTTON[kind](t);
  return h_flex().id(id).h(28).px(10).flex_none().items_center().gap(5).rounded(6).border_1().text_size(12.5)
    .border_color(look.border).bg(look.bg).text_color(look.text).when(kind === "primary", (e) => e.font_semibold())
    .when(disabled, (e) => e.opacity(0.5).border_dashed())
    .when(!disabled, (e) => e.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => onClick(cx)))
    .child(text);
}

// A row in a popup menu: hover and the keyboard's selection look the same.
export const menuRow = (id, t, selected, onClick) => h_flex().id(id).h(28).px(8).gap(8).items_center().rounded(5).cursor_pointer()
  .when(selected, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => onClick(cx));

// The body of a dialog: title, then whatever it holds.
export const dialogBox = (id, t, handle, onKey) => v_flex().id(id).track_focus(handle).on_key_down(onKey)
  .w_full().p(20).gap(14).bg(t.popover).text_color(t.foreground).text_size(13);

// From and to as pills with an arrow.
export const fromTo = (from, to, t, extra) => h_flex().gap(8).items_center().flex_wrap()
  .child(pill(from, t, false)).child(div().text_color(t.muted).child("→")).child(pill(to, t, true))
  .when(Boolean(extra), (e) => e.child(div().text_size(12).text_color(t.muted).child(extra)));

// Escape hint on the left, then the buttons; Done and Cancelled put the primary first.
export const dialogButtons = (escHint, t, buttons) => h_flex().pt(2).gap(8).items_center()
  .child(div().flex_1().text_size(11.5).text_color(t.dim).child(escHint)).children(buttons);

export const field = (t, focused) => div().px(10).py(6).rounded(6).border_1().border_color(focused ? t.accent : t.input).bg(t.background);
