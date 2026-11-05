# Detection and Verification

Use structured Composer output and freshly fetched Drupal Update status. Read
current CLI help for installed versions; preserve stdout, stderr, and the actual
command exit code. Findings may produce a nonzero exit; failed or unavailable
checks are unknown, never clean results. Avoid regex extraction of package names.

| Mode | Detect | Complete when |
|------|--------|---------------|
| security | Composer audit advisories, including transitives, and Drupal Update `NOT_SECURE`. | Targeted advisories are absent from a fresh audit and selected Drupal projects are no longer `NOT_SECURE`; report unresolved and out-of-scope findings. |
| patch / minor | Composer outdated filtered to the selected packages and permitted release series; cross-check Drupal recommendations. | Planned versions are installed and no eligible updates remain within the requested series; explain blocked targets. |
| major | Stable major candidates and upstream upgrade guidance; use the major reference for compatibility. | Planned versions, database updates, and affected checks pass; no stable target means unavailable, not success. |

Security-update lists can remain populated after a fix: use Drupal's status field.
For patch/minor, `CURRENT` corroborates success, but a recommendation outside the
permitted series is not an in-scope failure. Unknown or stale status needs investigation.
Never use disappearance from Upgrade Status output as update verification.

## Scoped resolution

- For security, bound selected package versions individually. A global patch-only
  restriction can block required minor updates to transitive dependencies.
- Temporary Composer constraints must fit manifest constraints and accompany an
  explicit package selection. Inspect actual versions and the lock diff afterward.
- If an unrelated locked advisory blocks a scoped fix, report the conflict and seek
  authorization to expand scope or use a one-run security-blocking exception.
  Never persist that exception or suppress the final audit; report remaining exposure.
- If DDEV's Composer wrapper loses audit output on a findings exit code, run Composer
  directly through DDEV exec. Drush 13 removed pm:security; use Composer audit.
- Capture producer exit codes through logging pipelines. Check available Drush log
  commands and options; missing output or hidden errors do not prove site health.

Reference: [Composer CLI](https://getcomposer.org/doc/03-cli.md),
[Drupal Update status](https://api.drupal.org/api/drupal/core!modules!update!src!UpdateManagerInterface.php/11.x),
[Upgrade Status](https://www.drupal.org/project/upgrade_status).
