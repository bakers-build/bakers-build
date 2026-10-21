<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\search_api\Entity\Index;
use PHPUnit\Framework\Attributes\Group;

/**
 * The ticket index carries every field the list and its facets read.
 */
#[Group('bb_core')]
final class TicketIndexTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    // `og` is not optional here even though nothing below reads a membership:
    // bb_core's `bb_core.workspace_read_scope` service takes
    // `og.membership_manager` as a constructor argument, so the container does
    // not compile without it. The plan's module list omitted it; T4's, which
    // names the same service directly, did not.
    // `link` carries the field type bb_ticket's `links` base field uses;
    // installing the ticket schema without it dies on an unknown plugin.
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'search_api', 'search_api_db', 'file', 'image', 'bb_core',
  ];

  /**
   * Every field id the view and the seven facets address.
   */
  private const REQUIRED_FIELDS = [
    'identifier', 'title', 'state', 'workflow', 'priority',
    'assignee_user_id', 'conductor_id', 'project_id', 'group_id',
    'labels', 'changed', 'project_team_ids',
    'closed', 'closed_date', 'ticket_id', 'priority_rank',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // Saving a server runs search_api's ServerTaskManager, which queries the
    // search_api_task entity. Without its schema the config install dies with
    // a missing-table SQL error before the index is ever written.
    $this->installEntitySchema('search_api_task');
    // Saving the index makes its tracker enumerate the datasource, so the
    // indexed entity's own table has to exist too.
    $this->installEntitySchema('bb_ticket');
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
  }

  /**
   * The index exists, reads bb_ticket and carries every addressed field.
   */
  public function testIndexCarriesEveryFieldTheSurfaceReads(): void {
    $index = Index::load('bb_tickets');
    self::assertNotNull($index, 'The bb_tickets index is missing.');

    self::assertArrayHasKey(
      'entity:bb_ticket',
      $index->getDatasources(),
      'The index does not read bb_ticket.',
    );

    $actual = array_keys($index->getFields());
    foreach (self::REQUIRED_FIELDS as $field) {
      self::assertContains($field, $actual, sprintf(
        'Index field "%s" is missing; the surface addresses it by that name.',
        $field,
      ));
    }
  }

  /**
   * The group facet reaches bb_group through the project, not the ticket.
   */
  public function testGroupIsRelatedEntityField(): void {
    $index = Index::load('bb_tickets');
    self::assertSame(
      'project_id:entity:group_id',
      $index->getField('group_id')?->getPropertyPath(),
      'group_id must traverse the project; bb_ticket has no group of its own.',
    );
  }

  /**
   * The team index field follows project assignment, not ticket.team.
   */
  public function testProjectTeamIdsTraverseTheProjectTeamsRelation(): void {
    $index = Index::load('bb_tickets');
    self::assertNotNull($index, 'The bb_tickets index is missing.');
    $field = $index->getField('project_team_ids');
    self::assertSame(
      'project_id:entity:teams',
      $field->getPropertyPath(),
      'project_team_ids must be derived from bb_project.teams.',
    );
    self::assertSame(
      'integer',
      $field->getType(),
      'project_team_ids must be an indexed multi-valued numeric relation.',
    );
  }

}
