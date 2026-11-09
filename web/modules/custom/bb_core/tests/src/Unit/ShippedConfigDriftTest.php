<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use Symfony\Component\Yaml\Yaml;
use Symfony\Component\HttpFoundation\Request;

/**
 * The two install paths ship the same product configuration (BB-350 D8).
 *
 * A bakers.build instance is configured one of two ways: the server imports
 * `config/sync` with CIM, a fresh or test site is built by `recipes/bakers`.
 * Values that decide where the product LIVES are therefore written twice, and
 * nothing but this test compares them.
 *
 * Each has already drifted at least once in this repository:
 *
 * - `system.theme.default`. `config/sync` said `bb_theme`; the recipe never
 *   set a default at all, so a recipe world booted on `stark`. The drift was
 *   invisible because BbThemeNegotiator forced `bb_theme` on four route
 *   names by hand, which is exactly why the negotiator looked load-bearing.
 *   With it deleted the default theme is the only mechanism left, so a recipe
 *   world that disagrees with `config/sync` is a visible regression.
 * - `system.site.page.front`. The workspace-scoped dashboard is only reachable
 * at   a literal that both paths agree on.
 *
 * A THIRD case was retired by BB-378 — the dashboard page layout's `pages:`
 * condition, which used to exist in three copies (`config/sync`, the module's
 * `config/optional`, the recipe's `config/`). All three files are deleted; see
 * the retirement docblock further down, which keeps the failure mode on record
 * for whoever rebuilds the dashboard.
 *
 * Runs without a bootstrapped site: every path is resolved from __DIR__.
 */
#[Group('bb_core')]
final class ShippedConfigDriftTest extends UnitTestCase {

  /**
   * Both install paths agree on the default theme.
   */
  public function testBothInstallPathsAgreeOnTheDefaultTheme(): void {
    $sync = $this->parse('config/sync/system.theme.yml');
    self::assertSame(
      'bb_theme',
      $sync['default'] ?? NULL,
      'config/sync ships bb_theme as the site default.',
    );

    self::assertSame(
      $sync['default'],
      $this->recipeSimpleConfigUpdate('system.theme')['default'] ?? NULL,
      'recipes/bakers sets the same default theme config/sync ships.',
    );
    self::assertContains(
      $sync['default'],
      $this->recipe()['install'] ?? [],
      'recipes/bakers installs the theme it then makes the default.',
    );
  }

  /**
   * Both install paths agree on the front-page literal, and it is `/home`.
   *
   * Route EXISTENCE is not asserted here and cannot be: this is a Unit test
   * that parses YAML and has no router. What it pins is the literal the two
   * paths agree on.
   *
   * WHY `/home` — and this is a replacement of the old reasoning rather than an
   * edit of it, because the sentence it rested on is no longer true. It used to
   * say there was no workspace-level landing page to point at, which was a
   * measurement of BB-396's tree and is now false: BB-415 built the landing
   * page. `/home` is `bb_core.home`, this product's own route, and it is the
   * only path that can be the front page of a MULTI-TENANT control plane. Every
   * other candidate names one tenant — `/bakers/tickets` is a workspace's My
   * work list and would be the wrong answer for everybody who is not in
   * `bakers` — and `/user` reached a page that exists but is not the operator's
   * work.
   *
   * WHY IT CANNOT ROT, which is the property `/user` was chosen for and this
   * literal has to earn differently. `/user` could not rot because core owns
   * it. `/home` cannot rot for two reasons of our own: `bb_core` declares the
   * route, and `bb_core` is what `system.site.front` is shipped alongside, so
   * the two cannot part company; and `home` is on
   * `BbWorkspaceSlugConstraint::RESERVED`, so no workspace can ever claim the
   * segment and shadow it. Without that reservation the failure would be
   * silent — `BbWorkspacePathProcessor` would rewrite `/` into
   * `/_workspace/home`, which matches no route, and the site root would 404
   * with nothing in the log naming the cause.
   *
   * The anonymous entry point is unchanged: 403 → r4032login →
   * `/user/login?destination=/home`.
   */
  public function testBothInstallPathsAgreeOnTheFrontPage(): void {
    $front = $this->parse('config/sync/system.site.yml')['page']['front'] ?? NULL;
    self::assertSame('/home', $front);
    self::assertSame(
      $front,
      $this->recipeSimpleConfigUpdate('system.site')['page.front'] ?? NULL,
      'recipes/bakers points the front page at the same path config/sync does.',
    );
  }

  /**
   * Both install paths send mail through the shared HTML backend.
   *
   * The recipe changes only the backend: `mailer_dsn` belongs to the
   * operator and must not be overwritten by a recipe application.
   */
  public function testBothInstallPathsSelectTheHtmlMailBackend(): void {
    self::assertSame(
      'bb_html_mail',
      $this->parse('config/sync/system.mail.yml')['interface']['default'] ?? NULL,
      'config/sync ships bb_html_mail as the default mail backend.',
    );
    self::assertSame(
      ['interface.default' => 'bb_html_mail'],
      $this->recipeSimpleConfigUpdate('system.mail'),
      'recipes/bakers sets only the default mail backend.',
    );
  }

  /**
   * Both install paths sign mail with the same site name: bakers.build.
   */
  public function testBothInstallPathsAgreeOnTheSiteName(): void {
    self::assertSame('bakers.build', $this->parse('config/sync/system.site.yml')['name'] ?? NULL);
    self::assertSame(
      'bakers.build',
      $this->recipeSimpleConfigUpdate('system.site')['name'] ?? NULL,
      'recipes/bakers sets the same site name config/sync ships.',
    );
  }

  /**
   * No shipped account mail asks for a password or a username.
   *
   * A bakers.build account never has a password: sign-in is by mailed link or
   * code, or Google. Core's stock templates say otherwise, so every template
   * the recipe rewrites must match config/sync, and no body on either path may
   * instruct a password again.
   */
  public function testNoAccountMailAsksForPassword(): void {
    $sync = $this->parse('config/sync/user.mail.yml');
    $recipe = $this->recipeSimpleConfigUpdate('user.mail');
    $rewritten = array_keys(array_filter($sync, static fn ($template): bool => is_array($template) && isset($template['body'])));
    self::assertContains('status_canceled', $rewritten);
    foreach ($rewritten as $key) {
      self::assertSame($sync[$key] ?? NULL, $recipe[$key] ?? NULL, "recipes/bakers ships the same $key as config/sync.");
    }
    $templates = array_filter(array_merge(array_values($sync), array_values($recipe)), 'is_array');
    foreach ($templates as $template) {
      $text = strtolower(($template['subject'] ?? '') . "\n" . ($template['body'] ?? ''));
      self::assertDoesNotMatchRegularExpression('/set (your|a) (new )?password|password:|username:/', $text);
      // The button is the one link; a second URL token would repeat it.
      self::assertLessThanOrEqual(1, preg_match_all('/\[(user|bakers|site):[a-z-]*url[a-z-]*\]/', $text));
    }
  }

  /**
   * The independent installation trusts only its host and ingress subnet.
   *
   * Runs isolated because trusted proxies are process-global Request state.
   */
  #[RunInSeparateProcess]
  public function testSelfHostedTrustBoundary(): void {
    $settings = $this->selfHostedSettings([]);
    self::assertSame(['^app\\.example\\.test$'], $settings['trusted_host_patterns']);
    self::assertSame(['172.30.42.0/24'], $settings['reverse_proxy_addresses']);
    self::assertSame(26, $settings['reverse_proxy_trusted_headers']);
    self::assertSame('private-test-salt', $settings['hash_salt']);
    Request::setTrustedProxies($settings['reverse_proxy_addresses'], $settings['reverse_proxy_trusted_headers']);
    foreach (['198.51.100.10' => 'http', '172.30.42.5' => 'https'] as $remote => $scheme) {
      $request = Request::create('http://app.example.test', 'GET', [], [], [], [
        'REMOTE_ADDR' => $remote,
        'HTTP_X_FORWARDED_PROTO' => 'https',
        'HTTP_X_FORWARDED_HOST' => 'attacker.example.test',
      ]);
      self::assertSame($scheme, $request->getScheme());
      self::assertSame('app.example.test', $request->getHost());
    }
  }

  /**
   * Missing secrets and invalid host/proxy inputs fail closed.
   */
  public function testSelfHostedRejectsInvalidInputs(): void {
    foreach ([
      ['DRUPAL_HASH_SALT' => ''],
      ['DOMAIN' => ''],
      ['DOMAIN' => 'https://app.example.test/path'],
      ['DRUPAL_TRUSTED_PROXY_SUBNET' => '0.0.0.0/0'],
      ['DRUPAL_TRUSTED_PROXY_SUBNET' => 'invalid'],
      ['MAIL_SMTP_DSN' => 'invalid'],
    ] as $overrides) {
      $error = NULL;
      try {
        $this->selfHostedSettings($overrides);
      }
      catch (\RuntimeException $exception) {
        $error = $exception;
      }
      self::assertInstanceOf(\RuntimeException::class, $error, 'Invalid input accepted: ' . key($overrides));
      self::assertStringContainsString((string) key($overrides), $error->getMessage());
    }
  }

  /**
   * Loads the shipped settings with a private, restored test environment.
   */
  private function selfHostedSettings(array $overrides): array {
    $environment = array_replace([
      'BB_SELF_HOSTED' => '1',
      'DB_HOST' => 'db',
      'DOMAIN' => 'app.example.test',
      'DRUPAL_HASH_SALT' => 'private-test-salt',
      'DRUPAL_TRUSTED_PROXY_SUBNET' => '172.30.42.0/24',
      'MAIL_SMTP_DSN' => 'smtp://smtp.example.test:587',
      'MAIL_FROM_ADDRESS' => 'sender@example.test',
    ], $overrides);
    $previous = [];
    foreach ($environment as $name => $value) {
      $previous[$name] = getenv($name);
      putenv($name . '=' . $value);
    }
    try {
      $settings = ['trusted_host_patterns' => ['.*']];
      include $this->repositoryRoot() . '/web/sites/default/settings.komodo.php';
      return $settings;
    }
    finally {
      foreach ($previous as $name => $value) {
        putenv($value === FALSE ? $name : $name . '=' . $value);
      }
    }
  }

  /**
   * An SMTP DSN on Komodo changes the transport, never the HTML backend.
   */
  public function testKomodoSmtpKeepsTheHtmlMailBackend(): void {
    $file = $this->repositoryRoot() . '/web/sites/default/settings.komodo.php';
    putenv('MAIL_SMTP_DSN=smtp://mailer%40example.com:p%40ss@smtp.example.com:587?verify_peer=0');
    try {
      $config = (static function (string $file): array {
        $config = $settings = $databases = [];
        include $file;
        /** @var array<string, array<string, mixed>> $config */
        return $config;
      })($file);
    }
    finally {
      putenv('MAIL_SMTP_DSN');
    }
    self::assertSame('bb_html_mail', $config['system.mail']['interface']['default'] ?? NULL);
    self::assertSame([
      'scheme' => 'smtp',
      'host' => 'smtp.example.com',
      'user' => 'mailer@example.com',
      'password' => 'p@ss',
      'port' => 587,
      'options' => ['verify_peer' => '0'],
    ], $config['system.mail']['mailer_dsn'] ?? NULL);
  }

  /**
   * The `island` module is installed by BOTH install paths (BB-398 D7).
   *
   * The module is path-based custom code and not a composer package, so
   * nothing enables it implicitly: a missing name in either file leaves the
   * whole island link layer as unreachable code, and silently — an absent
   * module raises no error, its hooks simply never fire.
   */
  public function testIslandIsInstalledByBothPaths(): void {
    self::assertArrayHasKey(
      'island',
      $this->parse('config/sync/core.extension.yml')['module'] ?? [],
      'config/sync/core.extension.yml installs island.',
    );

    self::assertContains(
      'island',
      $this->recipe()['install'] ?? [],
      'recipes/bakers/recipe.yml installs island.',
    );
  }

  /**
   * The backend reduction (BB-683) left both install paths agreeing.
   *
   * `admin_toolbar`, `gin_toolbar`, `toolbar`, `update`, `migrate` and
   * `formblock` are retired — gone from `config/sync/core.extension.yml` and
   * (where they were ever named) from the recipe `install:` lists.
   * `dynamic_page_cache` is added to both. `field_ui`, `ui_patterns_library`,
   * `ui_patterns_field` and `views_autocomplete_filters` are UNCHANGED: each
   * still has an enabled dependent
   * (`display_builder`/`display_builder_entity_view`, `island_ui_patterns`)
   * or live shipped Views consumers
   * (`views_autocomplete_filters`, by plugin class, not module name), so
   * removing them is a separate, still-open decision — this test only pins
   * what this ticket actually did.
   */
  public function testBackendReductionRetiredModulesAreGoneFromBothPaths(): void {
    $modules = $this->parse('config/sync/core.extension.yml')['module'] ?? [];
    $recipe_install = array_merge(
      $this->parse('recipes/bb_base/recipe.yml')['install'] ?? [],
      $this->recipe()['install'] ?? [],
    );

    foreach ([
      'admin_toolbar',
      'gin_toolbar',
      'toolbar',
      'update',
      'migrate',
      'formblock',
      // Uninstalled; its code stays until it is deleted.
      'bb_connector',
    ] as $retired) {
      self::assertArrayNotHasKey(
        $retired,
        $modules,
        "config/sync/core.extension.yml no longer installs $retired.",
      );
      self::assertNotContains(
        $retired,
        $recipe_install,
        "No bakers recipe installs $retired any more.",
      );
    }

    self::assertArrayHasKey(
      'dynamic_page_cache',
      $modules,
      'config/sync/core.extension.yml installs dynamic_page_cache.',
    );
    self::assertContains(
      'dynamic_page_cache',
      $this->parse('recipes/bb_base/recipe.yml')['install'] ?? [],
      'recipes/bb_base installs dynamic_page_cache.',
    );

    foreach (['field_ui', 'ui_patterns_library', 'ui_patterns_field', 'views_autocomplete_filters'] as $kept) {
      self::assertArrayHasKey(
        $kept,
        $modules,
        "$kept stays installed: it still has a live dependent or configuration.",
      );
    }
  }

  /**
   * Neither install path ships an admin theme or the menu administration UI.
   *
   * Every route renders in bb_theme; `field_ui` stays pinned by the test
   * above because `display_builder_entity_view` depends on it.
   */
  public function testNoAdminThemeOrMenuUiOnEitherPath(): void {
    $extensions = $this->parse('config/sync/core.extension.yml');
    $recipe_install = array_merge(
      $this->parse('recipes/bb_base/recipe.yml')['install'] ?? [],
      $this->recipe()['install'] ?? [],
    );
    foreach (['menu_ui', 'gin', 'claro'] as $retired) {
      self::assertArrayNotHasKey($retired, $extensions['module'] ?? [], "config/sync does not install the module $retired.");
      self::assertArrayNotHasKey($retired, $extensions['theme'] ?? [], "config/sync does not install the theme $retired.");
      self::assertNotContains($retired, $recipe_install, "No bakers recipe installs $retired.");
    }
    self::assertSame('', $this->parse('config/sync/system.theme.yml')['admin'] ?? NULL, 'config/sync sets no admin theme.');
    $base = $this->parse('recipes/bb_base/recipe.yml')['config']['actions']['system.theme']['simpleConfigUpdate'] ?? [];
    self::assertSame('', $base['admin'] ?? NULL, 'recipes/bb_base sets no admin theme.');
  }

  /**
   * RETIRED (BB-389) — Drupal\Tests\bb_dashboard\Functional\FrontPageTest.
   *
   * Recorded here because that class is deleted and this one is what remains of
   * the front-page contract. It asserted the BEHAVIOUR the two literals above
   * were supposed to produce: the site root renders the dashboard for a member,
   * and an anonymous root request lands on the login form, not a raw 403.
   *
   * It goes because its subject is gone. `bb_dashboard` is out of the
   * installed set, so no shipped install path produces a site whose root
   * renders a dashboard. The test itself would still have passed — it installed
   * the module by hand in setUp() and set page.front itself — and that is
   * exactly the objection: a green test asserting a product behaviour the
   * shipped config no longer produces hides the regression instead of reporting
   * it. Deleting it makes the loss visible.
   *
   * The other half of what it covered survives elsewhere and is worth knowing:
   * the anonymous-root-to-login behaviour is r4032login's, configured by the
   * `r4032login.settings` action in the same recipe, and it is independent of
   * which module owns the front route.
   *
   * The remaining fourteen bb_dashboard test files are deliberately KEPT with
   * the module's dormant code. They install the module themselves and test its
   * own behaviour, which is unchanged; they are what makes the code revivable.
   */

  /**
   * RETIRED (BB-378) — testEveryPageLayoutCopyMatchesTheWorkspaceDashboard().
   *
   * The third case this class asserted compared the `pages:` request-path
   * condition across the THREE copies of the dashboard page layout
   * (`config/sync`, `bb_dashboard/config/optional`, `recipes/bakers/config`).
   * All three files are deleted, so there is nothing left to compare.
   *
   * It is retired rather than migrated because the FACT is gone, not renamed.
   * The layout existed to render the retired Drupal dashboard through the SDCs
   * `bb_theme:section`, `bb_theme:filter-bar` and their siblings; BB-378
   * deleted every one of those components, on the decision that only the
   * Designbook/Storybook surface counts and that the Drupal side is to be
   * rewired wholesale later. A condition on a layout that renders nothing is
   * not a fact worth guarding. Note the retirement is narrow: the two cases
   * above — the default theme and the front page — are untouched, and both
   * still compare `config/sync` against `recipes/bakers`.
   *
   * The failure mode it caught, kept on record because whatever rebuilds the
   * dashboard will want this assertion back, keyed on ITS config: a copy whose
   * condition matched a path with no workspace in it did not fail quietly — the
   * layout rendered anyway, including on the 404 page, and the board fragment
   * then asked for a workspace URL it had no workspace for, throwing
   * MissingMandatoryParametersException. An HTTP 500 where a 404 belongs.
   *
   * Two measured facts fixed the expected value, and both still hold. Core's
   * RequestPath condition matches the INTERNAL path, so a workspace dashboard
   * reaches it carrying the `_workspace` prefix
   * \Drupal\bb_core\PathProcessor\BbWorkspacePathProcessor adds, and that
   * processor adds it only when the first segment really is a workspace slug.
   * And Drupal's PathMatcher expands a wildcard to `.` followed by a
   * quantifier, which crosses slashes, so a root-level wildcard form also
   * matched `/admin/bakers/dashboard` and `/nope/dashboard` — measured on the
   * running site as 500 on both, against 404 on both plus `/bakers/dashboard`
   * still 200 for the internal form. Compose the expected value from
   * BbWorkspacePathProcessor::PREFIX rather than writing the segment out by
   * hand, so renaming the prefix fails in the test instead of leaving the
   * config copies quietly agreeing on a segment the router no longer produces.
   */

  /**
   * Parses a YAML file relative to the repository root.
   *
   * @param string $relative
   *   The path relative to the repository root.
   *
   * @return array<string, mixed>
   *   The parsed data.
   */
  private function parse(string $relative): array {
    $file = $this->repositoryRoot() . '/' . $relative;
    self::assertFileExists($file);
    $data = Yaml::parseFile($file);
    self::assertIsArray($data);
    return $data;
  }

  /**
   * Returns the parsed `recipes/bakers/recipe.yml`.
   *
   * @return array<string, mixed>
   *   The parsed recipe.
   */
  private function recipe(): array {
    return $this->parse('recipes/bakers/recipe.yml');
  }

  /**
   * Returns a config action's simpleConfigUpdate payload from the recipe.
   *
   * @param string $config_name
   *   The config object the action targets.
   *
   * @return array<string, mixed>
   *   The values the action writes; an empty array when there is no such
   *   action, so the caller's assertion names the missing value.
   */
  private function recipeSimpleConfigUpdate(string $config_name): array {
    $action = $this->recipe()['config']['actions'][$config_name]['simpleConfigUpdate'] ?? [];
    return is_array($action) ? $action : [];
  }

  /**
   * Resolves the repository root from this file's own location.
   *
   * The walk is tests/src/Unit -> src -> tests -> bb_core -> custom ->
   * modules -> web -> the repository root: seven levels, as in
   * ConfigCopyDriftTest.
   */
  private function repositoryRoot(): string {
    return dirname(__DIR__, 7);
  }

}
