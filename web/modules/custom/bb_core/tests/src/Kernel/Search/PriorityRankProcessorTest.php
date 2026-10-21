<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Search;

use Drupal\KernelTests\KernelTestBase;
use Drupal\search_api\Entity\Index;
use Drupal\search_api\Utility\Utility;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the indexed priority rank: High first, an unset priority last.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class PriorityRankProcessorTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'search_api', 'search_api_db', 'file', 'image', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('search_api_task');
    $this->installSchema('search_api', ['search_api_item']);
    $this->installReadScopeEnvironment();
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->buildTwoWorkspaceWorld();
  }

  /**
   * The shipped index carries the generic rank and no board-only field.
   */
  public function testShippedIndexCarriesThePriorityRank(): void {
    $index = Index::load('bb_tickets');
    self::assertTrue($index->isValidProcessor('bb_ticket_priority_rank'));
    self::assertFalse($index->isValidProcessor('bb_ticket_board_column'));
    self::assertNull($index->getField('board_column'));
    self::assertNull($index->getField('board_priority'));
  }

  /**
   * The sort rank puts High first and an unset priority after every set one.
   */
  public function testPriorityRankOrdersUnsetLast(): void {
    $index = Index::load('bb_tickets');
    self::assertSame('integer', $index->getField('priority_rank')->getType());
    $ticket = $this->fixture('a', 'bb_ticket');
    $ranks = [];
    foreach ([1, 2, 3, NULL] as $priority) {
      $ticket->set('priority', $priority)->save();
      $item = $this->container->get('search_api.fields_helper')->createItemFromObject(
        $index,
        $ticket->getTypedData(),
        Utility::createCombinedId('entity:bb_ticket', $ticket->id() . ':en'),
      );
      $ranks[] = array_values($item->getField('priority_rank')->getValues());
    }
    self::assertSame([[1], [2], [3], [4]], $ranks);
  }

}
