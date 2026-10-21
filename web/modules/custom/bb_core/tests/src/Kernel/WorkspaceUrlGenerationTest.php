<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Product URLs are workspace-prefixed and built by toUrl() alone (V4, D7).
 *
 * Asserted on toUrl() rather than on any helper, because the criterion is
 * precisely that NO call site builds a product URL as a string: every one of
 * them — the detail SDC, the board card, the local tasks, the computed
 * edit_url — goes through toUrl(), so making toUrl() correct is what makes all
 * of them correct at once. A helper that produced the right string would leave
 * every existing call site emitting the old path.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceUrlGenerationTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * The workspace every fixture below hangs off.
   */
  private ContentEntityInterface $workspace;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_environment', 'bb_run',
      'bb_comment',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->container->get('router.builder')->rebuild();
    $this->workspace = $this->create('bb_workspace', ['name' => 'bakers.build', 'slug' => 'bakers']);
  }

  /**
   * A ticket is addressed by its lowercased identifier under its workspace.
   */
  public function testTicketUrlUsesSlugAndIdentifier(): void {
    $ticket = $this->makeTicket();

    self::assertSame('/bakers/ticket/bb-350', $ticket->toUrl()->toString());
    self::assertSame('/bakers/ticket/bb-350', $ticket->toUrl('canonical')->toString());
  }

  /**
   * The edit and delete forms inherit the same shape.
   *
   * The dashboard's computed `edit_url` is literally
   * `$ticket->toUrl('edit-form')->toString()` (EditUrlItemList), so pinning
   * the rel here pins the computed field with it;
   * BbTicketEditUrlWorkspaceTest in bb_dashboard asserts the field itself
   * end to end.
   */
  public function testTicketFormUrlsUseSlugAndIdentifier(): void {
    $ticket = $this->makeTicket();

    self::assertSame('/bakers/ticket/bb-350/edit', $ticket->toUrl('edit-form')->toString());
    self::assertSame('/bakers/ticket/bb-350/delete', $ticket->toUrl('delete-form')->toString());
  }

  /**
   * A project is addressed by its lowercased key under its workspace.
   */
  public function testProjectUrlUsesSlugAndKey(): void {
    $project = $this->makeProject();

    self::assertSame('/bakers/project/bakers', $project->toUrl()->toString());
    self::assertSame('/bakers/project/bakers/edit', $project->toUrl('edit-form')->toString());
  }

  /**
   * A run's canonical and overlay URLs nest under the ticket identifier.
   */
  public function testRunUrlIsTicketRelative(): void {
    $ticket = $this->makeTicket();
    $run = $this->create('bb_run', ['ticket_id' => $ticket->id()]);

    self::assertSame(
      '/bakers/ticket/bb-350/run/' . $run->id(),
      $run->toUrl()->toString(),
    );
    self::assertSame(
      '/bakers/ticket/bb-350/run/' . $run->id() . '/overlay',
      $run->toUrl('overlay')->toString(),
    );
    self::assertSame(
      '/bakers/run/' . $run->id() . '/edit',
      $run->toUrl('edit-form')->toString(),
    );
  }

  /**
   * Every moved type emits the workspace prefix, not only the two with a ref.
   */
  public function testEveryMovedTypeIsWorkspacePrefixed(): void {
    $ticket = $this->makeTicket();
    $project = $ticket->get('project_id')->entity;
    self::assertInstanceOf(ContentEntityInterface::class, $project);
    $group = $project->get('group_id')->entity;
    self::assertInstanceOf(ContentEntityInterface::class, $group);

    $entities = [
      'bb_group' => $group,
      'bb_team' => $this->create('bb_team', [
        'name' => 'Crew',
        'workspace_id' => $this->workspace->id(),
      ]),
      'bb_environment' => $this->create('bb_environment', [
        'name' => 'staging',
        'project_id' => $project->id(),
      ]),
      'bb_run' => $this->create('bb_run', ['ticket_id' => $ticket->id()]),
      'bb_comment' => $this->create('bb_comment', [
        'ticket_id' => $ticket->id(),
        'body' => 'hi',
      ]),
    ];

    foreach ($entities as $type => $entity) {
      self::assertStringStartsWith(
        '/bakers/',
        $entity->toUrl()->toString(),
        sprintf('%s must emit a workspace-prefixed canonical URL.', $type),
      );
    }
  }

  /**
   * A row that belongs to no workspace still emits a URL — one that 404s.
   *
   * This REPLACES an earlier decision that such a row should raise
   * MissingMandatoryParametersException, and it was reversed on a measurement,
   * not a preference. A project can legitimately exist without a group (the
   * form does not require one), and its tickets and runs then resolve to no
   * workspace. Those rows appear in `/admin/bakers/tickets` and
   * `/admin/bakers/runs` — the two listings D2 deliberately keeps outside every
   * workspace, so there is no ambient workspace to borrow either. One such row
   * threw mid-render and took the ENTIRE listing down with an HTTP 500:
   * measured on the seeded e2e world, where two fixtures create exactly that
   * shape.
   *
   * The fallback is BbWorkspace::DEFAULT_SLUG — the slug bb_core_install()
   * pins on every instance — and it is a rendering decision only, never an
   * access one. BbWorkspaceAccessCheck still resolves
   * the row's own workspace, still gets NULL, and still answers 404, which the
   * sibling assertion in WorkspaceRouteAccessTest pins. So the link is
   * well-formed, the page renders, and following the link fails closed.
   *
   * Note what this is NOT: leaving the slot empty. Url::toString() would then
   * append `?bb_workspace=` as a query string, which is a broken link with
   * no diagnosis attached. This emits a real address that answers honestly.
   */
  public function testEntityWithoutWorkspaceFallsBackToTheDefaultWorkspace(): void {
    $orphan = $this->create('bb_ticket', ['title' => 'No project']);

    // A projectless ticket still carries the BbTicket::defaultIdentifier()
    // fallback, so the human-reference segment is that, lowercased (D5).
    $reference = mb_strtolower((string) $orphan->get('identifier')->value);
    self::assertNotSame('', $reference);

    self::assertSame(
      '/bakers/ticket/' . $reference,
      $orphan->toUrl()->toString(),
      'An orphan row addresses the default workspace, which then rejects it.',
    );
  }

  /**
   * The collection route keeps its /admin/bakers path and gains no parameter.
   *
   * D2 leaves the plural admin listings behind. urlRouteParameters() adds the
   * slug per link template, so a template with no workspace segment must come
   * out untouched — an unconditional addition would append
   * `?bb_workspace=bakers` to every collection link.
   */
  public function testCollectionUrlIsUnchanged(): void {
    $ticket = $this->makeTicket();

    self::assertSame('/admin/bakers/tickets', $ticket->toUrl('collection')->toString());
  }

  /**
   * The types that stay behind emit no workspace prefix at all.
   */
  public function testUnmovedTypesKeepTheAdminPath(): void {
    self::assertSame(
      '/admin/bakers/workspace/' . $this->workspace->id(),
      $this->workspace->toUrl()->toString(),
    );
  }

  /**
   * Creates the BB-350 ticket, project and group behind the workspace.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved ticket.
   */
  private function makeTicket(): ContentEntityInterface {
    $project = $this->makeProject();
    // `number` is set, so allocateNumber() leaves the identifier alone and the
    // fixture pins the exact value the expected URL is written against.
    return $this->create('bb_ticket', [
      'title' => 'Workspace-scoped product URLs',
      'project_id' => $project->id(),
      'number' => 350,
      'identifier' => 'BB-350',
    ]);
  }

  /**
   * Creates the group and the bakers.build project below the workspace.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved project.
   */
  private function makeProject(): ContentEntityInterface {
    $group = $this->create('bb_group', [
      'name' => 'bakers.build group',
      'workspace_id' => $this->workspace->id(),
    ]);
    return $this->create('bb_project', [
      'name' => 'bakers.build',
      'key' => 'bakers.build',
      'group_id' => $group->id(),
    ]);
  }

  /**
   * Creates and saves an entity of the given type.
   *
   * @param string $entity_type_id
   *   The entity type to create.
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
