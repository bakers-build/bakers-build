// BB-375 — modal chrome types. Every modal is {@link AsyncModalScreen}.

import type { ScreenPresentation } from './screen.js';

/**
 * Header fields a modal publishes — popup box supplies the border.
 * Footer chips go through {@link AsyncModalScreen.actions}.
 */
export type ModalChrome = Partial<
  Pick<
    ScreenPresentation,
    'title' | 'meta' | 'header' | 'selectable' | 'selectedIndex' | 'rowIds'
  >
>;
