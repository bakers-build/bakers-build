# Configure your workflow

**`WORKFLOW.md` at your repository root tells the agents how your project works.**

**You need:** a [connected project](/get-started/connect-a-project).

## Let your agent write it

```text
Use bakers:init-project to create WORKFLOW.md for this repository and check that it is valid.
```

`init-project` starts from the plugin's template; `upgrade-project` updates a file you already have.

## What goes in

| Section | Job |
|---|---|
| `## Loaded skills` | The skills that own your steps, one `- @<namespace>/<skill>` bullet each, in load order. The only section bakers.build's loader reads. |
| `## Skill set` | Your engineering method, such as Superpowers. The first entry is the default; with several, qualification asks and records a `method:*` label. |
| `## Skills` | Extra skills when a change matches, for example a Drupal skill for `web/modules/`. |
| `## Checks` | Commands to run for matching changes, with a `### Setup` table. |
| `## Required skills` | Makes the named skills binding: load first, stop if missing. |
| `## Standards` | Links to the conventions that apply. |

## Two examples

Same states, different work. A Drupal code project:

```md
## Loaded skills

- @bakers-build/essential-skills
- @bakers-build/method-context
- @bakers-build/ddev-drupal-bug
- @bakers-build/ddev-drupal-feature
```

A documentation project swaps the code owners for `@bakers-build/docs-authoring` and lists its prose checks under `## Checks`. A repository with both loads all of them; each `work:*` label then gets its own owner.

`@bakers-build/essential-skills` brings qualification, spec, deployment and verification. The Drupal skills are examples; load your own skills for other stacks.

## Adjust one skill

Indent a YAML map under a skill's bullet to change one of its declared inputs, for example the health check after a deployment:

```md
- @bakers-build/post-deployment
    health.prompt: |
      Expect HTTP 200 from /user/login after the deploy.
```

Declared inputs: `release.prompt` (`prepare-deployment`), `health.prompt` (`post-deployment`), `verify.prompt` (`verify-on-environment`), `origin_labels.data` (`publish-origin-status`). An unknown input fails the check. Every list item at indent 0 under `## Loaded skills` is a real load, so keep examples elsewhere.

**Done when:** your agent reports the file as valid. [How it works](/skills-and-workflows/how-it-works) explains the check.
