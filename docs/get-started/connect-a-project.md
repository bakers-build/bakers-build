# Connect your project

**Bring your repository into bakers.build. Your agent sets it up and checks the result.**

**You need:** your agent [set up with bakers.build](/get-started/install) and the repository open in it. Your team already uses bakers.build here? Go straight to [your first ticket](/get-started/first-ticket).

## Skill wizard — recommended

Paste this prompt:

```text
Use `bakers:init-project` to connect this checkout as a bakers.build project.
```

Your agent:

- **Connects:** finds the bakers.build project or creates it with you.
- **Asks:** which step skills fit your stack (Drupal with DDEV and documentation ship today; [write your own](/advanced/development/write-a-step-skill) for another stack), which method and which hooks your project uses.
- **Prepares:** adds `WORKFLOW.md` and a short onboarding note to the README.
- **Checks:** confirms access and a valid workflow.

**Done when:** your agent reports all checks green.

## Next

[Run your first ticket →](/get-started/first-ticket)

Prefer the terminal? [Connect a project by hand](/advanced/cli/connect-a-project).
