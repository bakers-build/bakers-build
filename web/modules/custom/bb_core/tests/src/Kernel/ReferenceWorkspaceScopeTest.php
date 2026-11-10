<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormState;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Hook\FormAlterHooks;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Every reference choice stays inside the workspace it is edited in.
 *
 * The actor leads BOTH workspaces: the read scope alone already hides a
 * workspace the actor is not in, so only such an actor shows that the field's
 * own handler narrows. Each field is checked twice: what its picker offers,
 * and that the server refuses a submitted entry of the other workspace.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ReferenceWorkspaceScopeTest extends KernelTestBase {

  use AmbientWorkspaceTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'bb_core',
  ];

  /**
   * Per side, the referenced candidates the world fixture does not carry.
   *
   * @var array<string, array<string, \Drupal\Core\Entity\ContentEntityInterface>>
   */
  private array $extra = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installAmbientWorkspaceWorld();
    foreach (['a', 'b'] as $side) {
      $workspace = $this->fixture($side, 'bb_workspace');
      $this->addMembership($workspace, $this->member($side), ['member']);
      foreach (['type', 'recipe'] as $vid) {
        $this->extra[$side][$vid] = $this->createEntity('bb_term', [
          'vid' => $vid,
          'name' => "$vid-$side",
          'workspace_id' => $workspace->id(),
        ]);
      }
      $this->extra[$side]['ticket'] = $this->createEntity('bb_ticket', [
        'title' => "other-$side",
        'workflow' => 'bb_work',
        'project_id' => $this->fixture($side, 'bb_project')->id(),
      ]);
    }
    $actor = $this->createAccount('lead-of-both', ['access user profiles']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $actor, ['lead']);
    $this->addMembership($this->fixture('b', 'bb_workspace'), $actor, ['lead']);
    $this->container->get('account_switcher')->switchTo($actor);
  }

  /**
   * The reference fields under test: host type, field, candidate key.
   *
   * Parent and Blocked by are offered through the picker handler every ticket
   * form uses; their field keeps the default handler (see FormAlterHooks).
   *
   * @return array<string, array{string, string, string}>
   *   One row per field.
   */
  public static function fields(): array {
    return [
      'project group' => ['bb_project', 'group_id', 'bb_group'],
      'project teams' => ['bb_project', 'teams', 'bb_team'],
      'project owner' => ['bb_project', 'owner_user_id', 'member'],
      'ticket labels' => ['bb_ticket', 'labels', 'bb_term'],
      'ticket type' => ['bb_ticket', 'ticket_type', 'type'],
      'ticket recipe' => ['bb_ticket', 'recipe', 'recipe'],
      'ticket parent' => ['bb_ticket', 'parent_id', 'ticket'],
      'ticket blocked by' => ['bb_ticket', 'blocked_by', 'ticket'],
      'ticket owner' => ['bb_ticket', 'owner_user_id', 'member'],
      'template owner' => ['bb_ticket_template', 'owner_user_id', 'member'],
    ];
  }

  /**
   * Editing workspace B's entity offers B's entry and none of A's.
   */
  #[DataProvider('fields')]
  public function testEditOffersOnlyTheEntitysWorkspace(string $type, string $field, string $candidate): void {
    $offered = array_keys($this->offered($this->fixture('b', $type), $field));

    self::assertContains((int) $this->candidate('b', $candidate)->id(), $offered);
    self::assertNotContains((int) $this->candidate('a', $candidate)->id(), $offered);
  }

  /**
   * Creating in workspace B through its create dialog offers none of A's.
   */
  #[DataProvider('fields')]
  public function testCreateOffersOnlyTheActiveWorkspace(string $type, string $field, string $candidate): void {
    $host = $this->enterCreate($type);

    self::assertNotContains((int) $this->candidate('a', $candidate)->id(), array_keys($this->offered($host, $field)));
  }

  /**
   * The server refuses an entry of workspace A on B's entity.
   */
  #[DataProvider('fields')]
  public function testEditRejectsAnEntryOfAnotherWorkspace(string $type, string $field, string $candidate): void {
    $host = $this->fixture('b', $type);
    $host->set($field, $this->candidate('a', $candidate)->id());

    self::assertContains($field, $this->violatingFields($host));
  }

  /**
   * The server refuses an entry of workspace A when creating in B.
   */
  #[DataProvider('fields')]
  public function testCreateRejectsAnEntryOfAnotherWorkspace(string $type, string $field, string $candidate): void {
    $host = $this->enterCreate($type);
    if ($type === 'bb_ticket') {
      // A ticket is submitted with its project; relations are judged by it.
      $host->set('project_id', $this->fixture('b', 'bb_project')->id());
    }
    $host->set($field, $this->candidate('a', $candidate)->id());

    self::assertContains($field, $this->violatingFields($host));
  }

  /**
   * Stands on workspace B's create route for the type; returns a new entity.
   */
  private function enterCreate(string $type): ContentEntityInterface {
    $workspace = $this->fixture('b', 'bb_workspace');
    $values = match ($type) {
      'bb_project' => ['name' => 'new'],
      'bb_ticket' => ['title' => 'new', 'workflow' => 'bb_work'],
      default => [
        'name' => 'new',
        'title_pattern' => 'new',
        'workflow' => 'bb_work',
        'target_state' => 'qualification',
        'project_id' => $this->fixture('b', 'bb_project')->id(),
      ],
    };
    if ($type === 'bb_ticket_template') {
      $this->enterRealRoute('entity.bb_ticket_template.add_form', [
        'bb_workspace' => $workspace,
        'bb_project' => $this->fixture('b', 'bb_project'),
      ]);
    }
    else {
      $this->enterRealRoute("entity.$type.create_form", ['bb_workspace' => $workspace]);
    }
    $host = $this->container->get('entity_type.manager')->getStorage($type)->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $host);
    return $host;
  }

  /**
   * The candidate of one side for a candidate key.
   */
  private function candidate(string $side, string $key): ContentEntityInterface|UserInterface {
    return match ($key) {
      'member' => $this->member($side),
      'type', 'recipe', 'ticket' => $this->extra[$side][$key],
      default => $this->fixture($side, $key),
    };
  }

  /**
   * What the field's own handler offers on the host, keyed by id.
   *
   * @return array<int|string, string>
   *   The offered labels.
   */
  private function offered(ContentEntityInterface $host, string $field): array {
    $handler = in_array($field, ['parent_id', 'blocked_by'], TRUE) ? 'bb_ticket_in_ticket_project' : NULL;
    return $this->container->get('bb_core.reference_options')->for($host, $field, handler: $handler);
  }

  /**
   * The Settings form's relation autocomplete uses the picker handler.
   */
  public function testTicketRelationAutocompleteKeepsToTheProject(): void {
    $hooks = $this->container->get('class_resolver')->getInstanceFromDefinition(FormAlterHooks::class);
    foreach (['parent_id', 'blocked_by'] as $field) {
      $element = ['target_id' => ['#selection_handler' => 'default:bb_ticket']];
      $hooks->fieldWidgetSingleElementFormAlter($element, new FormState(), ['items' => $this->fixture('b', 'bb_ticket')->get($field)]);
      self::assertSame('bb_ticket_in_ticket_project', $element['target_id']['#selection_handler']);
    }
  }

  /**
   * The field names reporting a violation when the host is validated.
   *
   * @return array<string>
   *   The field names.
   */
  private function violatingFields(ContentEntityInterface $host): array {
    $fields = [];
    foreach ($host->validate() as $violation) {
      $fields[] = explode('.', $violation->getPropertyPath())[0];
    }
    return array_values(array_unique($fields));
  }

}
