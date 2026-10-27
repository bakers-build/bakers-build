<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\search_api\Entity\Index;
use Drupal\user\UserInterface;
use Drupal\views\Views;
use Symfony\Component\Yaml\Yaml;
use PHPUnit\Framework\Attributes\Group;

/**
 * My work answers for the workspace in the address, not for every workspace.
 *
 * BB-492. The `my_work` display sits at `_workspace/%bb_workspace/tickets`
 * and its two scoping filters are `assignee = me` and `state is non-terminal`.
 * Neither mentions a workspace, and the display declares no argument at all —
 * so the `%bb_workspace` segment of its own path reaches no handler. What
 * narrows the list instead is `BbReadScope`, which conditions on
 * `project_id IN (<every project the ACCOUNT can read>)`; that set is resolved
 * from the account alone and spans every workspace the account belongs to.
 *
 * The consequence is only observable with a reader who belongs to TWO
 * workspaces and has an open ticket assigned in each, which is why this case
 * builds that world rather than reusing the single-workspace fixture in
 * `TicketMyWorkDisplayTest`: with one workspace the address and the read scope
 * agree by accident and the screen looks correct.
 */
#[Group('bb_core')]
final class TicketMyWorkWorkspaceScopeTest extends KernelTestBase {

  use UserCreationTrait;
  use ProjectsViewTestTrait;
  use OgScopeFixtureTrait;

  /**
   * The slug of the workspace whose address every render here is made against.
   */
  private const ACTIVE_SLUG = 'alpha';

  /**
   * The title of the ticket that belongs to the active workspace.
   */
  private const TICKET_HERE = 'Ticket in the active workspace';

  /**
   * The title of the ticket that belongs to the other workspace.
   */
  private const TICKET_ELSEWHERE = 'Ticket in the other workspace';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'search_api', 'search_api_db',
    'better_exposed_filters', 'facets', 'facets_exposed_filters',
    'views_filters_summary',
    'ui_patterns', 'ui_patterns_views', 'display_builder',
    'display_builder_views', 'bb_core',
  ];

  /**
   * The reader who belongs to both workspaces.
   */
  private UserInterface $me;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_run', 'bb_term',
      'search_api_task',
    ] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installSchema('search_api', ['search_api_item']);
    $this->installConfig(['user', 'search_api', 'views']);
    $this->installOgScopeFixture();
    $this->enableTheShippedDisplayExtender();
    BbVocabulary::create(['id' => 'label', 'label' => 'bakers.build labels'])->save();
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('typed_data_manager')->clearCachedDefinitions();
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'display_builder']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->installShippedView('views.view.tickets');
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();

    $this->seedTwoWorkspaces();
  }

  /**
   * Rendered at workspace alpha, My work still lists beta's ticket.
   *
   * The positive half is asserted first and on purpose: without it a display
   * that rendered nothing at all would satisfy the negative half and read as a
   * fix.
   */
  public function testMyWorkIsScopedToTheWorkspaceInTheAddress(): void {
    $html = $this->screen();

    self::assertStringContainsString(
      self::TICKET_HERE,
      $html,
      'My work did not list the ticket of the workspace it was rendered for.',
    );
    self::assertStringNotContainsString(
      self::TICKET_ELSEWHERE,
      $html,
      'My work listed a ticket of a workspace other than the one in the address.',
    );
  }

  /**
   * The display declares an argument that consumes the workspace segment.
   *
   * The structural half of the same defect, stated separately so a failure
   * says WHERE the workspace is lost rather than only that it is. The project
   * and team displays each carry a `null` placeholder argument plus a real
   * one; `my_work` carries no `arguments` key at all.
   */
  public function testTheDisplayConsumesItsOwnWorkspaceSegment(): void {
    $view = $this->container->get('entity_type.manager')
      ->getStorage('view')->load('tickets');
    self::assertNotNull($view, 'The tickets view is not installed.');
    $arguments = $view->getDisplay('my_work')['display_options']['arguments'] ?? [];

    self::assertNotSame(
      [],
      $arguments,
      'The my_work display declares no argument, so the %bb_workspace segment of its own path reaches no handler.',
    );
  }

  /**
   * Rendered for each workspace in turn, each screen lists only its own.
   *
   * AC2: the change between two addresses is what a single render cannot
   * show, so both are rendered from the same fixture and each is asserted
   * against the other's ticket.
   */
  public function testMyWorkFollowsTheWorkspaceOnEverySwitch(): void {
    $alpha = $this->screen(self::ACTIVE_SLUG);
    self::assertStringContainsString(self::TICKET_HERE, $alpha,
      'The alpha screen did not list its own ticket.');
    self::assertStringNotContainsString(self::TICKET_ELSEWHERE, $alpha,
      'The alpha screen listed beta\'s ticket.');

    $beta = $this->screen('beta');
    self::assertStringContainsString(self::TICKET_ELSEWHERE, $beta,
      'The beta screen did not list its own ticket.');
    self::assertStringNotContainsString(self::TICKET_HERE, $beta,
      'The beta screen listed alpha\'s ticket.');
  }

  /**
   * A reader in exactly one workspace sees their list unaffected (AC6).
   */
  public function testMyWorkIsUnchangedForSingleWorkspaceReader(): void {
    $owner = $this->createUser([], 'solo-owner');
    self::assertInstanceOf(UserInterface::class, $owner);
    $this->setCurrentUser($owner);

    $solo = $this->createUser(['view bb_ticket'], 'solo');
    self::assertInstanceOf(UserInterface::class, $solo);

    $workspace = $this->create('bb_workspace', [
      'name' => 'Solo',
      'slug' => 'solo-workspace',
      'owner_user_id' => $owner->id(),
    ]);
    $group = $this->create('bb_group', [
      'name' => 'Solo group',
      'workspace_id' => $workspace->id(),
      'owner_user_id' => $owner->id(),
    ]);
    $team = $this->create('bb_team', [
      'name' => 'Solo team',
      'workspace_id' => $workspace->id(),
      'owner_user_id' => $owner->id(),
    ]);
    $project = $this->create('bb_project', [
      'name' => 'Solo project',
      'key' => 'sol',
      'group_id' => $group->id(),
      'teams' => [$team->id()],
      'owner_user_id' => $owner->id(),
    ]);
    $this->create('bb_ticket', [
      'title' => 'Ticket in the solo workspace',
      'state' => 'working',
      'workflow' => 'bb_work',
      'priority' => 2,
      'project_id' => $project->id(),
      'assignee_user_id' => $solo->id(),
      'owner_user_id' => $owner->id(),
    ]);
    $this->addMembership($workspace, $solo, ['member']);
    $this->addMembership($team, $solo, []);
    $this->setCurrentUser($solo);

    $index = Index::load('bb_tickets');
    self::assertNotNull($index);
    $index->indexItems();

    $html = $this->screen('solo-workspace');
    self::assertStringContainsString(
      'Ticket in the solo workspace',
      $html,
      'A reader in a single workspace no longer sees their own list.',
    );
  }

  /**
   * One display, rendered the way a request at the given workspace renders it.
   *
   * @param string $slug
   *   The workspace slug in the address.
   *
   * @return string
   *   The markup.
   */
  private function screen(string $slug = self::ACTIVE_SLUG): string {
    $view = Views::getView('tickets');
    self::assertNotNull($view, 'The tickets view is not installed.');
    $build = $view->buildRenderable('my_work', [$slug]);

    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Turns the display-builder extender on, from the object the repo ships.
   */
  private function enableTheShippedDisplayExtender(): void {
    $file = dirname(__DIR__, 7) . '/config/sync/views.settings.yml';
    self::assertFileExists($file, 'The repository ships views.settings.');
    $shipped = Yaml::parseFile($file);
    self::assertIsArray($shipped);
    $this->config('views.settings')
      ->set('display_extenders', $shipped['display_extenders'])
      ->save();
  }

  /**
   * Two workspaces, one open ticket assigned to the same reader in each.
   */
  private function seedTwoWorkspaces(): void {
    // Uid 1 bypasses every access check, so it must not be the actor.
    $this->createUser([], 'uid1-dummy');
    // A throwaway owner, because `og.settings.auto_add_group_owner_membership`
    // makes every owner a member on save: an actor that owned the groups would
    // hold memberships nobody wrote here.
    $owner = $this->createUser([], 'world-owner');
    self::assertInstanceOf(UserInterface::class, $owner);
    $this->setCurrentUser($owner);

    // Deliberately NOT `administer bakers`: that permission makes
    // `BbReadScope` bypass itself, which would hide behind the defect the
    // very mechanism this case is about. The reader is the reported user — an
    // ordinary member of two workspaces.
    $me = $this->createUser(['view bb_ticket'], 'me');
    self::assertInstanceOf(UserInterface::class, $me);
    $this->me = $me;

    foreach ([
      [self::ACTIVE_SLUG, 'Alpha', 'alp', self::TICKET_HERE],
      ['beta', 'Beta', 'bet', self::TICKET_ELSEWHERE],
    ] as [$slug, $name, $key, $title]) {
      $workspace = $this->create('bb_workspace', [
        'name' => $name,
        'slug' => $slug,
        'owner_user_id' => $owner->id(),
      ]);
      $group = $this->create('bb_group', [
        'name' => "$name group",
        'workspace_id' => $workspace->id(),
        'owner_user_id' => $owner->id(),
      ]);
      $team = $this->create('bb_team', [
        'name' => "$name team",
        'workspace_id' => $workspace->id(),
        'owner_user_id' => $owner->id(),
      ]);
      $project = $this->create('bb_project', [
        'name' => "$name project",
        'key' => $key,
        'group_id' => $group->id(),
        'teams' => [$team->id()],
        'owner_user_id' => $owner->id(),
      ]);
      $this->create('bb_ticket', [
        'title' => $title,
        'state' => 'working',
        'workflow' => 'bb_work',
        'priority' => 2,
        'project_id' => $project->id(),
        'assignee_user_id' => $this->me->id(),
        'owner_user_id' => $owner->id(),
      ]);
      // The reported situation: membership in BOTH workspaces. BB-462 D4/D7
      // routes project visibility through team membership, so both are written.
      $this->addMembership($workspace, $this->me, ['member']);
      $this->addMembership($team, $this->me, []);
    }

    $this->setCurrentUser($this->me);

    $index = Index::load('bb_tickets');
    self::assertNotNull($index);
    self::assertSame(
      2,
      $index->indexItems(),
      'Both tickets must be indexed, or an empty list proves nothing.',
    );
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
