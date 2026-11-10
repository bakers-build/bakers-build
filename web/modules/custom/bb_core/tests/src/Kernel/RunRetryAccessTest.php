<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Render\Element;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\user\Entity\User;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * Who may retry or re-dispatch a failed run, and what a stale request does.
 */
#[Group('bb_core')]
final class RunRetryAccessTest extends ClaimKernelTestBase {

  private const string REFUSAL = 'This action is no longer available. The ticket shows its current state.';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'file', 'image',
    'link', 'text', 'bb_core',
    'views', 'filter', 'island', 'bb_property_access_test',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installConfig(['system']);
    $this->container->get('router.builder')->rebuild();
    $admin = User::load(1);
    self::assertInstanceOf(UserInterface::class, $admin);
    $this->actAs($admin);
  }

  /**
   * Retry is offered on the newest failed run of an open, assigned ticket.
   */
  public function testRetryIsOfferedOnTheNewestFailedRun(): void {
    [$ticket, $run] = $this->failedRun();
    self::assertTrue(TicketInterventions::mayRetryRun($run, $ticket));
  }

  /**
   * A guest may not retry or re-dispatch.
   */
  public function testGuestMayNotRetry(): void {
    [$ticket, $run] = $this->failedRun();
    $this->otherConductor();
    $this->actAs(new AnonymousUserSession());
    $ticket = $this->reloadTicket($ticket);
    $run = $this->reloadRun($run);
    self::assertFalse(TicketInterventions::mayRetryRun($run, $ticket));
    self::assertFalse(TicketInterventions::mayRedispatchRun($run, $ticket));
  }

  /**
   * Only the ticket's newest run, and only a failed one, can be retried.
   */
  public function testOnlyTheNewestFailedRunCanBeRetried(): void {
    [$ticket, $older] = $this->failedRun();
    $newer = $this->seedRun($ticket, 'working', 'failed');
    self::assertFalse(TicketInterventions::mayRetryRun($older, $ticket));
    self::assertTrue(TicketInterventions::mayRetryRun($newer, $ticket));

    $done = $this->seedRun($ticket, 'working', 'done');
    self::assertFalse(TicketInterventions::mayRetryRun($done, $ticket));
    self::assertFalse(TicketInterventions::mayRetryRun($newer, $ticket), 'A newer run exists now.');
  }

  /**
   * The newest run is the top row of Run history, which sorts by creation.
   */
  public function testRetryFollowsTheRunHistoryOrder(): void {
    [$ticket, $top] = $this->failedRun();
    $now = $this->container->get('datetime.time')->getRequestTime();
    $created_earlier = $this->seedRun($ticket, 'working', 'failed');
    $created_earlier->set('created', $now - 3600)->save();

    $history = $this->reloadTicket($ticket)->get('runs')->getValue();
    self::assertSame((int) $top->id(), (int) $history[0]['target_id'], 'The run history lists the newest-created run first.');
    self::assertTrue(TicketInterventions::mayRetryRun($top, $ticket));
    self::assertFalse(TicketInterventions::mayRetryRun($created_earlier, $ticket));
  }

  /**
   * What a run offers follows its ticket, newer runs and the conductors.
   */
  public function testRunActionsFollowNewerRunsAndConductors(): void {
    [$ticket, $run] = $this->failedRun();
    $tags = TicketInterventions::runCacheability($run)->getCacheTags();
    foreach (['bb_ticket:' . $ticket->id(), 'bb_run_list', 'bb_ticket_list', 'bb_conductor_list'] as $tag) {
      self::assertContains($tag, $tags);
    }
    $claimed = $this->seedRun($ticket, 'working', 'claimed');
    self::assertSame(60, TicketInterventions::runCacheability($claimed)->getCacheMaxAge(), 'A claim explanation ages.');
  }

  /**
   * A failed run of another ticket cannot be retried through this ticket.
   */
  public function testForeignRunCannotBeRetried(): void {
    [$ticket] = $this->failedRun();
    [, $foreign] = $this->failedRun();
    self::assertFalse(TicketInterventions::mayRetryRun($foreign, $ticket));
  }

  /**
   * A re-dispatch naming a conductor of another project is refused.
   */
  public function testRedispatchRefusesConductorOfAnotherProject(): void {
    [$ticket, $run] = $this->failedRun();
    $this->otherConductor();
    $etm = $this->container->get('entity_type.manager');
    $project = $etm->getStorage('bb_project')->create(['name' => 'Elsewhere']);
    $project->save();
    $owner = $this->conductor->get('owner_user_id')->entity;
    $foreign = $etm->getStorage('bb_conductor')->create([
      'conductor_id' => 'node-elsewhere',
      'label' => 'node-elsewhere',
      'owner_user_id' => $owner->id(),
      'status' => 'online',
      'project_id' => $project->id(),
    ]);
    $foreign->save();

    $this->ask($run, TicketInterventions::REDISPATCH);
    $this->submit($ticket, $this->posted(['conductor' => (string) $foreign->id()]));

    self::assertSame((int) $this->conductor->id(), (int) $this->reloadTicket($ticket)->get('conductor_id')->target_id);
    self::assertNull($this->container->get('bb_core.ticket_retry')->requestedAt($ticket));
  }

  /**
   * A frozen ticket, a blocked ticket and a ticket without conductor refuse.
   */
  public function testNoRetryOnFrozenBlockedOrUnassignedTicket(): void {
    [$ticket, $run] = $this->failedRun();
    $ticket->setFrozen(TRUE)->save();
    self::assertFalse(TicketInterventions::mayRetryRun($run, $this->reloadTicket($ticket)), 'frozen');
    self::assertFalse(TicketInterventions::mayRedispatchRun($run, $this->reloadTicket($ticket)), 'frozen');
    $this->reloadTicket($ticket)->setFrozen(FALSE)->save();
    self::assertTrue(TicketInterventions::mayRetryRun($run, $this->reloadTicket($ticket)));

    $blocker = $this->seedAssignedTicket('working');
    $this->reloadTicket($ticket)->set('blocked_by', [$blocker->id()])->save();
    self::assertFalse(TicketInterventions::mayRetryRun($run, $this->reloadTicket($ticket)), 'blocked');
    $this->reloadTicket($ticket)->set('blocked_by', [])->save();

    $this->reloadTicket($ticket)->setConductor(NULL)->save();
    self::assertFalse(TicketInterventions::mayRetryRun($run, $this->reloadTicket($ticket)), 'no conductor');
  }

  /**
   * Re-dispatch needs another active conductor and conductor edit access.
   */
  public function testRedispatchNeedsAnotherActiveConductorAndEditAccess(): void {
    [$ticket, $run] = $this->failedRun();
    self::assertFalse(TicketInterventions::mayRedispatchRun($run, $ticket), 'No other conductor.');

    $other = $this->otherConductor();
    self::assertTrue(TicketInterventions::mayRedispatchRun($run, $this->reloadTicket($ticket)));
    self::assertSame([(int) $other->id() => 'node-other'], TicketInterventions::redispatchTargets($this->reloadTicket($ticket)));

    $this->container->get('state')->set('bb_property_access_test.denied', ['edit' => ['conductor_id']]);
    self::assertTrue(TicketInterventions::mayRetryRun($run, $this->reloadTicket($ticket)), 'Retry needs no conductor access.');
    self::assertFalse(TicketInterventions::mayRedispatchRun($run, $this->reloadTicket($ticket)), 'No conductor edit access.');
    $this->container->get('state')->delete('bb_property_access_test.denied');

    $other->set('active', FALSE)->save();
    self::assertFalse(TicketInterventions::mayRedispatchRun($run, $this->reloadTicket($ticket)), 'The other conductor is inactive.');
  }

  /**
   * A dialog opened before the ticket froze offers no Retry afterwards.
   */
  public function testStaleDialogIsRefused(): void {
    [$ticket, $run] = $this->failedRun();
    $this->ask($run, TicketInterventions::RETRY);
    self::assertArrayHasKey('bb_confirm', $this->actionForm($ticket)['actions'], 'The dialog offers Retry.');

    $this->reloadTicket($ticket)->setFrozen(TRUE)->save();
    $form = $this->actionForm($ticket);
    self::assertArrayNotHasKey('bb_confirm', $form['actions']);
    self::assertSame(self::REFUSAL, (string) $form['question']['#slots']['body']['#plain_text']);

    $this->submit($ticket, $this->posted());
    self::assertNull($this->container->get('bb_core.ticket_retry')->requestedAt($ticket));
  }

  /**
   * A guest's direct request is refused and changes nothing.
   */
  public function testGuestDirectPostChangesNothing(): void {
    [$ticket, $run] = $this->failedRun();
    $other = $this->otherConductor();
    $this->actAs(new AnonymousUserSession());
    foreach ([TicketInterventions::RETRY, TicketInterventions::REDISPATCH] as $action) {
      $this->ask($run, $action);
      $form = $this->actionForm($ticket);
      self::assertSame(self::REFUSAL, (string) $form['question']['#slots']['body']['#plain_text'], $action);
      self::assertArrayNotHasKey('bb_confirm', $form['actions'], $action);
      $this->submit($ticket, $this->posted(['conductor' => (string) $other->id()]));
    }
    self::assertNull($this->container->get('bb_core.ticket_retry')->requestedAt($ticket));
    self::assertSame((int) $this->conductor->id(), (int) $this->reloadTicket($ticket)->get('conductor_id')->target_id);
  }

  /**
   * An account that may not edit the conductor gets no Re-dispatch dialog.
   */
  public function testRedispatchWithoutConductorEditAccessIsRefused(): void {
    [$ticket, $run] = $this->failedRun();
    $other = $this->otherConductor();
    $this->container->get('state')->set('bb_property_access_test.denied', ['edit' => ['conductor_id']]);
    $this->ask($run, TicketInterventions::REDISPATCH);
    $form = $this->actionForm($ticket);
    self::assertSame(self::REFUSAL, (string) $form['question']['#slots']['body']['#plain_text']);
    $this->submit($ticket, $this->posted(['conductor' => (string) $other->id()]));
    self::assertSame((int) $this->conductor->id(), (int) $this->reloadTicket($ticket)->get('conductor_id')->target_id);
  }

  /**
   * A working ticket with its newest run failed.
   *
   * @return array{0: \Drupal\bb_core\Entity\BbTicketInterface, 1: \Drupal\bb_core\Entity\BbRunInterface}
   *   The ticket and the failed run.
   */
  private function failedRun(): array {
    $ticket = $this->seedAssignedTicket('working');
    return [$this->reloadTicket($ticket), $this->seedRun($ticket, 'working', 'failed')];
  }

  /**
   * A second conductor of the shared owner, on the same project.
   */
  private function otherConductor(): BbConductorInterface {
    $owner = $this->conductor->get('owner_user_id')->entity;
    assert($owner instanceof UserInterface);
    return $this->createConductor($owner, 'node-other', ['plan', 'working', 'review']);
  }

  /**
   * Makes the account the current one.
   */
  private function actAs(AccountInterface $account): void {
    $this->container->get('current_user')->setAccount($account);
  }

  /**
   * Puts a run and an action on the request, as the dialog link does.
   */
  private function ask(BbRunInterface $run, string $action): void {
    $query = $this->container->get('request_stack')->getCurrentRequest()->query;
    $query->set(TicketInterventions::RUN_PARAMETER, $run->uuid());
    $query->set(TicketInterventions::RUN_ACTION_PARAMETER, $action);
  }

  /**
   * The built action form of a ticket.
   *
   * @return array<string, mixed>
   *   The form.
   */
  private function actionForm(BbTicketInterface $ticket): array {
    return $this->container->get('entity.form_builder')->getForm($this->reloadTicket($ticket), 'action');
  }

  /**
   * A POST form state holding the Confirm button and further input.
   *
   * @param array<string, string> $input
   *   Further posted values.
   */
  private function posted(array $input = []): FormState {
    return (new FormState())->setRequestMethod('POST')->setValues(['bb_confirm' => 'x'] + $input);
  }

  /**
   * Submits the action form programmatically, labels as rendered.
   */
  private function submit(BbTicketInterface $ticket, FormState $form_state): void {
    $form = $this->container->get('entity_type.manager')->getFormObject('bb_ticket', 'action');
    $form->setEntity($this->reloadTicket($ticket));
    $render_state = (new FormState())->setRequestMethod('POST');
    $built = $this->container->get('form_builder')->buildForm($form, $render_state);
    $values = $form_state->getValues();
    foreach (array_intersect_key($this->buttonLabels($built), $values) as $name => $label) {
      $values[$name] = $label;
    }
    $form_state->setValues($values);
    $form->setEntity($this->reloadTicket($ticket));
    $this->container->get('form_builder')->submitForm($form, $form_state);
  }

  /**
   * Every submit button's label in a built form, keyed by button name.
   *
   * @param array<string, mixed> $element
   *   A built form or part of one.
   *
   * @return array<string, string>
   *   Labels by name.
   */
  private function buttonLabels(array $element): array {
    $labels = [];
    if (($element['#type'] ?? '') === 'submit' && isset($element['#name'])) {
      $labels[$element['#name']] = (string) $element['#value'];
    }
    foreach (Element::children($element) as $key) {
      $labels += $this->buttonLabels($element[$key]);
    }
    return $labels;
  }

}
