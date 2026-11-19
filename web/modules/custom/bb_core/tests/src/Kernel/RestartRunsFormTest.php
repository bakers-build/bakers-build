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
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * The Restart runs confirmation on a machine or conductor, and who gets it.
 *
 * Opening writes nothing; the confirm cancels exactly the listed runs, and a
 * confirm whose list went stale re-renders instead. Only the machine's owner
 * reaches the dialog; anyone else gets the owner-mismatch 404.
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
      self::assertStringContainsString($ticket->getIdentifier(), implode("\n", array_map('strval', $form['runs']['#items'])));
      self::assertSame(['bb_confirm' => 'Restart runs'], $this->buttonLabels($form));
    }
    self::assertSame('running', $this->reloadRun($run)->getRunState());
  }

  /**
   * Keep runs is the dialog's close target: the page it was opened over.
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
   * Confirming cancels the listed runs; a stale list writes nothing.
   */
  public function testConfirmCancelsAndStaleConfirmRerenders(): void {
    $first = $this->seedRun($this->seedAssignedTicket('working'), 'working', 'running');
    $covered = $this->coveredValue();
    $second = $this->seedRun($this->seedAssignedTicket('plan'), 'plan', 'claimed');

    $this->confirm($this->machine, $covered);
    self::assertSame('running', $this->reloadRun($first)->getRunState());
    self::assertSame('claimed', $this->reloadRun($second)->getRunState());
    self::assertNotEmpty($this->container->get('messenger')->messagesByType('error'));

    $this->confirm($this->machine, $this->coveredValue());
    foreach ([$first, $second] as $run) {
      self::assertSame('cancelled', $this->reloadRun($run)->getRunState());
      self::assertStringContainsString('Restart runs (machine workstation) by claim-base-owner', (string) $this->reloadRun($run)->getErrorLog());
    }
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
    $this->confirm($this->conductor, (string) $run->id());
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
   * The covered run ids as the form posts them back.
   */
  private function coveredValue(): string {
    $runs = TicketInterventions::restartCoveredRuns($this->machine);
    return implode(',', array_map(static fn (BbRunInterface $run): string => (string) $run->id(), $runs));
  }

  /**
   * Posts the confirm button of a target's restart form.
   */
  private function confirm(ContentEntityInterface $target, string $covered): void {
    $form = $this->container->get('entity_type.manager')->getFormObject($target->getEntityTypeId(), 'restart');
    $form->setEntity($this->fresh($target));
    $state = (new FormState())->setRequestMethod('POST')->setValues([
      'bb_confirm' => 'Restart runs',
      'bb_covered' => $covered,
    ]);
    $this->container->get('form_builder')->submitForm($form, $state);
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
