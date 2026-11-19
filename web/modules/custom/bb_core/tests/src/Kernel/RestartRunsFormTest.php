<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Access\AccessResultReasonInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Render\Element;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\bb_core\Access\BbMachineOwnerAccessCheck;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * The Restart runs confirmation on a machine, conductor or ticket.
 *
 * Opening writes nothing; OK cancels the runs of the checked tickets, and a
 * confirm whose ticket list went stale re-renders instead. Only the machine's
 * owner reaches the machine and conductor dialogs; anyone else gets the
 * owner-mismatch 404.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RestartRunsFormTest extends ClaimKernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'file', 'image', 'link', 'text', 'bb_core', 'island',
  ];

  /**
   * The base conductor's machine.
   */
  private BbMachineInterface $machine;

  /**
   * The owner of the machine and its conductors.
   */
  private UserInterface $owner;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_machine');
    $owner = $this->conductor->get('owner_user_id')->entity;
    assert($owner instanceof UserInterface);
    $this->owner = $owner;
    $machine = $this->container->get('entity_type.manager')->getStorage('bb_machine')->create([
      'name' => 'workstation',
      'host_key' => 'workstation',
      'owner_user_id' => $owner->id(),
      'max_parallel' => 5,
    ]);
    assert($machine instanceof BbMachineInterface);
    $machine->save();
    $this->machine = $machine;
    $this->conductor->set('machine', $machine->id())->save();
    $this->container->get('current_user')->setAccount($owner);
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Both levels name the target and the covered runs and write nothing.
   */
  public function testDialogNamesTargetAndRunsAndWritesNothing(): void {
    $ticket = $this->seedAssignedTicket('working');
    $run = $this->seedRun($ticket, 'working', 'running');
    foreach ([$this->conductor, $this->machine] as $target) {
      $form = $this->form($target);
      self::assertStringContainsString($target instanceof BbMachineInterface ? 'workstation' : 'node-base', $this->question($form));
      self::assertSame('checkboxes', $form['tickets']['#type']);
      self::assertSame([(int) $ticket->id()], array_map('intval', array_keys($form['tickets']['#options'])));
      self::assertStringContainsString($ticket->getIdentifier(), (string) $form['tickets']['#options'][$ticket->id()]);
      self::assertSame(array_keys($form['tickets']['#options']), $form['tickets']['#default_value'], 'Every ticket starts checked.');
      self::assertSame(['bb_confirm' => 'OK'], $this->buttonLabels($form));
      self::assertSame('Cancel', $form['actions']['keep']['#props']['label']);
    }
    self::assertSame('running', $this->reloadRun($run)->getRunState());
  }

  /**
   * Cancel is the dialog's close target: the page it was opened over.
   */
  public function testKeepRunsReturnsToTheScreenTheDialogOpenedOver(): void {
    $request = Request::create('/restart', 'GET', ['destination' => '/bakers/machine/7']);
    $request->setSession($this->container->get('request_stack')->getCurrentRequest()->getSession());
    $this->container->get('request_stack')->push($request);
    foreach ([$this->conductor, $this->machine] as $target) {
      $keep = $this->form($target)['actions']['keep']['#props'];
      self::assertSame('/bakers/machine/7', $keep['href']);
      self::assertTrue($keep['attributes']->hasAttribute('data-dialog-cancel'), 'island.dialog.js closes on Esc only through [data-dialog-cancel].');
    }
  }

  /**
   * An offline target says the cleanup and the fresh runs follow its start.
   */
  public function testOfflineTargetSaysCleanupFollowsNextStart(): void {
    $this->seedRun($this->seedAssignedTicket('working'), 'working', 'running');
    self::assertStringNotContainsString('next start', $this->question($this->form($this->conductor)));
    $this->conductor->setStatus('offline')->save();
    foreach ([$this->conductor, $this->machine] as $target) {
      self::assertStringContainsString('next start', $this->question($this->form($target)));
    }
  }

  /**
   * OK cancels the runs of the checked tickets; a stale list writes nothing.
   */
  public function testConfirmCancelsCheckedTicketsAndStaleConfirmRerenders(): void {
    $first_ticket = $this->seedAssignedTicket('working');
    $first = $this->seedRun($first_ticket, 'working', 'running');
    $covered = $this->coveredValue();
    $second_ticket = $this->seedAssignedTicket('plan');
    $second = $this->seedRun($second_ticket, 'plan', 'claimed');

    $this->confirm($this->machine, $covered, [$first_ticket]);
    self::assertSame('running', $this->reloadRun($first)->getRunState());
    self::assertSame('claimed', $this->reloadRun($second)->getRunState());
    self::assertNotEmpty($this->container->get('messenger')->messagesByType('error'));

    $this->confirm($this->machine, $this->coveredValue(), [$second_ticket]);
    self::assertSame('running', $this->reloadRun($first)->getRunState(), 'An unchecked ticket keeps its run.');
    self::assertSame('cancelled', $this->reloadRun($second)->getRunState());
    self::assertStringContainsString('cancelled by claim-base-owner: Restart runs (machine workstation)', (string) $this->reloadRun($second)->getErrorLog());

    $this->confirm($this->machine, $this->coveredValue(), []);
    self::assertSame('running', $this->reloadRun($first)->getRunState(), 'With none checked, OK cancels nothing.');
  }

  /**
   * A ticket's dialog restarts its newest failed run, unparked and plain.
   */
  public function testTicketDialogRestartsItsNewestFailedRun(): void {
    $this->grantTicketEditing();
    $ticket = $this->seedAssignedTicket('plan');
    $failed = $this->seedRun($ticket, 'plan', 'failed');

    $form = $this->form($ticket);
    self::assertArrayNotHasKey('tickets', $form, 'The ticket dialog lists no tickets.');
    self::assertStringContainsString('#' . $failed->id(), $this->question($form));
    self::assertSame(['bb_confirm' => 'OK'], $this->buttonLabels($form));

    $this->confirm($ticket, (string) $ticket->id(), [$ticket]);
    self::assertSame('cancelled', $this->reloadRun($failed)->getRunState());
    self::assertStringContainsString('Restart runs (ticket ' . $ticket->getIdentifier() . ')', (string) $this->reloadRun($failed)->getErrorLog());

    $ticket = $this->seedAssignedTicket('plan');
    $ticket->setFrozen(TRUE);
    $ticket->save();
    $this->seedRun($ticket, 'plan', 'failed');
    self::assertSame([], $this->buttonLabels($this->form($ticket)), 'A frozen ticket is not restarted.');
  }

  /**
   * Only the owner reaches the dialog; others get the not-found verdict.
   */
  public function testOnlyTheOwnerMayRestart(): void {
    $run = $this->seedRun($this->seedAssignedTicket('working'), 'working', 'running');
    $other = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'north-lead', 'status' => 1]);
    $other->save();
    $access = $this->container->get('access_manager');
    $parameters = ['user' => $this->owner->id(), 'bb_machine' => $this->machine->id()];

    self::assertTrue($access->checkNamedRoute('entity.bb_machine.restart_form', $parameters, $this->owner));
    foreach ([$other, new AnonymousUserSession()] as $account) {
      $result = $access->checkNamedRoute('entity.bb_machine.restart_form', $parameters, $account, TRUE);
      self::assertInstanceOf(AccessResultReasonInterface::class, $result);
      self::assertTrue($result->isForbidden());
      self::assertSame(BbMachineOwnerAccessCheck::OWNER_MISMATCH_REASON, $result->getReason());
      self::assertFalse(TicketInterventions::mayRestartRuns($this->machine, $account));
      self::assertFalse(TicketInterventions::mayRestartRuns($this->conductor, $account));
    }

    // A forged post by another account changes no run.
    $this->container->get('current_user')->setAccount($other);
    self::assertSame([], $this->buttonLabels($this->form($this->conductor)));
    $this->confirm($this->conductor, (string) $run->getTicketId(), [$run->getTicket()]);
    self::assertSame('running', $this->reloadRun($run)->getRunState());
  }

  /**
   * A conductor whose machine no longer loads is no one's to restart.
   */
  public function testConductorOfAnUnloadableMachineIsNotOwned(): void {
    $this->conductor->set('machine', 999999)->save();
    $conductor = $this->fresh($this->conductor);
    assert($conductor instanceof BbConductorInterface);
    self::assertNull($conductor->get('machine')->entity);
    self::assertFalse(TicketInterventions::mayRestartRuns($conductor, $this->owner));
  }

  /**
   * The built restart form of a target.
   *
   * @return array<string, mixed>
   *   The form.
   */
  private function form(ContentEntityInterface $target): array {
    return $this->container->get('entity.form_builder')->getForm($this->fresh($target), 'restart');
  }

  /**
   * The question the dialog asks.
   *
   * @param array<string, mixed> $form
   *   The built form.
   */
  private function question(array $form): string {
    return (string) $form['question']['#slots']['body']['#plain_text'];
  }

  /**
   * The covered ticket ids as the form posts them back.
   */
  private function coveredValue(): string {
    return implode(',', array_keys(TicketInterventions::byTicket(TicketInterventions::restartCoveredRuns($this->machine))));
  }

  /**
   * Posts OK on a target's restart form with these tickets checked.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $target
   *   The machine, conductor or ticket.
   * @param string $covered
   *   The ticket ids the dialog showed.
   * @param list<\Drupal\bb_core\Entity\BbTicketInterface|null> $checked
   *   The checked tickets.
   */
  private function confirm(ContentEntityInterface $target, string $covered, array $checked): void {
    $form = $this->container->get('entity_type.manager')->getFormObject($target->getEntityTypeId(), 'restart');
    $form->setEntity($this->fresh($target));
    $ids = array_map(static fn (?BbTicketInterface $ticket): string => (string) $ticket?->id(), $checked);
    $state = (new FormState())->setRequestMethod('POST')->setValues([
      'bb_confirm' => 'OK',
      'bb_covered' => $covered,
      'tickets' => array_combine($ids, $ids),
    ]);
    $this->container->get('form_builder')->submitForm($form, $state);
  }

  /**
   * Lets the machine's owner edit tickets and end their runs.
   */
  private function grantTicketEditing(): void {
    $role = $this->container->get('entity_type.manager')->getStorage('user_role')->create(['id' => 'ticket_editor', 'label' => 'Ticket editor']);
    $role->save();
    user_role_grant_permissions('ticket_editor', ['administer bakers']);
    $this->owner->addRole('ticket_editor');
    $this->owner->save();
  }

  /**
   * The stored entity.
   */
  private function fresh(ContentEntityInterface $entity): ContentEntityInterface {
    $fresh = $this->container->get('entity_type.manager')->getStorage($entity->getEntityTypeId())->loadUnchanged($entity->id());
    assert($fresh instanceof ContentEntityInterface);
    return $fresh;
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
