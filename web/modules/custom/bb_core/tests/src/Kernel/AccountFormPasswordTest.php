<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\Entity\User;

/**
 * Sign-in is passwordless, so no account form offers a password.
 *
 * @group bb_core
 */
final class AccountFormPasswordTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = ['file', 'image', 'system', 'user', 'options', 'bb_core'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['user']);
  }

  /**
   * The edit form carries neither element.
   */
  public function testEditFormHasNoPasswordFields(): void {
    $account = $this->createUser();
    self::assertInstanceOf(User::class, $account);
    $this->setCurrentUser($account);

    $form = \Drupal::service('entity.form_builder')->getForm($account, 'default');

    self::assertArrayNotHasKey('pass', $form['account']);
    self::assertArrayNotHasKey('current_pass', $form['account']);
  }

  /**
   * The register form carries neither element either — AC 4 is general.
   */
  public function testRegisterFormHasNoPasswordFields(): void {
    $form = \Drupal::service('entity.form_builder')->getForm(User::create([]), 'register');

    self::assertArrayNotHasKey('pass', $form['account']);
    self::assertArrayNotHasKey('current_pass', $form['account']);
  }

  /**
   * Self-edit with a changed email produces no ProtectedUserField violation.
   *
   * bakers.build removes current_pass from AccountForm, but the constraint on mail/pass
   * still fires on self-edit. bb_core_form_alter() sets user_pass_reset in
   * form_state so AccountForm::buildEntity() sets the skip flag to TRUE.
   */
  public function testSelfEditAllowsEmailChangeWithoutCurrentPassword(): void {
    $account = $this->createUser([], NULL, FALSE, ['mail' => 'original@example.com']);
    self::assertInstanceOf(User::class, $account);
    $this->setCurrentUser($account);

    $form_object = \Drupal::service('entity_type.manager')->getFormObject('user', 'default');
    $form_object->setEntity($account);

    $form_state = new FormState();
    $form_builder = \Drupal::service('form_builder');
    $form_builder->buildForm($form_object, $form_state);

    $form_state->setValue('mail', 'changed@example.com');
    $form_state->setValue('timezone', 'UTC');
    $form_builder->submitForm($form_object, $form_state);

    if ($errors = $form_state->getErrors()) {
      self::fail('Form errors: ' . print_r($errors, TRUE));
    }
    self::assertEmpty($form_state->getErrors());
  }

}
