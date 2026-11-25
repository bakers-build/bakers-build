<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\search_api\Entity\Index;
use Drupal\user\Entity\User;
use PHPUnit\Framework\Attributes\Group;

/**
 * The indexed attention and conductor owner follow every change at once.
 *
 * No cron and no queue: the index is read right after the request that made
 * the change ends, as the next API request would read it.
 */
#[Group('bb_core')]
final class TicketAttentionIndexFreshnessTest extends ClaimKernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'file', 'image',
    'link', 'text', 'filter', 'search_api', 'search_api_db', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('search_api_task');
    $this->installSchema('search_api', ['search_api_item']);
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    Index::load('bb_tickets')?->indexItems();
  }

  /**
   * A plan comment makes the plan ready; deleting it takes that back.
   */
  public function testPlanCommentInsertAndDelete(): void {
    $ticket = $this->seedAssignedTicket('plan');
    $this->settle();
    self::assertFalse($this->indexed($ticket, 'attention', 'plan_ready'));

    $comment = $this->container->get('entity_type.manager')->getStorage('bb_comment')->create([
      'ticket_id' => $ticket->id(),
      'author' => $this->conductor->get('owner_user_id')->target_id,
      'body' => ['value' => 'plan', 'format' => 'bb_rich'],
      'type' => 'plan',
    ]);
    $comment->save();
    $this->settle();
    self::assertTrue($this->indexed($ticket, 'attention', 'plan_ready'));

    $comment->delete();
    $this->settle();
    self::assertFalse($this->indexed($ticket, 'attention', 'plan_ready'));
  }

  /**
   * A claimed run holds the plan; its failed or expired end releases it.
   */
  public function testRunClaimAndEnd(): void {
    foreach (['failed', 'expired'] as $end) {
      $ticket = $this->seedAssignedTicket('plan');
      $this->container->get('entity_type.manager')->getStorage('bb_comment')->create([
        'ticket_id' => $ticket->id(),
        'author' => $this->conductor->get('owner_user_id')->target_id,
        'body' => ['value' => 'plan', 'format' => 'bb_rich'],
        'type' => 'plan',
      ])->save();
      $run = $this->seedRun($ticket, 'plan', 'claimed');
      $this->settle();
      self::assertFalse($this->indexed($ticket, 'attention', 'plan_ready'), $end);

      $run = $this->reloadRun($run);
      $run->set('state', $end)->save();
      $this->settle();
      self::assertTrue($this->indexed($ticket, 'attention', 'plan_ready'), $end);
    }
  }

  /**
   * A transition to review needs the review.
   */
  public function testTransitionToReview(): void {
    $ticket = $this->seedAssignedTicket('working');
    $this->settle();
    self::assertFalse($this->indexed($ticket, 'attention', 'review'));

    $ticket->getState()->applyTransitionById('to_review');
    $ticket->save();
    $this->settle();
    self::assertTrue($this->indexed($ticket, 'attention', 'review'));
  }

  /**
   * Freezing with Question asks; unfreezing takes the question back.
   */
  public function testFreezeWithQuestionAndUnfreeze(): void {
    $ticket = $this->seedAssignedTicket('working');
    $project = $ticket->get('project_id')->entity;
    assert($project instanceof BbProjectInterface);
    $term = $this->container->get('entity_type.manager')->getStorage('bb_term')->create([
      'vid' => 'label',
      'name' => 'Question',
      'workspace_id' => $project->getGroup()?->getWorkspace()?->id(),
    ]);
    $term->save();
    $ticket->get('labels')->appendItem($term->id());
    $ticket->setFrozen(TRUE)->save();
    $this->settle();
    self::assertTrue($this->indexed($ticket, 'attention', 'question'));
    self::assertTrue($this->indexed($ticket, 'frozen', TRUE));

    $ticket = $this->reloadTicket($ticket);
    $ticket->setFrozen(FALSE)->save();
    $this->settle();
    self::assertFalse($this->indexed($ticket, 'attention', 'question'));
  }

  /**
   * A new conductor, or a new owner of the same one, moves the owner.
   */
  public function testConductorAndOwnerChange(): void {
    $ticket = $this->seedAssignedTicket('working');
    $first = (int) $this->conductor->get('owner_user_id')->target_id;
    $this->settle();
    self::assertTrue($this->indexed($ticket, 'conductor_owner_user_id', $first));

    $second = User::create(['name' => 'second-owner', 'status' => 1]);
    $second->save();
    $other = $this->createConductor($second, 'node-other');
    $ticket = $this->reloadTicket($ticket);
    $ticket->set('conductor_id', $other->id())->save();
    $this->settle();
    self::assertTrue($this->indexed($ticket, 'conductor_owner_user_id', (int) $second->id()));

    $other->set('owner_user_id', $first)->save();
    $this->settle();
    self::assertTrue($this->indexed($ticket, 'conductor_owner_user_id', $first));
  }

  /**
   * The deploy hook fills the attention field added to an indexed site.
   */
  public function testDeployHookIndexesAttentionWithoutCron(): void {
    $ticket = $this->seedAssignedTicket('review');
    $this->settle();
    // The site before the field: every ticket indexed without it.
    $index = Index::load('bb_tickets');
    $field = $index->getField('attention');
    self::assertNotNull($field);
    $index->removeField('attention');
    $index->save();
    $index->indexItems();
    // The config import adds it back; the stored items still lack it.
    $index = Index::load('bb_tickets');
    $index->addField($field);
    $index->save();
    self::assertFalse($this->indexed($ticket, 'attention', 'review'), 'Before the hook the index lacks the value.');

    $this->container->get('module_handler')->loadInclude('bb_core', 'php', 'bb_core.deploy');
    $sandbox = [];
    $passes = 0;
    do {
      bb_core_deploy_index_ticket_attention($sandbox);
    } while (($sandbox['#finished'] ?? 1) < 1 && ++$passes < 20);
    self::assertEquals(1, $sandbox['#finished'] ?? 1);
    self::assertTrue($this->indexed($ticket, 'attention', 'review'));
  }

  /**
   * Ends the request: what was marked for indexing is indexed now.
   */
  private function settle(): void {
    $this->container->get('search_api.post_request_indexing')->destruct();
  }

  /**
   * Whether the index holds the value for the ticket's field.
   */
  private function indexed(BbTicketInterface $ticket, string $field, mixed $value): bool {
    $switcher = $this->container->get('account_switcher');
    // UID 1 bypasses the read scope; this test is about freshness only.
    $switcher->switchTo(User::load(1));
    try {
      $query = Index::load('bb_tickets')->query();
      $query->addCondition('ticket_id', $ticket->id());
      $query->addCondition($field, $value);
      return (int) $query->execute()->getResultCount() === 1;
    }
    finally {
      $switcher->switchBack();
    }
  }

}
