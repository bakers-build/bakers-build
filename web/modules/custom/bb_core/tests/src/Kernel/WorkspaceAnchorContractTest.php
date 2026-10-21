<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityTypeInterface;
use Drupal\bb_core\Entity\BbTicketTemplate;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Every bakers.build content entity is workspace-anchored (workspace or project path).
 *
 * Multi-workspace isolation requires a deterministic path from each row to a
 * workspace. Anchors are either:
 * - the workspace itself (bb_workspace.id);
 * - required workspace_id;
 * - required project_id (project → group → workspace);
 * - required group_id on projects (group → workspace);
 * - required ticket_id (ticket → project → …).
 *
 * `bb_machine` is account-owned (`owner` token): it has no workspace edge.
 * `bb_term` was the last workspace exception — global master data with
 * no workspace edge — until BB-339 gave it a required `workspace_id`. Every
 * other bb_* content entity type is workspace-anchored. The coverage case
 * below still names every type, including the account-owned machine.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceAnchorContractTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'bb_core',
  ];

  /**
   * Entity type id → required anchor field (or special token).
   *
   * @var array<string, string>
   */
  private const ANCHORS = [
    'bb_workspace' => 'self',
    'bb_group' => 'workspace_id',
    'bb_team' => 'workspace_id',
    // BB-430: an invitation is held BY a workspace and by nothing else, so
    // its anchor is the direct edge — the same one `bb_team` and
    // `bb_group` carry.
    'bb_invite' => 'workspace_id',
    // Host capacity object; owned by the account, not a workspace.
    'bb_machine' => 'owner',
    // Shared vocabulary, one copy per workspace (BB-339).
    'bb_term' => 'workspace_id',
    'bb_project' => 'group_id',
    'bb_ticket' => 'project_id',
    // Exactly one of project_id / workspace_id; neither is required alone.
    'bb_ticket_template' => 'scope',
    'bb_environment' => 'project_id',
    'bb_conductor' => 'project_id',
    'bb_run' => 'ticket_id',
    'bb_comment' => 'ticket_id',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    foreach (array_keys(self::ANCHORS) as $entity_type_id) {
      if ($entity_type_id === 'bb_workspace' || $entity_type_id === 'self') {
        continue;
      }
      $this->installEntitySchema($entity_type_id);
    }
    $this->installEntitySchema('bb_workspace');
  }

  /**
   * Every mapped type exists and carries the required anchor field.
   */
  public function testContentTypesDeclareRequiredWorkspaceAnchors(): void {
    $definitions = $this->container->get('entity_type.manager')->getDefinitions();
    $field_manager = $this->container->get('entity_field.manager');

    foreach (self::ANCHORS as $entity_type_id => $anchor) {
      self::assertArrayHasKey($entity_type_id, $definitions, "$entity_type_id is defined.");
      $entity_type = $definitions[$entity_type_id];
      self::assertInstanceOf(ContentEntityTypeInterface::class, $entity_type);

      if ($anchor === 'self' || $anchor === 'owner') {
        continue;
      }
      if ($anchor === 'scope') {
        self::assertSame(
          [BbTicketTemplate::class, 'validateScope'],
          $entity_type->getConstraints()['Callback']['callback'] ?? NULL,
          "$entity_type_id must enforce exactly one of project_id and workspace_id.",
        );
        continue;
      }

      $fields = $field_manager->getBaseFieldDefinitions($entity_type_id);
      self::assertArrayHasKey($anchor, $fields, "$entity_type_id has $anchor.");
      self::assertTrue(
        $fields[$anchor]->isRequired(),
        "$entity_type_id.$anchor must be required for workspace isolation.",
      );
    }
  }

  /**
   * The contract list covers every bb_* content type in the module.
   */
  public function testContractCoversEveryBbContentEntityType(): void {
    $found = [];
    foreach ($this->container->get('entity_type.manager')->getDefinitions() as $id => $definition) {
      if (!str_starts_with($id, 'bb_')) {
        continue;
      }
      if (!$definition instanceof ContentEntityTypeInterface) {
        continue;
      }
      // Config-backed or non-table types under the bb_ prefix are ignored.
      if ($definition->getBaseTable() === NULL) {
        continue;
      }
      $found[] = $id;
    }
    sort($found);
    $expected = array_keys(self::ANCHORS);
    sort($expected);
    self::assertSame(
      $expected,
      $found,
      'Every bb_* content type must name its anchor in ANCHORS explicitly; '
      . 'there is no global tier to fall back on since BB-339.',
    );
  }

}
