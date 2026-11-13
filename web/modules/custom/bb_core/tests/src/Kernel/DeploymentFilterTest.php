<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\search_api\Entity\Index;
use Drupal\Tests\bb_core\Kernel\Tool\BakersToolTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Deployment drill-down uses the index and follows changed release batches.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class DeploymentFilterTest extends BakersToolTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'filter', 'bb_core', 'tool',
    'search_api', 'search_api_db',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('search_api_task');
    $this->installSchema('search_api', ['search_api_item']);
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')->installOptionalConfig(NULL, ['module' => 'bb_core']);
  }

  /**
   * A release batch matches its project's work, excluding deployment tickets.
   */
  public function testListsCarriedProjectTickets(): void {
    $first = $this->ticket('FILTER-1');
    $second = $this->ticket('FILTER-2');
    $this->ticket('FILTER-UNRELATED');
    $foreign = $this->project->createDuplicate();
    $foreign->save();
    $other = $this->ticket('OTHER-1', ['project_id' => $foreign->id()]);
    $type = $this->term('type', 'deployment')->id();
    $nested = $this->ticket('FILTER-NESTED', ['ticket_type' => $type]);
    $deployment = $this->ticket('FILTER-D1', [
      'ticket_type' => $type,
      'referenced_tickets' => [$first->id(), $second->id(), $other->id(), $nested->id()],
    ]);
    $index = Index::load('bb_tickets');
    $index->indexItems();
    self::assertSame([$first->getIdentifier(), $second->getIdentifier()], $this->matchingIdentifiers($index, $deployment->getIdentifier()));
  }

  /**
   * Removing a carried ticket queues it for reindex and removes the match.
   */
  public function testRemovedTicketDropsOut(): void {
    $first = $this->ticket('FILTER-1');
    $second = $this->ticket('FILTER-2');
    $deployment = $this->ticket('FILTER-D1', [
      'ticket_type' => $this->term('type', 'deployment')->id(),
      'referenced_tickets' => [$first->id(), $second->id()],
    ]);
    $index = Index::load('bb_tickets');
    $index->indexItems();
    self::assertSame([$first->getIdentifier(), $second->getIdentifier()], $this->matchingIdentifiers($index, $deployment->getIdentifier()));
    $deployment->set('referenced_tickets', [$second->id()])->save();
    self::assertGreaterThanOrEqual(2, $index->getTrackerInstance()->getRemainingItemsCount());
    $index->indexItems();
    self::assertSame([$second->getIdentifier()], $this->matchingIdentifiers($index, $deployment->getIdentifier()));
    $deployment->delete();
    $index->indexItems();
    self::assertSame([], $this->matchingIdentifiers($index, $deployment->getIdentifier()));
  }

  /**
   * Knowing an unreadable deployment's identifier must not reveal its batch.
   */
  public function testUnreadableDeploymentCannotFilterVisibleWork(): void {
    $ticket = $this->ticket('FILTER-1');
    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')->create(['name' => 'hidden', 'slug' => 'hidden', 'owner_user_id' => 1]);
    $workspace->save();
    $group = $etm->getStorage('bb_group')->create(['name' => 'hidden', 'workspace_id' => $workspace->id()]);
    $group->save();
    $hidden = $this->project->createDuplicate();
    $hidden->set('group_id', $group->id())->set('teams', [])->save();
    $deployment = $this->ticket('HIDDEN-D1', [
      'project_id' => $hidden->id(),
      'ticket_type' => $this->term('type', 'deployment')->id(),
      'referenced_tickets' => [$ticket->id()],
    ]);
    self::assertSame([], $etm->getStorage('bb_ticket')->getQuery()->accessCheck(TRUE)->condition('id', $deployment->id())->execute());
    $index = Index::load('bb_tickets');
    $index->indexItems();
    self::assertSame([], $this->matchingIdentifiers($index, $deployment->getIdentifier()));
  }

  /**
   * Runs the same indexed constraints as the project drill-down.
   *
   * @return list<string>
   *   Matching ticket identifiers.
   */
  private function matchingIdentifiers(Index $index, string $identifier): array {
    $result = $index->query()->addCondition('deployment_identifiers', $identifier)
      ->addCondition('project_id', (int) $this->project->id())->execute();
    $identifiers = [];
    foreach ($result->getResultItems() as $item) {
      $identifiers[] = $item->getOriginalObject()->getValue()->getIdentifier();
    }
    sort($identifiers);
    return $identifiers;
  }

}
