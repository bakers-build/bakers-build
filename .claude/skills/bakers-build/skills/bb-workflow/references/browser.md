# Browser paths and inspection

For a selected browser surface use [results](results.md) for checks/personas/statuses and
[evidence](evidence.md) for durable evidence. Automated suites use [verify](verify.md).

## Paths

At plan, give each required persona its shortest complete path: check/AC IDs, environment,
starting URL, prerequisites, ordered actions and visible expected observations (bugs: current
failure). Separate different personas/outcomes. Use visible interface labels; human paths must
work with the supplied access. Agent paths add saved auth state, useful stable selectors and
before/after screenshot points.

## Inspection

For mode agent, perform browser inspection through
[tool discovery and fallback](tools.md#choose-an-operation) using the project's testing
environment; sandboxed runs use the external runtime tool.
Load saved auth before authenticated actions and verify identity; anonymous paths use anonymous
sessions. Execute the path at the resolved absolute URL and capture specified screenshots.
Record actions/selectors and expected versus observed views, including expected denial, in one
result per check under the shared contracts above.

## Artifacts

Under the transient root use `playwright/logs/` for command-prefixed output, `playwright/images/`
for screenshots, and the tool root for one-off drivers, traces and videos. Use subject/state names.
At review reuse coding artifacts with original revision/scope; explain reruns and suffix fresh
files `-review`. Missing artifacts require a reported gap or fresh authorized inspection.
