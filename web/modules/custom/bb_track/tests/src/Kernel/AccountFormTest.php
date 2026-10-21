<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Form\EnforcedResponseException;
use Drupal\Core\Form\FormState;
use Drupal\Core\Lock\DatabaseLockBackend;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Render\Element;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\Form\AccountEditForm;
use Drupal\bb_track\Form\AccountForm;
use Drupal\bb_track\WorkAssignments;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DependencyInjection\Reference;

/**
 * The project's billing face and its New / Edit dialog.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class AccountFormTest extends WorkTimeTestBase {

  /**
   * {@inheritdoc}
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    // A real lock, so a second holder can keep the account lock busy.
    $container->register('lock', DatabaseLockBackend::class)->addArgument(new Reference('database'));
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->container->get('current_user')->setAccount($this->employee);
  }

  /**
   * Rows offer exactly the actions the default/link rules allow.
   */
  public function testRowsOfferOnlyAllowedActions(): void {
    $unlinked = $this->assignments()->saveAccount(
      $this->projectId(),
      ['name' => 'Unlinked', 'external_id' => 'HARV-1'],
    );
    $linked = $this->assignments()->saveAccount(
      $this->projectId(),
      ['name' => 'Linked'],
    );
    $ticket = $this->ticket('Linked ticket');
    $this->assignments()->linkTicket((int) $ticket->id(), (int) $linked->id(), 0);

    $form = $this->buildForm();
    $controls = $form['controls'];
    self::assertSame(['edit'], Element::children($controls[$this->accountId]));
    self::assertSame(['edit', 'make_default', 'archive'], Element::children($controls[(int) $unlinked->id()]));
    self::assertSame(['edit', 'archive'], Element::children($controls[(int) $linked->id()]));
    // The default leads the list; a row names the tickets it links.
    $items = $form['#bb_zone']['items'];
    self::assertSame('Project work', $items[0]['cells']['name']['value']);
    self::assertSame('Default', $items[0]['cells']['default']['label']);
    self::assertSame('Linked', $items[1]['cells']['name']['value']);
    self::assertStringStartsWith('Linked to ', $items[1]['cells']['tickets']['value']);
  }

  /**
   * Make default moves the flag to the pressed row's account.
   */
  public function testMakeDefault(): void {
    $next = $this->assignments()->saveAccount($this->projectId(), ['name' => 'Next']);
    $this->press('make_default', (int) $next->id(), 'Make default');
    self::assertSame((int) $next->id(), (int) $this->assignments()->defaultAccount($this->projectId())->id());
  }

  /**
   * Archive keeps the row readable among the archived accounts.
   */
  public function testArchiveKeepsTheRow(): void {
    $other = $this->assignments()->saveAccount($this->projectId(), ['name' => 'Pilot', 'external_id' => 'HARV-P']);
    $this->press('archive', (int) $other->id(), 'Archive');
    self::assertArrayNotHasKey((int) $other->id(), $this->assignments()->activeAccounts($this->projectId()));
    $saved = $this->container->get('entity_type.manager')->getStorage('bb_track_account')->loadUnchanged($other->id());
    assert($saved instanceof Account);
    self::assertSame('HARV-P', $saved->get('external_id')->value);
    $form = $this->buildForm();
    self::assertSame('Pilot', $form['#bb_zone']['archived'][0]['cells']['name']['value']);
    self::assertSame('HARV-P', $form['#bb_zone']['archived'][0]['cells']['type']['value']);
    self::assertArrayNotHasKey((int) $other->id(), $form['controls']);
  }

  /**
   * The default has no Archive.
   *
   * A forged one matches no control and writes nothing.
   */
  public function testArchivingTheDefaultIsRefused(): void {
    $this->press('archive', $this->accountId, 'Archive', NULL);
    $reloaded = $this->container->get('entity_type.manager')->getStorage('bb_track_account')->loadUnchanged($this->accountId);
    assert($reloaded instanceof Account);
    self::assertTrue((bool) $reloaded->get('active')->value);
    $default = $this->assignments()->defaultAccount($this->projectId());
    assert($default instanceof Account);
    self::assertSame($this->accountId, (int) $default->id());
  }

  /**
   * A row control that vanished since the page loaded acts on no account.
   *
   * Form API would otherwise take the first remaining button, another row's.
   */
  public function testStaleRowControlChangesNothing(): void {
    $kept = $this->assignments()->saveAccount($this->projectId(), ['name' => 'Kept']);
    $gone = $this->assignments()->saveAccount($this->projectId(), ['name' => 'Gone']);
    // Another tab archived it after this page rendered its Archive.
    $this->assignments()->saveAccount($this->projectId(), [
      'name' => 'Gone',
      'active' => FALSE,
    ], (int) $gone->id());

    $form_state = new FormState();
    $form_state->addBuildInfo('args', [$this->project]);
    $form_state->setRequestMethod('POST');
    $form_state->setUserInput([
      'form_id' => 'bb_track_account',
      'form_token' => $this->container->get('csrf_token')->get('form_token_placeholder_' . Crypt::hashBase64('bb_track_account')),
      'archive_' . $gone->id() => 'Archive',
    ]);
    try {
      $this->container->get('form_builder')->buildForm(AccountForm::class, $form_state);
    }
    catch (EnforcedResponseException) {
      // The redirect after a submit.
    }
    $default = $this->assignments()->defaultAccount($this->projectId());
    assert($default instanceof Account);
    self::assertSame($this->accountId, (int) $default->id());
    self::assertArrayHasKey((int) $kept->id(), $this->assignments()->activeAccounts($this->projectId()));
  }

  /**
   * A busy account lock is a message in the dialog, not an error page.
   */
  public function testBusyLockShowsMessage(): void {
    if ($this->container->get('database')->driver() === 'mysql') {
      // WorkTimeMutation uses GET_LOCK there, not the lock service.
      self::markTestSkipped('Holds the lock through the lock service only.');
    }
    $other_request = new DatabaseLockBackend($this->container->get('database'));
    self::assertTrue($other_request->acquire('bb_track:assignments'));
    $state = $this->submitDialog(NULL, ['name' => 'Kunde X', 'external_id' => 'HARV-2', 'active' => TRUE]);
    $other_request->release('bb_track:assignments');
    self::assertArrayHasKey('error', $this->container->get('messenger')->deleteAll());
    self::assertTrue($state->isRebuilding());
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_track_account')->loadByProperties(['name' => 'Kunde X']));
  }

  /**
   * The dialog creates an unlinked, non-default account, then edits it.
   */
  public function testDialogCreatesAndEdits(): void {
    $state = $this->submitDialog(NULL, ['name' => 'Kunde X maintenance', 'external_id' => 'HARV-3', 'active' => TRUE]);
    self::assertSame([], $state->getErrors());
    $created = current($this->container->get('entity_type.manager')->getStorage('bb_track_account')->loadByProperties(['name' => 'Kunde X maintenance']));
    assert($created instanceof Account);
    self::assertSame('HARV-3', $created->get('external_id')->value);
    self::assertFalse((bool) $created->get('is_default')->value);
    $default = $this->assignments()->defaultAccount($this->projectId());
    assert($default instanceof Account);
    self::assertSame($this->accountId, (int) $default->id());

    $this->submitDialog($created, ['name' => 'Kunde X', 'external_id' => 'HARV-4', 'active' => TRUE]);
    $saved = $this->container->get('entity_type.manager')->getStorage('bb_track_account')->loadUnchanged($created->id());
    assert($saved instanceof Account);
    self::assertSame('Kunde X', (string) $saved->label());
    self::assertSame('HARV-4', $saved->get('external_id')->value);
    self::assertTrue((bool) $saved->get('active')->value);
  }

  /**
   * The dialog offers Active, on for a new account, and can deactivate one.
   */
  public function testDialogActiveDefaultsOnAndDeactivates(): void {
    $form = $this->container->get('form_builder')->getForm(AccountEditForm::class, $this->project, NULL);
    self::assertSame('checkbox', $form['active']['#type']);
    self::assertTrue($form['active']['#default_value']);

    $other = $this->assignments()->saveAccount($this->projectId(), ['name' => 'Seasonal', 'external_id' => 'HARV-S']);
    // An unticked checkbox posts no value; FALSE would mean "not submitted".
    $state = $this->submitDialog($other, ['name' => 'Seasonal', 'external_id' => 'HARV-S', 'active' => NULL]);
    self::assertSame([], $state->getErrors());
    self::assertArrayNotHasKey((int) $other->id(), $this->assignments()->activeAccounts($this->projectId()));
  }

  /**
   * The dialog renders only the fields of the current type and budget.
   */
  public function testDialogShowsOnlyTheTypesFields(): void {
    $form = $this->dialogForm(NULL, []);
    foreach ([$form['billing_type'], $form['terms']['budget_kind']] as $select) {
      self::assertSame('select', $select['#type']);
      self::assertTrue($select['#required']);
    }
    self::assertSame(['none', 'hours', 'amount'], array_keys($form['terms']['budget_kind']['#options']));
    self::assertSame('none', $form['terms']['budget_kind']['#default_value']);
    self::assertSame(['time_material', 'fixed_fee', 'non_billable'], array_keys($form['billing_type']['#options']));
    self::assertSame(['Time & Materials', 'Fixed Fee', 'Non-Billable'], array_map('strval', array_values($form['billing_type']['#options'])));
    self::assertSame('time_material', $form['billing_type']['#default_value']);
    self::assertSame(['budget_kind', 'hourly_rate'], $this->termFields($form));
    self::assertSame('bakers-track-account-terms', $form['terms']['#attributes']['id']);
    foreach (['billing_type', 'budget_kind'] as $trigger) {
      $element = $trigger === 'billing_type' ? $form['billing_type'] : $form['terms']['budget_kind'];
      self::assertSame('change', $element['#attributes']['data-hx-trigger'] ?? NULL, $trigger);
      self::assertSame('#bakers-track-account-terms', $element['#attributes']['data-hx-target'] ?? NULL, $trigger);
    }

    self::assertSame(['fixed_fee', 'budget_kind', 'budget_value', 'hourly_rate'], $this->fieldsFor('fixed_fee', 'amount'));
    self::assertSame(
      ['fixed_fee', 'budget_kind', 'budget_value', 'budget_resets_monthly', 'hourly_rate'],
      $this->fieldsFor('fixed_fee', 'hours'),
    );
    self::assertSame(['budget_kind', 'budget_value', 'budget_resets_monthly', 'hourly_rate'], $this->fieldsFor('time_material', 'amount'));
    self::assertSame([], $this->fieldsFor('non_billable', 'hours'));

    $fixed = $this->assignments()->saveAccount($this->projectId(), [
      'name' => 'Fixed',
      'billing_type' => 'fixed_fee',
      'fixed_fee' => '900',
    ]);
    $edit = $this->dialogForm($fixed, []);
    self::assertSame('fixed_fee', $edit['billing_type']['#default_value']);
    self::assertEquals(900, $edit['terms']['fixed_fee']['#default_value']);
  }

  /**
   * A Fixed Fee account cannot be saved without its fee.
   */
  public function testDialogRejectsFixedFeeWithoutFee(): void {
    $values = [
      'name' => 'Fee less',
      'active' => TRUE,
      'billing_type' => 'fixed_fee',
      'budget_kind' => 'none',
      'fixed_fee' => '',
    ];
    $state = $this->submitDialog(NULL, $values);
    self::assertSame(['fixed_fee'], array_keys($state->getErrors()));
    self::assertNull($this->named('Fee less'));

    $state = $this->submitDialog(NULL, ['fixed_fee' => '1500'] + $values);
    self::assertSame([], $state->getErrors());
    $saved = $this->named('Fee less');
    assert($saved instanceof Account);
    self::assertSame('fixed_fee', $saved->get('billing_type')->value);
    self::assertSame(1500.0, (float) $saved->get('fixed_fee')->value);
  }

  /**
   * Switching the type and saving leaves no value the new type does not show.
   */
  public function testDialogTypeSwitchClearsForeignValues(): void {
    $fixed = [
      'name' => 'Switching',
      'billing_type' => 'fixed_fee',
      'fixed_fee' => '1000',
      'hourly_rate' => '80',
    ];
    $account = $this->assignments()->saveAccount($this->projectId(), [
      'budget_kind' => 'hours',
      'budget_value' => '10',
      'budget_resets_monthly' => TRUE,
    ] + $fixed);
    // Values of the old type's fields still posted by the browser are ignored;
    // the hourly rate, shown for both types, is kept.
    $state = $this->submitDialog($account, [
      'name' => 'Switching',
      'active' => TRUE,
      'billing_type' => 'time_material',
      'budget_kind' => 'none',
      'fixed_fee' => '1000',
    ]);
    self::assertSame([], $state->getErrors());
    $terms = $this->terms($account);
    $terms[5] = (float) $terms[5];
    self::assertSame(['time_material', 'none', NULL, FALSE, NULL, 80.0], $terms);

    $this->assignments()->saveAccount($this->projectId(), $fixed, (int) $account->id());
    $state = $this->submitDialog($account, [
      'name' => 'Switching',
      'active' => TRUE,
      'billing_type' => 'non_billable',
      'hourly_rate' => '80',
    ]);
    self::assertSame([], $state->getErrors());
    self::assertSame(['non_billable', 'none', NULL, FALSE, NULL, NULL], $this->terms($account));
  }

  /**
   * A non-numeric amount is a field error, not a failed write.
   */
  public function testDialogRejectsNonNumericAmount(): void {
    $state = $this->submitDialog(NULL, [
      'name' => 'Comma',
      'active' => TRUE,
      'billing_type' => 'fixed_fee',
      'budget_kind' => 'none',
      'fixed_fee' => '1,5',
    ]);
    self::assertSame(['fixed_fee'], array_keys($state->getErrors()));
    self::assertNull($this->named('Comma'));
  }

  /**
   * A contributor without project update access reaches none of the routes.
   */
  public function testDeniedWithoutProjectUpdateAccess(): void {
    self::assertFalse($this->project->access('update', $this->peer));
    $access_manager = $this->container->get('access_manager');
    $parameters = ['bb_project' => $this->project->uuid(), 'bb_workspace' => 'week'];
    $routes = [
      'bb_track.account' => [],
      'bb_track.account_add' => [],
      'bb_track.account_edit' => ['bb_track_account' => $this->accountId],
    ];
    foreach ($routes as $route => $extra) {
      self::assertTrue($access_manager->checkNamedRoute($route, $parameters + $extra, $this->employee), $route);
      self::assertFalse($access_manager->checkNamedRoute($route, $parameters + $extra, $this->peer), $route);
    }
  }

  /**
   * The assignments service.
   */
  private function assignments(): WorkAssignments {
    return $this->container->get('bb_track.assignments');
  }

  /**
   * The fixture project's id.
   */
  private function projectId(): int {
    return (int) $this->project->id();
  }

  /**
   * A ticket of the fixture project.
   */
  private function ticket(string $title): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => $title,
      'project_id' => $this->project->id(),
      'workflow' => 'bb_feature',
    ]);
    assert($ticket instanceof BbTicketInterface);
    $ticket->save();
    return $ticket;
  }

  /**
   * Builds the billing face for the fixture project.
   */
  private function buildForm(): array {
    return $this->container->get('form_builder')->getForm(AccountForm::class, $this->project);
  }

  /**
   * Presses one row's submit, asserting the outcome message type.
   *
   * @param string $action
   *   The control's action prefix.
   * @param int $id
   *   The row's account id.
   * @param string $label
   *   The control's label.
   * @param string|null $expected
   *   The expected message type, or NULL when nothing may happen.
   */
  private function press(string $action, int $id, string $label, ?string $expected = 'status'): void {
    $form_state = new FormState();
    $form_state->addBuildInfo('args', [$this->project]);
    $form_state->setValues([$action . '_' . $id => $label]);
    $this->container->get('form_builder')->submitForm(AccountForm::class, $form_state);
    $messages = $this->container->get('messenger')->deleteAll();
    if ($expected === NULL) {
      self::assertSame([], $messages);
      return;
    }
    self::assertArrayHasKey($expected, $messages, print_r($messages, TRUE));
  }

  /**
   * Builds the New (NULL) or Edit dialog as a refresh with posted input.
   *
   * @param \Drupal\bb_track\Entity\Account|null $account
   *   The account to edit, or NULL to create.
   * @param array<string, mixed> $input
   *   Posted input.
   */
  private function dialogForm(?Account $account, array $input): array {
    $form_state = new FormState();
    $form_state->addBuildInfo('args', [$this->project, $account]);
    $form_state->setUserInput($input);
    return $this->container->get('form_builder')->buildForm(AccountEditForm::class, $form_state);
  }

  /**
   * The billing-term fields the dialog renders, in order.
   *
   * @return list<string>
   *   Element keys inside the terms wrapper.
   */
  private function termFields(array $form): array {
    $terms = $form['terms'] ?? [];
    return array_values(Element::children($terms, TRUE));
  }

  /**
   * The term fields a new account's dialog renders for a posted type and kind.
   *
   * @return list<string>
   *   Element keys inside the terms wrapper.
   */
  private function fieldsFor(string $type, string $kind): array {
    return $this->termFields($this->dialogForm(NULL, ['billing_type' => $type, 'budget_kind' => $kind]));
  }

  /**
   * The stored account with this name, or NULL.
   */
  private function named(string $name): ?Account {
    $found = current($this->container->get('entity_type.manager')->getStorage('bb_track_account')->loadByProperties(['name' => $name]));
    return $found instanceof Account ? $found : NULL;
  }

  /**
   * The account's stored terms: type, kind, value, reset, fee, rate.
   *
   * @return list<mixed>
   *   The six terms.
   */
  private function terms(Account $account): array {
    $stored = $this->container->get('entity_type.manager')->getStorage('bb_track_account')->loadUnchanged($account->id());
    assert($stored instanceof Account);
    return [
      $stored->get('billing_type')->value,
      $stored->get('budget_kind')->value,
      $stored->get('budget_value')->value,
      (bool) $stored->get('budget_resets_monthly')->value,
      $stored->get('fixed_fee')->value,
      $stored->get('hourly_rate')->value,
    ];
  }

  /**
   * Submits the New (NULL) or Edit dialog.
   *
   * @param \Drupal\bb_track\Entity\Account|null $account
   *   The account to edit, or NULL to create.
   * @param array<string, mixed> $values
   *   Submitted values.
   */
  private function submitDialog(?Account $account, array $values): FormStateInterface {
    $form_state = new FormState();
    $form_state->addBuildInfo('args', [$this->project, $account]);
    $form_state->setValues($values + ['op' => $account ? 'Save' : 'Create billing account']);
    $this->container->get('form_builder')->submitForm(AccountEditForm::class, $form_state);
    return $form_state;
  }

}
