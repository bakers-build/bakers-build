import test from "node:test";
import assert from "node:assert/strict";
import { KEYS, bakersLayout, bakersTabs, findNode, withKey } from "../lib/install.js";

const MAIN = {
  id: "root", type: "row", titlebar: "none", traffic_lights: [12, 16],
  children: [
    { id: "sidebar", type: "column", size: { px: 268 }, background: "chrome", children: [
      { id: "sidebar-lists", type: "column", children: [{ id: "spaces", type: "block" }, { id: "agents", type: "block" }] },
    ] },
    { id: "work", type: "column", children: [
      { id: "tabs", type: "block", content: { mod: "tabs" } },
      { id: "work-body", type: "row", children: [
        { id: "main", type: "block", content: { tab: "active" } },
        { id: "panel", type: "column", hidden: true, children: [
          { id: "panel-body", type: "stack", active: "files", children: [{ id: "files", type: "block", content: { mod: "files" } }] },
        ] },
      ] },
      { id: "status", type: "block", size: { px: 28 }, content: { mod: "workspace-status" } },
    ] },
  ],
};

const panelBody = (layout) => layout.children.find((c) => c.id === "work").children[1].children[1].children[0];

test("bakersLayout puts the rail first and hides Herdr's sidebar", () => {
  const layout = bakersLayout(MAIN, "darwin");
  assert.deepEqual(layout.children.map((c) => c.id), ["bakers-rail", "sidebar", "work"]);
  assert.deepEqual(layout.children[0], {
    id: "bakers-rail", type: "block", size: { px: 76 }, background: "chrome", resizable: false, window_drag: true,
    content: { mod: "bakers", props: { view: "rail" } },
  });
  assert.equal(layout.children[1].hidden, true);
  assert.deepEqual(findNode(layout, "tabs").content, { mod: "bakers-tabs" });
  // Herdr refuses a cloned_from without a version; this layout is the installer's own, not a clone.
  assert.equal("cloned_from" in layout, false);
  // With a position, Herdr's tab bar keeps room for the window buttons that already sit over the rail.
  assert.equal("traffic_lights" in layout, false);
  assert.equal(MAIN.children.length, 2, "main is not changed");
});

test("bakersLayout adds the ticket to Herdr's right panel, beside Files and Changes", () => {
  const body = panelBody(bakersLayout(MAIN, "darwin"));
  assert.deepEqual(body.children.map((c) => c.id), ["files", "ticket"]);
  assert.deepEqual(body.children[1], { id: "ticket", type: "block", content: { mod: "bakers", props: { view: "panel" } } });
  assert.equal(body.active, "files", "the panel keeps its own choice");
  assert.equal(panelBody(MAIN).children.length, 1, "main is not changed");
});

test("bakersLayout puts the bakers views in Herdr's sidebar, under Spaces and Agents", () => {
  const layout = bakersLayout(MAIN, "darwin");
  assert.deepEqual(findNode(layout, "sidebar-lists").children.map((c) => c.id), ["spaces", "agents", "bakers-views"]);
  assert.deepEqual(findNode(layout, "bakers-views"), {
    id: "bakers-views", type: "block", size: { px: 330 }, min: 120, content: { mod: "bakers", props: { view: "sidebar" } },
  });
  assert.equal(findNode(MAIN, "bakers-views"), null, "main is not changed");
});

test("bakersLayout puts one bakers item beside Herdr's status bar", () => {
  const row = findNode(bakersLayout(MAIN, "darwin"), "status-row");
  assert.deepEqual(row, {
    id: "status-row", type: "row", size: { px: 28 }, resizable: false, children: [
      { id: "status", type: "block", size: { weight: 1 }, content: { mod: "workspace-status" } },
      { id: "bakers-status", type: "block", size: { px: 340 }, content: { mod: "bakers", props: { view: "status" } } },
    ],
  });
  assert.equal(findNode(MAIN, "status-row"), null, "main is not changed");
});

test("bakersLayout keeps a layout without a status bar or an agents list", () => {
  const bare = structuredClone(MAIN);
  bare.children[0].children = [];
  bare.children[1].children.pop();
  const layout = bakersLayout(bare, "darwin");
  assert.equal(findNode(layout, "status-row"), null);
  assert.deepEqual(findNode(layout, "sidebar").children.map((c) => c.id), ["bakers-views"]);
});

test("bakersLayout refuses a layout without Herdr's tab bar or right panel", () => {
  const bare = { ...MAIN, children: [MAIN.children[0], { id: "work", type: "column", children: [] }] };
  assert.throws(() => bakersLayout(bare, "darwin"), /lacks Herdr's/);
});

test("bakersLayout uses the narrow v1 rail where no traffic lights sit over it", () => {
  assert.equal(bakersLayout(MAIN, "linux").children[0].size.px, 52);
});

test("bakersLayout refuses a layout without Herdr's sidebar", () => {
  assert.throws(() => bakersLayout({ id: "root", type: "row", children: [{ id: "work" }] }, "darwin"), /lacks Herdr's/);
});

test("findNode finds a layout node by id at any depth", () => {
  assert.equal(findNode(MAIN, "panel-body").type, "stack");
  assert.equal(findNode(MAIN, "root"), MAIN);
  assert.equal(findNode(MAIN, "nope"), null);
});

const TAB_BAR = [
  'import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings } from "herdr";',
  "const item = (c, i) => h_flex()",
  '  .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })',
  "  .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name));",
  "return h_flex()",
  '      .child(panelButton("github", "GitHub", "g.svg"))',
].join("\n");

test("bakersTabs adds the Ticket button before the window buttons of Herdr's tab bar or a clone of it", () => {
  for (const buttons of [".when(w?.buttons, el => el)", ".when(window()?.buttons, el => el)"]) {
    const out = bakersTabs(`${TAB_BAR}\n      ${buttons};`);
    assert.ok(out.indexOf('panelButton("ticket", "Ticket"') > out.indexOf('"github"'), "after the panels it had");
    assert.ok(out.indexOf('panelButton("ticket"') < out.indexOf(buttons), "before the window buttons");
    assert.equal(out.includes("bakers-tickets"), false, "Tickets is a tab now, not a button");
  }
});

test("bakersTabs draws the Tickets count, the preview tab in italics and a dot on a ticket tab that needs you", () => {
  const out = bakersTabs(`${TAB_BAR}\n      .when(w?.buttons, el => el);`);
  assert.match(out, /\.when\(bakersTab\(c\)\?\.preview, el => el\.italic\(\)\.font_family\("Helvetica Neue"\)\)/);
  assert.match(out, /bakersTab\(c\)\?\.count/);
  assert.match(out, /bakersTab\(c\)\?\.needs/);
  assert.match(out, /run\(bakersTab\(c\)\?\.ticket \? "bakers\.pin" : "tab\.rename", \{ id: c\.id \}\)/, "a double click pins a ticket tab instead of renaming it");
  assert.ok(out.indexOf("function bakersTab") > out.indexOf('from "herdr";'), "the helper comes after the imports");
});

test("bakersTabs refuses a tab bar it does not know", () => {
  assert.throws(() => bakersTabs("return h_flex();"), /tab bar/);
  assert.throws(() => bakersTabs(`${TAB_BAR.replace("max_w(170)", "max_w(200)")}\n .when(w?.buttons, el => el);`), /tab bar/);
});

test("KEYS binds the four bakers keys the region map names", () => {
  assert.deepEqual(KEYS, {
    "cmd-shift-b": "mod.open:bakers", "cmd-shift-n": "bakers.new", "cmd-shift-o": "bakers.goto", "cmd-shift-t": "bakers.panel",
  });
});

test("withKey adds a free key and never replaces a taken one", () => {
  const added = withKey({ global: { "cmd-t": "tab.new" } }, "cmd-shift-b", "mod.open:bakers");
  assert.equal(added.added, true);
  assert.deepEqual(added.keys.global, { "cmd-t": "tab.new", "cmd-shift-b": "mod.open:bakers" });
  const taken = withKey({ global: { "cmd-shift-b": "layout.toggle:x" } }, "cmd-shift-b", "mod.open:bakers");
  assert.equal(taken.added, false);
  assert.equal(taken.keys.global["cmd-shift-b"], "layout.toggle:x");
  assert.match(taken.reason, /already bound to layout.toggle:x/);
  const same = withKey({ global: { "cmd-shift-b": "mod.open:bakers" } }, "cmd-shift-b", "mod.open:bakers");
  assert.equal(same.added, false);
  assert.equal(same.reason, "already set");
  assert.deepEqual(withKey({}, "cmd-shift-b", "mod.open:bakers").keys, { global: { "cmd-shift-b": "mod.open:bakers" } });
});
