<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login\Kernel;

use Drupal\bb_login\Form\BbCodeForm;
use Drupal\KernelTests\KernelTestBase;

/**
 * The confirmation screen carries its own heading.
 *
 * @group bb_login
 */
final class BbCodeFormHeadingTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = ['system', 'user', 'ui_patterns', 'file', 'image', 'bb_core', 'bb_login'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['user']);
    // The heading is a bb_theme component, discovered from the active theme.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
  }

  /**
   * The code form renders a heading the gate chrome does not supply.
   */
  public function testCheckMailHeadingIsOnTheForm(): void {
    $form = $this->container->get('form_builder')->getForm(BbCodeForm::class);
    self::assertSame('bb_theme:text', $form['heading']['#component'] ?? NULL);
    self::assertSame('h1', $form['heading']['#props']['as'] ?? NULL);
    self::assertSame('Check your mail', (string) $form['heading']['#props']['text']);

    $html = (string) $this->container->get('renderer')->renderInIsolation($form);
    self::assertMatchesRegularExpression('#<h1[^>]*>Check your mail</h1>#', $html);
  }

}
