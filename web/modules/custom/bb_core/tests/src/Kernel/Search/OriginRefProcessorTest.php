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
 * Covers the indexed origin reference.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class OriginRefProcessorTest extends KernelTestBase {

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
   * The shipped index keeps the processor; preSave() strips an unsupported one.
   */
  public function testShippedIndexCarriesTheProcessor(): void {
    $index = Index::load('bb_tickets');
    self::assertTrue($index->isValidProcessor('bb_origin_ref'));
    self::assertSame('origin_ref', $index->getField('origin_ref')?->getPropertyPath());
  }

  /**
   * An issue origin is indexed as its normalised reference.
   */
  public function testIssueOriginIsIndexed(): void {
    self::assertSame(
      ['bakers-build/bakers-build#19'],
      $this->indexValuesFor('https://git.key-tec.de/Bakers-Build/Bakers-Build/issues/19/'),
    );
  }

  /**
   * A job URL is a real origin with no issue number and indexes nothing.
   */
  public function testNonIssueOriginIndexesNothing(): void {
    self::assertSame([], $this->indexValuesFor('https://git.key-tec.de/leando/bibb-community/-/jobs/195759'));
  }

  /**
   * An empty origin indexes nothing.
   */
  public function testEmptyOriginIndexesNothing(): void {
    self::assertSame([], $this->indexValuesFor(''));
  }

  /**
   * Indexes the fixture ticket with the given origin.
   *
   * @return string[]
   *   The values the processor added to the `origin_ref` field.
   */
  private function indexValuesFor(string $origin): array {
    $ticket = $this->fixture('a', 'bb_ticket');
    $ticket->set('origin', $origin)->save();
    $index = Index::load('bb_tickets');
    // getFields() extracts the item, which runs every add_properties
    // processor exactly as indexing does.
    $item = $this->container->get('search_api.fields_helper')->createItemFromObject(
      $index,
      $ticket->getTypedData(),
      Utility::createCombinedId('entity:bb_ticket', $ticket->id() . ':en'),
    );
    return array_values($item->getField('origin_ref')->getValues());
  }

}
