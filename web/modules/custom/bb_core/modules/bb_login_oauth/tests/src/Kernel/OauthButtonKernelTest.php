<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login_oauth\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_login\Form\BbLoginForm;

/**
 * The provider button sits in the one gate card beside the e-mail form.
 *
 * REPLACES `OauthButtonTest` (`Functional`, `BrowserTestBase`). This
 * repository's `phpunit.xml` runs only `tests/src/Unit` and
 * `tests/src/Kernel`, and no CI job runs PHPUnit Functional tests at all —
 * `e2e_api` runs Playwright instead. A `BrowserTestBase` assertion here never
 * executed anywhere (BB-476 review, round four, finding 2).
 *
 * ASSERTS ON THE RENDERED MARKUP, NOT THE BUILD ARRAY. A first version of
 * this test read `$form['oauth']['#props']`/`#attributes'` directly, which
 * only restates what `BbLoginForm::buildForm()` had just written a few
 * lines earlier — it is blind to the one failure mode this criterion cares
 * about: SDC drops an undeclared prop silently, leaving the build array
 * untouched while the rendered markup loses it (BB-476 review, round five,
 * finding 2). Rendering the element in isolation and inspecting the HTML
 * closes that gap while still needing no HTTP request and no theme install.
 *
 * @group bb_login_oauth
 */
final class OauthButtonKernelTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'system', 'user', 'options', 'ui_patterns', 'file', 'image', 'bb_core', 'bb_login',
    'social_api', 'social_auth', 'social_auth_google', 'bb_login_oauth',
  ];

  /**
   * {@inheritdoc}
   *
   * `ui_patterns` and the active theme are both present because the site
   * never renders an SDC component without them: `ui_patterns`' node visitor
   * injects prop normalization into every component template, and the theme
   * is where `bb_theme:button` itself is discovered.
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['user']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
  }

  /**
   * The button is unconditional and identical for every visitor.
   */
  public function testButtonIsPresentForEveryVisitor(): void {
    $form = \Drupal::formBuilder()->getForm(BbLoginForm::class);
    $element = $form['oauth'];

    self::assertSame('bb_theme:button', $element['#component']);

    $markup = (string) \Drupal::service('renderer')->renderInIsolation($element);

    self::assertStringContainsString('data-test="oauth-google"', $markup);
    self::assertStringContainsString('href="/user/login/google"', $markup);
    self::assertStringContainsString('Continue with Google', $markup);
    // Identical for everyone: no account-existence signal on the entry surface.
    self::assertStringNotContainsString('account', $markup);
  }

}
