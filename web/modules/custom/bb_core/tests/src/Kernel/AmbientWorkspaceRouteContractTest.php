<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A workspace-less create has no reachable URL (V9, criterion 4).
 *
 * This is the criterion the whole feature leans on and the only one nothing
 * else asserts. BB-351 owns no routes: it does not fail closed on a
 * workspace-less add form, it does not raise "you are in several workspaces",
 * and its form trait has no fallback branch — all three are unnecessary BECAUSE
 * every workspace-bound add URL carries `{bb_workspace}`. Take that segment
 * away and the feature does not fail loudly; it quietly resolves nothing and
 * offers an unbounded picker.
 *
 * So the contract is locked structurally, on the entity type definitions rather
 * than on a hardcoded list of paths: the link template is what generates the
 * route, so a type that regrew a workspace-less add form is caught here whoever
 * declared it and whatever they called the segment.
 *
 * The route TABLE is not read here on purpose — a route can be altered after
 * the link template produced it, and this asserts the source. That the built
 * routes really carry the parameter is covered by every test that stands on
 * one, and by AmbientWorkspaceAddFormTest end to end.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class AmbientWorkspaceRouteContractTest extends KernelTestBase {

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
   * The workspace-bound entity types whose creates are ambient.
   *
   * @return array<string, array{string}>
   *   The entity type ids, keyed for a readable case name.
   */
  public static function workspaceBoundEntityTypes(): array {
    return [
      'group' => ['bb_group'],
      'team' => ['bb_team'],
      'project' => ['bb_project'],
      'ticket' => ['bb_ticket'],
    ];
  }

  /**
   * Every workspace-bound type's add form is addressed within a workspace.
   *
   * @param string $entity_type_id
   *   The workspace-bound entity type under test.
   */
  #[DataProvider('workspaceBoundEntityTypes')]
  public function testAddFormLinkTemplateCarriesTheWorkspace(string $entity_type_id): void {
    $definition = $this->container->get('entity_type.manager')
      ->getDefinition($entity_type_id);
    $template = $definition->getLinkTemplate('add-form');

    self::assertIsString(
      $template,
      "$entity_type_id declares an add-form link template.",
    );
    self::assertStringContainsString(
      '{bb_workspace}',
      $template,
      "$entity_type_id's add form is addressed within a workspace, so a "
      . 'create without one has no reachable URL.',
    );
  }

}
