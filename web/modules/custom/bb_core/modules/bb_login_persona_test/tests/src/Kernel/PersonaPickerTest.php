<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login_persona_test\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_login_persona_test\Form\PersonaPickerForm;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The persona picker signs in only active `@example.test` accounts.
 *
 * Eligibility is checked when the buttons are built AND again on submit, so
 * a forged or stale submit for a real-domain or blocked account is refused.
 */
#[Group('bb_login')]
#[RunTestsInSeparateProcesses]
final class PersonaPickerTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'ui_patterns', 'file', 'image',
    'bb_core', 'bb_login', 'bb_login_persona_test',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['user', 'system']);
    $request = Request::create('/user/login', 'POST');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
  }

  /**
   * Creates an account with the given address and status.
   */
  private function account(string $name, string $mail, bool $active = TRUE): UserInterface {
    $account = $this->createUser([], $name, FALSE, ['mail' => $mail, 'status' => (int) $active]);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

  /**
   * Builds the login form and returns the picker's button for an account.
   *
   * @return array<string, mixed>|null
   *   The button, or NULL when the picker lists no button for it.
   */
  private function button(UserInterface $account): ?array {
    $form = $this->container->get('form_builder')->getForm(PersonaPickerForm::class);
    foreach (['personas', 'fixtures'] as $group) {
      if (isset($form['test_personas'][$group][PersonaPickerForm::BUTTON_PREFIX . $account->id()])) {
        return $form['test_personas'][$group][PersonaPickerForm::BUTTON_PREFIX . $account->id()];
      }
    }
    return NULL;
  }

  /**
   * Submits the login form as a click on the picker button for a uid.
   */
  private function submitAs(UserInterface $account): FormStateInterface {
    $form_state = new FormState();
    $form_state->setValues([PersonaPickerForm::BUTTON_PREFIX . $account->id() => $account->getAccountName()]);
    $this->container->get('form_builder')->submitForm(PersonaPickerForm::class, $form_state);
    return $form_state;
  }

  /**
   * An active `@example.test` account is listed and signs in with one click.
   */
  public function testEligibleAccountSignsIn(): void {
    $persona = $this->account('north-lead', 'north-lead@example.test');
    $fixture = $this->account('fixture-api-member', 'fixture-api-member@example.test');

    self::assertNotNull($this->button($persona));
    self::assertNotNull($this->button($fixture));
    $form = $this->container->get('form_builder')->getForm(PersonaPickerForm::class);
    self::assertArrayHasKey(PersonaPickerForm::BUTTON_PREFIX . $persona->id(), $form['test_personas']['personas']);
    self::assertArrayHasKey(PersonaPickerForm::BUTTON_PREFIX . $fixture->id(), $form['test_personas']['fixtures']);

    $form_state = $this->submitAs($persona);

    self::assertSame([], $form_state->getErrors());
    self::assertSame((int) $persona->id(), (int) $this->container->get('current_user')->id());
  }

  /**
   * A real-domain account is neither listed nor signed in by a forged submit.
   */
  public function testRealDomainAccountIsRefused(): void {
    $real = $this->account('real-person', 'real-person@example.com');

    self::assertNull($this->button($real));
    $this->submitAs($real);

    self::assertTrue($this->container->get('current_user')->isAnonymous());
  }

  /**
   * A blocked `@example.test` account is neither listed nor signed in.
   */
  public function testBlockedAccountIsRefused(): void {
    $blocked = $this->account('fixture-blocked', 'fixture-blocked@example.test', FALSE);

    self::assertNull($this->button($blocked));
    $this->submitAs($blocked);

    self::assertTrue($this->container->get('current_user')->isAnonymous());
  }

  /**
   * The submit re-checks: a button built while eligible is refused later.
   *
   * This is the stale-form case: the button exists on the page, then the
   * account is blocked before the click arrives.
   */
  public function testSubmitRechecksEligibility(): void {
    $persona = $this->account('south-member', 'south-member@example.test');
    $button = $this->button($persona);
    self::assertNotNull($button);
    $persona->block()->save();

    $form = [];
    $form_state = (new FormState())->setTriggeringElement($button);
    PersonaPickerForm::create($this->container)->validateForm($form, $form_state);

    self::assertNotSame([], $form_state->getErrors());
    self::assertTrue($this->container->get('current_user')->isAnonymous());
  }

}
