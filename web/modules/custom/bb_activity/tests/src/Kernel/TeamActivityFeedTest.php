<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The Overview tab: the `full` view mode, on core's own canonical route.
 *
 * BB-484.
 *
 * BB-454 left the body EMPTY, rendered by a controller and marked in the DOM
 * so a scenario could tell "one empty body" from "no body at all". BB-484
 * fills it with the `bb_team.bb_team` `full` view mode — and once the body
 * IS the entity view, the controller that rendered it was only reimplementing
 * `_entity_view`, the default `DefaultHtmlRouteProvider` already puts on the
 * canonical route. So the controller method and the route override went away
 * together, and this class measures what replaced them.
 *
 * TWO THINGS ARE PINNED HERE, and the second is the one that would rot
 * silently. The first is the rollback itself: the canonical route carries
 * `_entity_view` and no `_controller`, so a future change cannot quietly
 * reintroduce a hand-rolled render path. The second is the TITLE, which is not
 * core's and must not become core's: `EntityController::title()` resolves its
 * subject by taking the FIRST entity parameter on the route
 * (`EntityController::doGetEntity()`), and this path carries two —
 * `/_workspace/{bb_workspace}/team/{bb_team}`, with `{bb_workspace}`
 * upcast to a real entity by `BbWorkspaceSlugConverter`. The workspace comes
 * first, so core's callback would title every team page with the WORKSPACE's
 * name. Nothing about that failure looks like a failure — the page renders,
 * with a plausible heading — which is why it is asserted rather than trusted.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class TeamActivityFeedTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og', 'island',
    'bb_core', 'bb_activity', 'views',
    'display_builder', 'display_builder_entity_view',
    'ui_patterns', 'ui_patterns_field', 'ui_patterns_field_formatters',
  ];

  /**
   * The team the Overview tab renders.
   */
  private BbTeamInterface $team;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $types = [
      'user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_project',
      'bb_group', 'bb_machine', 'bb_conductor', 'bb_ticket', 'bb_run',
      'bb_activity', 'bb_notification_setting',
    ];
    foreach ($types as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'display_builder']);
    $this->installTeamOverviewDisplay();
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);
    $this->container->get('router.builder')->rebuild();

    $storage = $this->container->get('entity_type.manager');
    $workspace = $storage->getStorage('bb_workspace')
      ->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);

    $team = $storage->getStorage('bb_team')
      ->create(['name' => 'Platform Crew', 'workspace_id' => $workspace->id()]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();
    $this->team = $team;

    $project = $storage->getStorage('bb_project')->create([
      'name' => 'bakers.build Platform',
      'workspace_id' => $workspace->id(),
      'teams' => [$team->id()],
    ]);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
  }

  /**
   * The detail page: activities beside the Identity and Projects cards.
   *
   * Projects is the computed inverse of `bb_project.teams`, so the fixture
   * project assigned to this team is listed by name.
   */
  public function testFullViewModeRendersTheFeedAndCards(): void {
    $html = $this->renderFull();

    self::assertStringContainsString('data-component-id="bb_theme:canvas"', $html);
    self::assertStringContainsString('Activities', $html);
    self::assertStringContainsString('Identity', $html);
    self::assertStringContainsString('Projects', $html);
    self::assertStringContainsString(
      'bakers.build Platform',
      $html,
      'The projects relation is bound: the fixture project name reaches the markup.',
    );
    self::assertStringNotContainsString('data-component-id="bb_theme:option_picker"', $html, 'No hardcoded picker remains.');
  }

  /**
   * Builds the `full` view mode the way the canonical route now does.
   *
   * @param \Drupal\bb_core\Entity\BbTeamInterface|null $team
   *   The team to render, defaulting to the fixture's.
   *
   * @return array<mixed>
   *   The entity build.
   */
  private function buildFull(?BbTeamInterface $team = NULL): array {
    $this->container->get('theme_installer')->install(['bb_theme']);
    return $this->container->get('entity_type.manager')
      ->getViewBuilder('bb_team')
      ->view($team ?? $this->team, 'full');
  }

  /**
   * Renders the `full` view mode to markup.
   */
  private function renderFull(?BbTeamInterface $team = NULL): string {
    $build = $this->buildFull($team);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Writes the two shipped config objects the `full` view mode needs.
   *
   * Mirrors `TicketDetailScreenTest::installTicketDetailDisplays()`: written
   * one config object at a time, from the files that actually ship on the
   * recipe path, rather than through `installConfig(['bb_core'])` — which
   * would also pull in `bb_core.settings` and the ten `og.og_role.*` this
   * test has no reason to create.
   */
  private function installTeamOverviewDisplay(): void {
    $module = $this->container->get('extension.list.module')->getPath('bb_core');
    $recipe = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $target = $this->container->get('config.storage');
    foreach ([
      'core.entity_view_mode.bb_team.full' => $module . '/config/optional',
      'core.entity_view_display.bb_team.bb_team.full' => $recipe,
    ] as $name => $directory) {
      $file = $directory . '/' . $name . '.yml';
      self::assertFileExists($file, sprintf('%s ships on the recipe path.', $name));
      $data = Yaml::decode((string) file_get_contents($file));
      $data['uuid'] = $this->container->get('uuid')->generate();
      $target->write($name, $data);
    }
  }

}
