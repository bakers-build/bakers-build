<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\og\OgMembershipInterface;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Lists the active members of one team whose roster the caller may read.
 */
#[Tool(
  id: 'bakers_team_members',
  label: new TranslatableMarkup('List team members'),
  description: new TranslatableMarkup('Lists the members of a team you can see with their team roles, by username. Use it to pick an assignee or reviewer from a team.'),
  operation: ToolOperation::Read,
  permission: 'view bb_team',
  input_definitions: [
    'team' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Team'),
      description: new TranslatableMarkup('Team UUID, from bakers_team_list or bakers_user_read.'),
      constraints: ['NotBlank' => []],
    ),
    'limit' => new InputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Limit'),
      description: new TranslatableMarkup('Rows per page, 1-100; default 50.'),
      required: FALSE,
    ),
    'offset' => new InputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Offset'),
      description: new TranslatableMarkup('Rows to skip; default 0.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
    'members' => new ListOutputDefinition(
      label: new TranslatableMarkup('Members'),
      description: new TranslatableMarkup('The active members, by username.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Member'),
        description: new TranslatableMarkup('One member.'),
        property_definitions: [
          'uuid' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The user UUID.'),
          ),
          'name' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Name'),
            description: new TranslatableMarkup('The username, as bakers_user_read takes it.'),
          ),
          'full_name' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Full name'),
            description: new TranslatableMarkup('The full name, or null without one.'),
            nullable: TRUE,
          ),
          'roles' => new ListOutputDefinition(
            label: new TranslatableMarkup('Roles'),
            description: new TranslatableMarkup('The team roles, sorted: member, lead, owner, reporter.'),
            item_definition: new OutputDefinition(
              data_type: 'string',
              label: new TranslatableMarkup('Role'),
              description: new TranslatableMarkup('One team role.'),
            ),
          ),
        ],
      ),
    ),
    'next_offset' => new OutputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Next offset'),
      description: new TranslatableMarkup('The offset of the next page, or null on the last page.'),
      nullable: TRUE,
    ),
  ],
)]
final class TeamMembers extends ToolBase {

  use TicketInputTrait;
  use PagedQueryTrait;

  /**
   * The team OG role prefix in front of a role name.
   */
  private const ROLE_PREFIX = 'bb_team-bb_team-';

  /**
   * Which teams' rosters the caller may read.
   */
  protected BbWorkspaceReadScopeInterface $readScope;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->readScope = $container->get('bb_core.workspace_read_scope');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $team = $this->readableTeam((string) $values['team']);
    $storage = $this->entities()->getStorage('og_membership');
    // Account status sits in the query, so pages count listed members only.
    $query = $storage->getQuery()->accessCheck(FALSE)
      ->condition('entity_type', 'bb_team')
      ->condition('entity_id', $team->id())
      ->condition('state', OgMembershipInterface::STATE_ACTIVE)
      ->condition('uid.entity.status', 1)
      ->sort('uid.entity.name')
      ->sort('id');
    [$ids, $next] = $this->page($query, $values);
    $members = [];
    foreach ($storage->loadMultiple($ids) as $membership) {
      assert($membership instanceof OgMembershipInterface);
      $user = $membership->getOwner();
      $roles = array_map(static fn ($role): string => substr((string) $role->id(), strlen(self::ROLE_PREFIX)), $membership->getRoles());
      sort($roles);
      $members[] = [
        'uuid' => (string) $user->uuid(),
        'name' => $user->getAccountName(),
        'full_name' => $user->get('field_full_name')->value,
        'roles' => $roles,
      ];
    }
    return ExecutableResult::success(new TranslatableMarkup('@count members found.', ['@count' => count($members)]), [
      'members' => $members,
      'next_offset' => $next,
    ]);
  }

  /**
   * The viewable team whose roster the caller may read, else one refusal.
   *
   * @throws \InvalidArgumentException
   */
  private function readableTeam(string $uuid): EntityInterface {
    $storage = $this->entities()->getStorage('bb_team');
    $ids = $storage->getQuery()->accessCheck(TRUE)->condition('uuid', $uuid)->range(0, 1)->execute();
    $team = $ids ? $storage->load(reset($ids)) : NULL;
    $rosters = $this->readScope->membershipGroupIds($this->currentUser)['bb_team'] ?? [];
    if ($team === NULL || !$team->access('view', $this->currentUser) || !in_array((int) $team->id(), $rosters, TRUE)) {
      throw new \InvalidArgumentException(sprintf('Team %s does not exist or is not readable.', $uuid));
    }
    return $team;
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // The access-checked query, entity access and roster scope decide.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
