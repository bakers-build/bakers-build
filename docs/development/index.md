# Development

Change bakers.build itself, build from source and validate contributions. Start with [the contributor guide](contributing.md) and the checkout's `CLAUDE.md` and `WORKFLOW.md`; their current checks govern your change.

Choose the guide for the part of the product you want to work on.

- [Build the CLI from source](build-from-source.md) — Prepare a working CLI build from your checkout.
- [Architecture](architecture.md) — Understand package layers and server boundaries.
- [UI islands and profiles](islands-and-profiles.md) — Understand how Drupal pages select and compose UI fragments.
- [Skill contract](skill-contract.md) — Learn how lifecycle instructions, recipes and project hints fit together.
- [Test a skill](test-skills.md) — Generate a synthetic example and replay its checks.
- [Write the docs](write-docs.md) — Find topic ownership, writing rules and site checks.

User extensions belong in [Addons](../addons/index.md); project methods belong in [Skills & Workflows](../skills-and-workflows/index.md). You do not need to change the product to configure an existing worker.

These guides and the operating conventions under `docs/bakers/` are internal repository documentation. They are excluded from the public documentation build, navigation, search and sitemap.
