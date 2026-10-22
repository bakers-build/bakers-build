<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\search_api\Entity\Index;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Yaml\Yaml;

/**
 * Every field the Runs listing renders must actually be indexed.
 *
 * `search_api.index.bb_runs` indexed two fields before BB-482 —
 * `project_id` and `project_team_ids`, both derived paths serving the
 * contextual arguments. Eight more are added for the Runs tabs' columns and
 * facets. A Search API property path that does not resolve raises NO error:
 * the column simply renders empty. This is the only place that failure is
 * visible at all.
 */
#[Group('bb_core')]
final class RunIndexFieldsTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'search_api', 'search_api_db', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_run', 'bb_term', 'search_api_task',
    ] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installSchema('search_api', ['search_api_item']);
    $this->installConfig(['user', 'search_api']);
    BbVocabulary::create(['id' => 'bb_labels', 'label' => 'bakers.build labels'])->save();
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('typed_data_manager')->clearCachedDefinitions();
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->installShippedIndex('search_api.index.bb_runs');

    $account = $this->createUser(['administer bakers']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);
  }

  /**
   * Installs the bb_runs Search API index from its recipe copy.
   *
   * `search_api.index.bb_runs` ships from `recipes/bakers/config/**` and
   * `config/sync/**`, never from `bb_core/config/optional`, so the optional
   * sweep above does not create it.
   *
   * @param string $name
   *   The config object name, e.g. `search_api.index.bb_runs`.
   */
  private function installShippedIndex(string $name): void {
    $path = dirname(__DIR__, 7) . '/recipes/bakers/config/' . $name . '.yml';
    self::assertFileExists($path, "$name is not shipped in recipes/bakers/config.");
    $data = Yaml::parseFile($path);
    self::assertIsArray($data, "$name did not parse as a YAML mapping.");

    $storage = $this->container->get('entity_type.manager')->getStorage('search_api_index');
    if ($storage->load($data['id']) === NULL) {
      $storage->create($data)->save();
    }
  }

  /**
   * Every listing field is indexed and populated for a seeded run.
   */
  public function testEveryListingFieldIsIndexedAndPopulated(): void {
    $run = $this->seedRun();
    $index = Index::load('bb_runs');
    self::assertNotNull($index);
    $indexed = $index->indexItems();
    self::assertSame(1, $indexed, 'The seeded run must be in the index, or an empty answer proves nothing.');

    // `search_api.index.bb_runs.yml` sorts `field_settings` keys
    // alphabetically, the same way the config exporter writes it, and
    // Index::getFields() reads them back in that stored order.
    $expected = [
      'agent', 'changed', 'closed', 'conductor_id', 'duration_s', 'identifier',
      'project_id', 'project_team_ids', 'started_at', 'state', 'state_at_start',
      'ticket_title',
    ];
    self::assertSame($expected, array_keys($index->getFields()), 'sorted as exported');

    $query = $index->query();
    $query->addCondition('search_api_id', 'entity:bb_run/' . $run->id() . ':und');
    $results = $query->execute()->getResultItems();
    self::assertCount(1, $results);
    $item = reset($results);

    $populated = [
      'identifier', 'state', 'state_at_start', 'conductor_id', 'agent',
      'started_at', 'duration_s', 'ticket_title',
    ];
    foreach ($populated as $field) {
      $values = $item->getField($field)?->getValues() ?? [];
      self::assertNotSame([], $values, sprintf('Field %s indexed a value', $field));
    }
    self::assertSame(['BB-1'], $item->getField('identifier')->getValues());
    self::assertSame(['running'], $item->getField('state')->getValues());
  }

  /**
   * A project, a ticket, a conductor and one run, fully populated.
   */
  private function seedRun(): ContentEntityInterface {
    $workspace = $this->create('bb_workspace', [
      'name' => 'bakers.build',
      'slug' => 'bakers',
    ]);
    $group = $this->create('bb_group', [
      'name' => 'Platform',
      'workspace_id' => $workspace->id(),
    ]);
    $project = $this->create('bb_project', [
      'name' => 'bakers.build',
      'key' => 'BB',
      'group_id' => $group->id(),
    ]);
    $ticket = $this->create('bb_ticket', [
      'title' => 'First ticket',
      'state' => 'coding',
      'workflow' => 'bb_feature',
      'project_id' => $project->id(),
    ]);
    $conductor = $this->create('bb_conductor', [
      'name' => 'cw-framework',
    ]);
    $run = $this->create('bb_run', [
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
      'state_at_start' => 'coding',
      'agent' => 'opus',
      'started_at' => 1700000000,
      'duration_s' => 142,
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 3600,
    ]);
    return $run;
  }

  /**
   * Creates and saves an entity of the given type.
   *
   * @param string $entity_type_id
   *   The entity type id.
   * @param array<string, mixed> $values
   *   The field values.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved entity.
   */
  private function create(string $entity_type_id, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($entity_type_id)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

}
