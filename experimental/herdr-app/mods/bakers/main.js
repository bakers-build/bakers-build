import { View, div } from "gpui-kit";
import { props, closeOverlay } from "herdr";
import { List } from "./list.js";
import { Panel } from "./panel.js";
import { Rail } from "./rail.js";
import { Sidebar } from "./sidebar.js";
import { Status } from "./status.js";
import { Menu } from "./menu.js";
import { Confirm } from "./confirm.js";
import { openList } from "./open.js";

const VIEWS = { list: List, panel: Panel, rail: Rail, sidebar: Sidebar, status: Status, menu: Menu, confirm: Confirm };

// One mod, one view per props().view. Opened by its key (mod.open:bakers) it shows the Tickets tab with Needs me and closes itself.
export default class Bakers extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.overlay && !p.view) {
      openList("needs-me");
      closeOverlay(p.overlay);
      return;
    }
    this.view = new (VIEWS[p.view] ?? List)();
    this.view.init(p, cx);
  }

  render(cx) {
    return this.view ? this.view.render(cx) : div();
  }
}
