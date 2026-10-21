<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_oauth_device\Unit;

use Drupal\Core\Entity\ContentEntityFormInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Bb_theme_form_alter() wraps buttons only on the two named gate forms.
 *
 * A prior pass appended `input__submit__bb_button` to every submit action
 * of every form on the site, unconditionally (BB-496 review finding 4).
 * Every other form already states its own wrapper directly in PHP; only
 * `/oauth/authorize` (contrib's own consent form) and `/oauth/device`
 * (`DeviceVerificationForm`) needed the hook. This asserts the loop applies
 * to those two form ids and not to an arbitrary third one.
 */
#[Group('bb_oauth_device')]
final class GateFormButtonScopeTest extends UnitTestCase {

  /**
   * Loads the theme file under test.
   */
  protected function setUp(): void {
    parent::setUp();
    require_once dirname(__DIR__, 6) . '/themes/custom/bb_theme/bb_theme.theme';
  }

  /**
   * A minimal form with one submit action, the loop's only precondition.
   */
  private function buildFormWithSubmit(): array {
    return [
      'actions' => [
        'submit' => ['#type' => 'submit'],
      ],
    ];
  }

  /**
   * A form state with no form object, as `bb_theme_form_alter()` reads it.
   */
  private function noOpFormState(): FormStateInterface {
    $formState = $this->createMock(FormStateInterface::class);
    $formState->method('getFormObject')->willReturn(NULL);
    return $formState;
  }

  /**
   * The device verification form gets the button wrapper.
   */
  public function testTheDeviceVerificationFormIsWrapped(): void {
    $form = $this->buildFormWithSubmit();
    bb_theme_form_alter($form, $this->noOpFormState(), 'bb_oauth_device_verify');
    self::assertContains('input__submit__bb_button', $form['actions']['submit']['#theme_wrappers'] ?? []);
  }

  /**
   * The contrib OAuth consent form gets the button wrapper.
   */
  public function testTheOauthAuthorizeConsentFormIsWrapped(): void {
    $form = $this->buildFormWithSubmit();
    bb_theme_form_alter($form, $this->noOpFormState(), 'simple_oauth_authorize_form');
    self::assertContains('input__submit__bb_button', $form['actions']['submit']['#theme_wrappers'] ?? []);
  }

  /**
   * A form outside the allow-list keeps its own submit untouched.
   */
  public function testAnUnrelatedFormIsNotWrapped(): void {
    $form = $this->buildFormWithSubmit();
    bb_theme_form_alter($form, $this->noOpFormState(), 'user_pass');
    self::assertArrayNotHasKey('#theme_wrappers', $form['actions']['submit']);
  }

  /**
   * A full-page content-entity edit form still gets the base button wrapper.
   *
   * BB-496 review finding A: the pass that scoped the loop above to the two
   * gate forms also deleted the base `ContentEntityFormInterface` block that
   * wrapped every other full-page entity edit form's submit — and never
   * restored it. This exercises that branch directly, which the three cases
   * above cannot: they all pass a form object of `NULL`.
   */
  public function testContentEntityEditFormIsWrapped(): void {
    $form = $this->buildFormWithSubmit();
    $formObject = $this->createMock(ContentEntityFormInterface::class);
    $formState = $this->createMock(FormStateInterface::class);
    $formState->method('getFormObject')->willReturn($formObject);
    bb_theme_form_alter($form, $formState, 'bb_project_edit_form');
    self::assertContains('input__submit__bb_button', $form['actions']['submit']['#theme_wrappers'] ?? []);
  }

}
