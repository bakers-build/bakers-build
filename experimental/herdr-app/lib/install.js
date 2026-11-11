// Pure parts of the installer: the bakers layout, its tab bar and the keys in keys.json.
import { findNode } from "../mods/bakers/derive.js";

export { findNode };

// macOS draws its window buttons over the rail, so there it is as wide as Herdr's own rail.
const RAIL_PX = { darwin: 76 };
const bakersBlock = (id, view, extra) => ({ id, type: "block", ...extra, content: { mod: "bakers", props: { view } } });
const TICKET = bakersBlock("ticket", "panel");
const VIEWS = bakersBlock("bakers-views", "sidebar", { size: { px: 330 }, min: 120 });
const STATUS = bakersBlock("bakers-status", "status", { size: { px: 340 } });

export const KEYS = {
  "cmd-shift-b": "mod.open:bakers", "cmd-shift-n": "bakers.new", "cmd-shift-o": "bakers.goto", "cmd-shift-t": "bakers.panel",
};

// Ticket tabs are named "<identifier> <state>"; the Tickets tab carries the Needs me count.
const TAB_HELPER = `
// bakers: the Tickets tab's count, the preview tab in italics, a dot on a ticket tab that needs you.
function bakersTab(c) {
  if (!panes().some((p) => p.tab === c.id && p.mod === "bakers")) return null;
  const ticket = /^([A-Z][A-Z0-9_]*-\\d+) /.exec(c.name)?.[1] ?? null;
  return {
    ticket, preview: Boolean(ticket) && ticket === shared("bakers.preview"),
    needs: Boolean(ticket) && (shared("bakers.needing") ?? []).includes(ticket),
    count: c.name === "Tickets" ? Number(shared("bakers.needs") || 0) : 0,
  };
}
`;
const TAB_LABEL = ".child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))";
// Herdr's UI font has no italic face, so the preview tab's name takes one that has.
const BAKERS_LABEL = `.child(div().max_w(170).truncate().when(bakersTab(c)?.preview, el => el.italic().font_family("Helvetica Neue")).child(c.zoomed ? \`\${name} Z\` : name))
        .when(bakersTab(c)?.count > 0, el => el.child(div().text_color(t.blocked).child(String(bakersTab(c).count))))
        .when(bakersTab(c)?.needs, el => el.child(div().size(6).rounded(3).bg(t.blocked)))`;
const TAB_RENAME = 'run("tab.rename", { id: c.id })';
const TAB_BAR_BUTTONS = `
      .child(panelButton("ticket", "Ticket", "mods/bakers/ticket.svg"))`;

const parentOf = (node, id) => (node?.children ?? []).some((c) => c.id === id)
  ? node : (node?.children ?? []).map((child) => parentOf(child, id)).find(Boolean) ?? null;

export function bakersLayout(base, platform) {
  const layout = structuredClone(base);
  const [sidebar, tabs, panelBody, status] = ["sidebar", "tabs", "panel-body", "status"].map((id) => findNode(layout, id));
  if (!sidebar || !tabs || !panelBody) throw new Error('The layout lacks Herdr\'s "sidebar", "tabs" or "panel-body"; update the installer for this Herdr version');
  sidebar.hidden = true;
  tabs.content = { mod: "bakers-tabs" };
  panelBody.children = [...panelBody.children.filter((c) => c.id !== "ticket"), TICKET];
  const lists = parentOf(sidebar, "agents") ?? sidebar;
  lists.children.splice(lists.children.findIndex((c) => c.id === "agents") + 1, 0, VIEWS);
  if (status) {
    const row = parentOf(layout, "status");
    row.children[row.children.indexOf(status)] = {
      id: "status-row", type: "row", size: status.size, resizable: false, children: [{ ...status, size: { weight: 1 } }, STATUS],
    };
  }
  // With a position, Herdr's tab bar keeps room for window buttons that already sit over the rail.
  delete layout.traffic_lights;
  layout.children = [{
    id: "bakers-rail", type: "block", size: { px: RAIL_PX[platform] ?? 52 }, background: "chrome", resizable: false, window_drag: true,
    content: { mod: "bakers", props: { view: "rail" } },
  }, ...layout.children];
  return layout;
}

// Herdr's tab bar (or your clone of it) with the Ticket button after its panel buttons and the ticket tabs drawn by bakers.
export function bakersTabs(source) {
  const imports = source.indexOf('from "herdr";'), buttons = source.search(/\n\s*\.when\((w|window\(\))\?\.buttons/);
  if (imports < 0 || buttons < 0 || !source.includes(TAB_LABEL) || !source.includes(TAB_RENAME)) {
    throw new Error("Herdr's tab bar has changed: no tab label, rename or window buttons to extend; update the installer");
  }
  const end = source.indexOf("\n", imports) + 1;
  return (source.slice(0, end) + TAB_HELPER + source.slice(end, buttons) + TAB_BAR_BUTTONS + source.slice(buttons))
    .replace(TAB_LABEL, BAKERS_LABEL)
    .replace(TAB_RENAME, 'run(bakersTab(c)?.ticket ? "bakers.pin" : "tab.rename", { id: c.id })');
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
