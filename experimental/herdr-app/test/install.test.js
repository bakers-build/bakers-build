import test from "node:test";
import assert from "node:assert/strict";
import { bakersLayout, bakersTabs, findNode, withKey } from "../lib/install.js";

const MAIN = {
  id: "root", type: "row", titlebar: "none", traffic_lights: [12, 16],
  children: [
    { id: "sidebar", type: "column", size: { px: 268 }, background: "chrome", children: [] },
    { id: "work", type: "column", children: [
      { id: "tabs", type: "block", content: { mod: "tabs" } },
      { id: "work-body", type: "row", children: [
        { id: "main", type: "block", content: { tab: "active" } },
        { id: "panel", type: "column", hidden: true, children: [
          { id: "panel-body", type: "stack", active: "files", children: [{ id: "files", type: "block", content: { mod: "files" } }] },
        ] },
      ] },
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
  assert.deepEqual(body.children[1], { id: "ticket", type: "block", content: { mod: "bakers", props: { view: "ticket" } } });
  assert.equal(body.active, "files", "the panel keeps its own choice");
  assert.equal(panelBody(MAIN).children.length, 1, "main is not changed");
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

test("bakersTabs puts Ticket and Tickets before the window buttons of Herdr's tab bar or a clone of it", () => {
  for (const buttons of [".when(w?.buttons, el => el)", ".when(window()?.buttons, el => el)"]) {
    const source = `return h_flex()\n      .child(panelButton("github", "GitHub", "g.svg"))\n      ${buttons};`;
    const out = bakersTabs(source);
    assert.ok(out.indexOf('panelButton("ticket", "Ticket"') > out.indexOf('"github"'), "after the panels it had");
    assert.ok(out.indexOf('"Tickets"') < out.indexOf(buttons), "before the window buttons");
    assert.match(out, /run\("mod\.open", \{ name: "bakers" \}\)/);
  }
  assert.throws(() => bakersTabs("return h_flex();"), /tab bar/);
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
