<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\Form\EnforcedResponseException;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Render\Element;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\Form\AccountActionsForm;
use Drupal\bb_track\WorkAssignments;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A billing account's detail page and the actions it hosts.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class AccountDetailTest extends WorkTimeTestBase {

  /**
   * The submitted value of each action, its label.
   */
  private const array LABELS = ['make_default' => 'Make default', 'archive' => 'Archive'];

  /**
   * The detail offers exactly the actions the default/link rules allow.
   */
  public function testDetailOffersOnlyAllowedActions(): void {
    $unlinked = $this->assignments()->saveAccount($this->projectId(), ['name' => 'Unlinked']);
    $linked = $this->assignments()->saveAccount($this->projectId(), ['name' => 'Linked']);
    $ticket = $this->ticket('Linked ticket');
    $this->assignments()->linkTicket((int) $ticket->id(), (int) $linked->id(), 0);

    self::assertSame(['edit'], $this->actions($this->load($this->accountId)));
    self::assertSame(['edit', 'make_default', 'archive'], $this->actions($unlinked));
    self::assertSame(['edit', 'archive'], $this->actions($this->load((int) $linked->id())));
    $edit = $this->actionsForm($unlinked)['actions']['edit'];
    self::assertStringContainsString('destination=' . $unlinked->toUrl()->toString(), $edit['#props']['href'], 'Edit returns to the detail.');
  }

  /**
   * The detail is the account's canonical page under its project.
   */
  public function testCanonicalRouteIsTheDetail(): void {
    $account = $this->load($this->accountId);
    self::assertSame('entity.bb_track_account.canonical', $account->toUrl()->getRouteName());
    self::assertStringEndsWith('/project/' . $this->project->uuid() . '/accounts/' . $this->accountId, $account->toUrl()->toString());
  }

  /**
   * Make default moves the flag and returns to the detail.
   */
  public function testMakeDefault(): void {
    $next = $this->assignments()->saveAccount($this->projectId(), ['name' => 'Next']);
    $state = $this->press($next, 'make_default');
    self::assertSame((int) $next->id(), (int) $this->assignments()->defaultAccount($this->projectId())->id());
    self::assertSame('entity.bb_track_account.canonical', $state->getRedirect()->getRouteName());
  }

  /**
   * An archived account keeps its values and its detail is read-only.
   */
  public function testArchiveLeavesReadOnlyDetail(): void {
    $other = $this->assignments()->saveAccount($this->projectId(), ['name' => 'Pilot', 'external_id' => 'HARV-P']);
    $state = $this->press($other, 'archive');
    self::assertSame('entity.bb_track_account.canonical', $state->getRedirect()->getRouteName());
    self::assertArrayNotHasKey((int) $other->id(), $this->assignments()->activeAccounts($this->projectId()));
    $saved = $this->load((int) $other->id());
    self::assertSame('HARV-P', $saved->get('external_id')->value);
    self::assertSame([], $this->actions($saved), 'An archived account is read-only.');
    self::assertTrue($this->routeAccess($saved, $this->employee), 'Its detail stays readable.');
  }

  /**
   * An action that vanished since the page loaded acts on nothing.
   *
   * Form API would otherwise take the first remaining button.
   */
  public function testStaleActionChangesNothing(): void {
    $account = $this->assignments()->saveAccount($this->projectId(), ['name' => 'Soon linked']);
    // Another tab linked a ticket after this page rendered Make default.
    $this->assignments()->linkTicket((int) $this->ticket('Late')->id(), (int) $account->id(), 0);

    $this->post($account, 'make_default');
    self::assertSame($this->accountId, (int) $this->assignments()->defaultAccount($this->projectId())->id());
    self::assertArrayHasKey((int) $account->id(), $this->assignments()->activeAccounts($this->projectId()), 'Not archived either.');
  }

  /**
   * A member without project update access gets no action and no route.
   */
  public function testGuestGetsNoActionAndNoRoute(): void {
    $account = $this->load($this->accountId);
    $this->container->get('current_user')->setAccount($this->peer);
    self::assertSame([], $this->actions($account));
    self::assertFalse($this->routeAccess($account, $this->peer));
    self::assertTrue($this->routeAccess($account, $this->employee));
  }

  /**
   * Another project's account is not readable under this project's URL.
   */
  public function testAccountOfAnotherProjectIsNotFound(): void {
    $other = $this->project->createDuplicate();
    $other->set('key', 'OTHR')->save();
    $foreign = $this->assignments()->saveAccount((int) $other->id(), ['name' => 'Foreign']);
    self::assertFalse($this->routeAccess($foreign, $this->employee));
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
   * The stored account.
   */
  private function load(int $id): Account {
    $account = $this->container->get('entity_type.manager')->getStorage('bb_track_account')->loadUnchanged($id);
    assert($account instanceof Account);
    return $account;
  }

  /**
   * A ticket of the fixture project.
   */
  private function ticket(string $title): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => $title,
      'project_id' => $this->project->id(),
      'workflow' => 'bb_work',
    ]);
    assert($ticket instanceof BbTicketInterface);
    $ticket->save();
    return $ticket;
  }

  /**
   * The detail's actions form for an account.
   *
   * @return array<string, mixed>
   *   The built form.
   */
  private function actionsForm(Account $account): array {
    return $this->container->get('form_builder')->getForm(AccountActionsForm::class, $account);
  }

  /**
   * The keys of the actions the detail offers.
   *
   * @return array<int, string>
   *   The action keys, in order.
   */
  private function actions(Account $account): array {
    // Each request builds the page afresh; so does each call here.
    $this->container->get('entity_type.manager')->getAccessControlHandler('bb_track_account')->resetCache();
    $actions = $this->actionsForm($account)['actions'] ?? [];
    return Element::children($actions);
  }

  /**
   * Presses one action of the detail.
   */
  private function press(Account $account, string $action): FormStateInterface {
    $form_state = new FormState();
    $form_state->addBuildInfo('args', [$account]);
    $form_state->setValues([$action => self::LABELS[$action]]);
    $this->container->get('form_builder')->submitForm(AccountActionsForm::class, $form_state);
    $messages = $this->container->get('messenger')->deleteAll();
    self::assertArrayHasKey('status', $messages, print_r($messages, TRUE));
    // A programmed submit hides its redirect; read it as a browser would.
    return $form_state->setProgrammed(FALSE);
  }

  /**
   * Posts one action the way a browser does, the control possibly stale.
   */
  private function post(Account $account, string $action): void {
    $form_state = new FormState();
    $form_state->addBuildInfo('args', [$account]);
    $form_state->setRequestMethod('POST');
    $form_state->setUserInput([
      'form_id' => 'bb_track_account_actions',
      'form_token' => $this->container->get('csrf_token')->get('form_token_placeholder_' . Crypt::hashBase64('bb_track_account_actions')),
      $action => self::LABELS[$action],
    ]);
    try {
      $this->container->get('form_builder')->buildForm(AccountActionsForm::class, $form_state);
    }
    catch (EnforcedResponseException) {
      // The redirect after a submit.
    }
  }

  /**
   * Whether an account reaches the account's detail route.
   */
  private function routeAccess(Account $account, mixed $user): bool {
    return $this->container->get('access_manager')->checkNamedRoute('entity.bb_track_account.canonical', [
      'bb_workspace' => 'week',
      'bb_project' => $this->project->uuid(),
      'bb_track_account' => $account->id(),
    ], $user);
  }

}
