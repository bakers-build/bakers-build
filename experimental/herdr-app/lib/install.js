// Pure parts of the installer: the bakers layout, its tab bar and one key in keys.json.

// macOS draws its window buttons over the rail, so there it is as wide as Herdr's own rail.
const RAIL_PX = { darwin: 76 };
const TICKET = { id: "ticket", type: "block", content: { mod: "bakers", props: { view: "ticket" } } };
const TAB_BAR_BUTTONS = `
      .child(panelButton("ticket", "Ticket", "mods/bakers/ticket.svg"))
      .child(h_flex().id("bakers-tickets").h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12).text_color(t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop).on_click(() => run("mod.open", { name: "bakers" }))
        .child("Tickets").child(div().text_color(t.blocked).child(String(shared("bakers.needs") || ""))))`;

export function findNode(node, id) {
  if (node?.id === id) return node;
  return (node?.children ?? []).map((child) => findNode(child, id)).find(Boolean) ?? null;
}

export function bakersLayout(base, platform) {
  const layout = structuredClone(base);
  const [sidebar, tabs, panelBody] = ["sidebar", "tabs", "panel-body"].map((id) => findNode(layout, id));
  if (!sidebar || !tabs || !panelBody) throw new Error('The layout lacks Herdr\'s "sidebar", "tabs" or "panel-body"; update the installer for this Herdr version');
  sidebar.hidden = true;
  tabs.content = { mod: "bakers-tabs" };
  panelBody.children = [...panelBody.children.filter((c) => c.id !== "ticket"), TICKET];
  // With a position, Herdr's tab bar keeps room for window buttons that already sit over the rail.
  delete layout.traffic_lights;
  layout.children = [{
    id: "bakers-rail", type: "block", size: { px: RAIL_PX[platform] ?? 52 }, background: "chrome", resizable: false, window_drag: true,
    content: { mod: "bakers", props: { view: "rail" } },
  }, ...layout.children];
  return layout;
}

// Herdr's tab bar (or your clone of it) with Ticket and Tickets after its panel buttons.
export function bakersTabs(source) {
  const at = source.search(/\n\s*\.when\((w|window\(\))\?\.buttons/);
  if (at < 0) throw new Error("Herdr's tab bar has changed: no window buttons to put Ticket and Tickets before; update the installer");
  return source.slice(0, at) + TAB_BAR_BUTTONS + source.slice(at);
}

export function withKey(keys, key, action) {
  const next = structuredClone(keys ?? {});
  next.global ??= {};
  const bound = next.global[key];
  if (bound === action) return { keys: next, added: false, reason: "already set" };
  if (bound) return { keys: next, added: false, reason: `${key} is already bound to ${bound}` };
  next.global[key] = action;
  return { keys: next, added: true, reason: null };
}
