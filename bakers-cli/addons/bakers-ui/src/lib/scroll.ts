// Clamp a viewport of `height` rows starting at `offset` so the selected row
// stays visible: scroll up when it is above the window, down when it is at or
// below the bottom edge, leave it untouched when already inside.
//
// `selRow` is the ABSOLUTE physical row of the selection. List screens prepend a
// header row (the ticket table's `IDENTIFIER …` line), so the caller must pass
// screenView().selRow — the real row of the highlight — NOT the 0-based
// selection index. Feeding the 0-based index here is the AC-2 off-by-one the
// round-5 review caught: the highlight fell one row past the window bottom.
export function scrollTo(
  selRow: number,
  offset: number,
  height: number,
): number {
  if (selRow < offset) return selRow;
  if (selRow >= offset + height) return selRow - height + 1;
  return offset;
}
