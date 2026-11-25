<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * A ticket's attention says why it needs a person, or nothing.
 *
 * Rule order: closed gives nothing, then frozen with label Question, then a
 * plan ready to read (state plan, a plan comment, no claimed or running run),
 * then review.
 */
#[Group('bb_core')]
final class TicketAttentionTest extends ClaimKernelTestBase {

  /**
   * A ticket in review needs its review.
   */
  public function testReviewNeedsReview(): void {
    self::assertSame('review', $this->attention($this->seedAssignedTicket('review')));
  }

  /**
   * A ticket in plan with a plan comment and no run has a plan to read.
   */
  public function testPlanWithPlanCommentIsPlanReady(): void {
    $ticket = $this->seedAssignedTicket('plan');
    $this->comment($ticket, 'plan');
    self::assertSame('plan_ready', $this->attention($ticket));
  }

  /**
   * A ticket in plan without a plan comment needs nobody yet.
   */
  public function testPlanWithoutPlanCommentNeedsNobody(): void {
    $ticket = $this->seedAssignedTicket('plan');
    $this->comment($ticket, 'spec');
    self::assertSame('', $this->attention($ticket));
  }

  /**
   * An open run is still working on the plan.
   */
  #[DataProvider('openRunStates')]
  public function testOpenRunHoldsThePlan(string $runState): void {
    $ticket = $this->seedAssignedTicket('plan');
    $this->comment($ticket, 'plan');
    $this->seedRun($ticket, 'plan', $runState);
    self::assertSame('', $this->attention($ticket));
  }

  /**
   * Run states that hold a plan back.
   *
   * @return array<string, array{string}>
   *   One run state per case.
   */
  public static function openRunStates(): array {
    return ['claimed' => ['claimed'], 'running' => ['running']];
  }

  /**
   * A run that ended without finishing leaves the plan ready.
   */
  #[DataProvider('endedRunStates')]
  public function testEndedRunLeavesThePlanReady(string $runState): void {
    $ticket = $this->seedAssignedTicket('plan');
    $this->comment($ticket, 'plan');
    $this->seedRun($ticket, 'plan', $runState);
    self::assertSame('plan_ready', $this->attention($ticket));
  }

  /**
   * Run states that no longer hold a plan back.
   *
   * @return array<string, array{string}>
   *   One run state per case.
   */
  public static function endedRunStates(): array {
    return ['failed' => ['failed'], 'expired' => ['expired']];
  }

  /**
   * A frozen ticket with the Question label, in any letter case, asks.
   */
  public function testFrozenWithQuestionAsks(): void {
    $ticket = $this->seedAssignedTicket('working');
    $this->label($ticket, 'question');
    $ticket->setFrozen(TRUE)->save();
    self::assertSame('question', $this->attention($ticket));
  }

  /**
   * The Question label alone, without a freeze, asks nothing.
   */
  public function testQuestionWithoutFreezeAsksNothing(): void {
    $ticket = $this->seedAssignedTicket('working');
    $this->label($ticket, 'Question');
    self::assertSame('', $this->attention($ticket));
  }

  /**
   * A question wins over review.
   */
  public function testQuestionWinsOverReview(): void {
    $ticket = $this->seedAssignedTicket('review');
    $this->label($ticket, 'Question');
    $ticket->setFrozen(TRUE)->save();
    self::assertSame('question', $this->attention($ticket));
  }

  /**
   * A question wins over a ready plan.
   */
  public function testQuestionWinsOverPlanReady(): void {
    $ticket = $this->seedAssignedTicket('plan');
    $this->comment($ticket, 'plan');
    $this->label($ticket, 'Question');
    $ticket->setFrozen(TRUE)->save();
    self::assertSame('question', $this->attention($ticket));
  }

  /**
   * A frozen review without the Question label still needs its review.
   */
  public function testFrozenReviewWithoutQuestionNeedsReview(): void {
    $ticket = $this->seedAssignedTicket('review');
    $ticket->setFrozen(TRUE)->save();
    self::assertSame('review', $this->attention($ticket));
  }

  /**
   * A closed ticket needs nobody, whatever else holds.
   */
  public function testClosedNeedsNobody(): void {
    $ticket = $this->seedAssignedTicket('review');
    $this->label($ticket, 'Question');
    $ticket->setFrozen(TRUE)->set('closed', TRUE)->save();
    self::assertSame('', $this->attention($ticket));
  }

  /**
   * A working ticket needs nobody.
   */
  public function testWorkingNeedsNobody(): void {
    self::assertSame('', $this->attention($this->seedAssignedTicket('working')));
  }

  /**
   * The ticket's attention, freshly loaded.
   */
  private function attention(BbTicketInterface $ticket): string {
    return (string) $this->reloadTicket($ticket)->get('attention')->value;
  }

  /**
   * Adds a comment of the given type to the ticket.
   */
  private function comment(BbTicketInterface $ticket, string $type): void {
    $this->container->get('entity_type.manager')->getStorage('bb_comment')->create([
      'ticket_id' => $ticket->id(),
      'author' => $this->conductor->get('owner_user_id')->target_id,
      'body' => ['value' => $type, 'format' => 'bb_rich'],
      'type' => $type,
    ])->save();
  }

  /**
   * Adds a label of the given name to the ticket.
   */
  private function label(BbTicketInterface $ticket, string $name): void {
    $workspace = $ticket->get('project_id')->entity->getGroup()?->getWorkspace();
    $term = $this->container->get('entity_type.manager')->getStorage('bb_term')->create([
      'vid' => 'label',
      'name' => $name,
      'workspace_id' => $workspace?->id(),
    ]);
    $term->save();
    $ticket->get('labels')->appendItem($term->id());
    $ticket->save();
  }

}
