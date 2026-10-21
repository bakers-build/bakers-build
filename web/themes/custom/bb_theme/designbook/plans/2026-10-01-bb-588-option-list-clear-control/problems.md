# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-10-01T21:40:00Z | validate | validate | option_list clear_control, table wired | `storybook check` exits 1: `Cannot find package 'playwright'` (addon 0.11.0). Tasks stay pending. | playwright-cli (dbC): table--wired row 2 clear row renders `<input type="radio" name="members[2][role]" value="">`; clicking it fires one bubbling `change` and FormData posts `members[2][role]=""`; picking `member` in row 1 fires one `change` on that radio; intervention-scene Labels (inline, multiple) clear fires one `change` from the picker. |
| 2026-10-01T21:40:00Z | write-component | write-component | option_picker | Submitting `component-js` made the CLI write `components/option_picker/option_picker.js` (the contract's js path) as a copy of the `.src.js` source — a second, unbuilt script beside the source. | Deleted the stray file; the source `option_picker.src.js` is the only script, built by `pnpm run build`. |
