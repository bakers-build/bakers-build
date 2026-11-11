import { View, div } from "gpui-kit";
import { props, closeOverlay } from "herdr";
import { Board } from "./board.js";
import { Ticket } from "./ticket.js";
import { Rail } from "./rail.js";
import { Confirm } from "./confirm.js";
import { openBoard } from "./open.js";

const VIEWS = { board: Board, ticket: Ticket, rail: Rail, confirm: Confirm };

// One mod, one view per props().view. Opened by its key (mod.open:bakers) it shows the board tab and closes itself.
export default class Bakers extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.overlay && !p.view) {
      openBoard();
      closeOverlay(p.overlay);
      return;
    }
    this.view = new (VIEWS[p.view] ?? Board)();
    this.view.init(p, cx);
  }

  render(cx) {
    return this.view ? this.view.render(cx) : div();
  }
}
