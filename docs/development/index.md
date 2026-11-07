# Development

Change bakers.build itself, build from source and validate contributions. Start with [the contributor guide](/development/contributing) and the checkout's `CLAUDE.md` and `WORKFLOW.md`; their current checks govern your change.

Choose the guide for the part of the product you want to work on.

<DocQuickLinks aria-label="Product development guides" :items="[
  { label: 'Build the CLI from source', text: 'Prepare a working CLI build from your checkout.', link: '/development/build-from-source' },
  { label: 'Architecture', text: 'Understand package layers and server boundaries.', link: '/development/architecture' },
  { label: 'UI islands and profiles', text: 'Understand how Drupal pages select and compose UI fragments.', link: '/development/islands-and-profiles' },
  { label: 'Skill contract', text: 'Learn how lifecycle instructions, recipes and project hints fit together.', link: '/development/skill-contract' },
  { label: 'Test a skill', text: 'Generate a synthetic example and replay its checks.', link: '/development/test-skills' },
  { label: 'Write the docs', text: 'Find topic ownership, writing rules and site checks.', link: '/development/write-docs' }
]" />

User extensions belong in [Addons](/addons/); project methods belong in [Skills & Workflows](/skills-and-workflows/). You do not need to change the product to configure an existing worker.

Repository-only operating conventions remain under `docs/bakers/` in the source checkout. Public contributor guides here describe the work and link to those conventions where needed.
