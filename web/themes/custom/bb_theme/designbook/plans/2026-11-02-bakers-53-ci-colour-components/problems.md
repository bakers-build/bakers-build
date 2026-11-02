# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-02T23:55:00Z | write-component | write-component | note | `plan done` rejects the unchanged `note.default.story.yml`: output "component-story": data/slots/body must be array. The existing story passes `body` as a plain string, which Storybook renders; the change (attention edge on `border-state-attention-mark` in `note.twig`) does not touch the story. | None inside the sealed plan: rewriting the story's slot shape is outside this change. The twig change is in place and covered by the Storybook build. |
| 2026-11-02T23:55:00Z | refresh-components, validate | refresh-components, validate | all | The agent sandbox cannot bind a local port (EPERM) or launch Chromium, so no live Storybook index or browser check is possible from it. `pnpm exec storybook build` succeeds and `storybook-static/index.json` lists every planned story id. | Left pending for a run outside the sandbox. |
