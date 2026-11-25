<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Profile\Profiles;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Reads the caller, or a user in its read scope, with teams and machines.
 */
#[Tool(
  id: 'bakers_user_read',
  label: new TranslatableMarkup('Read a user'),
  description: new TranslatableMarkup('Reads you, or a user you can see by e-mail or username: profile, teams with role, machines and conductors with who may assign them.'),
  operation: ToolOperation::Read,
  input_definitions: [
    'user' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('User'),
      description: new TranslatableMarkup('E-mail address (any case) or username; default you.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
    'uuid' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('UUID'),
      description: new TranslatableMarkup('The user UUID.'),
    ),
    'name' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Name'),
      description: new TranslatableMarkup('The display name.'),
    ),
    'mail' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Mail'),
      description: new TranslatableMarkup('The e-mail address, null without mail view access.'),
      nullable: TRUE,
    ),
    'profiles' => new ListOutputDefinition(
      label: new TranslatableMarkup('Profiles'),
      description: new TranslatableMarkup("The user's profile per workspace you can read it in; use the one of the ticket's workspace."),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Profile'),
        description: new TranslatableMarkup('One workspace profile.'),
        property_definitions: [
          'workspace' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Workspace'),
            description: new TranslatableMarkup('The workspace UUID.'),
          ),
          'position' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Position'),
            description: new TranslatableMarkup('The position, or an empty string.'),
          ),
          'background' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Background'),
            description: new TranslatableMarkup('What bakers.build should know about the background, or an empty string.'),
          ),
        ],
      ),
    ),
    'teams' => new ListOutputDefinition(
      label: new TranslatableMarkup('Teams'),
      description: new TranslatableMarkup('The teams of the user you can read.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Team'),
        description: new TranslatableMarkup('One team.'),
        property_definitions: [
          'uuid' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The team UUID.'),
          ),
          'label' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Label'),
            description: new TranslatableMarkup('The team name.'),
          ),
          'workspace' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Workspace'),
            description: new TranslatableMarkup('The workspace UUID.'),
            nullable: TRUE,
          ),
          'role' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Role'),
            description: new TranslatableMarkup("The user's rank in that workspace: lead (Admin), contributor or guest; null without one."),
            nullable: TRUE,
          ),
        ],
      ),
    ),
    'machines' => new ListOutputDefinition(
      label: new TranslatableMarkup('Machines'),
      description: new TranslatableMarkup("Your own machines; for another user, those carrying a conductor you can view."),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Machine'),
        description: new TranslatableMarkup('One machine with the user’s conductors on it.'),
        property_definitions: [
          'uuid' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The machine UUID.'),
          ),
          'machine_id' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Machine ID'),
            description: new TranslatableMarkup('The machine_id (host key).'),
          ),
          'name' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Name'),
            description: new TranslatableMarkup('The machine name.'),
            nullable: TRUE,
          ),
          'max_parallel' => new OutputDefinition(
            data_type: 'integer',
            label: new TranslatableMarkup('Max parallel'),
            description: new TranslatableMarkup('Runs the machine takes at once.'),
          ),
          'current_load' => new OutputDefinition(
            data_type: 'integer',
            label: new TranslatableMarkup('Current load'),
            description: new TranslatableMarkup('Runs the machine holds now.'),
          ),
          'assignment' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Assignment'),
            description: new TranslatableMarkup('allow or forbid: whether others may assign its conductors, unless a conductor overrides it.'),
          ),
          'conductors' => new ListOutputDefinition(
            label: new TranslatableMarkup('Conductors'),
            description: new TranslatableMarkup("The user's conductors on this machine you can view."),
            item_definition: new MapOutputDefinition(
              label: new TranslatableMarkup('Conductor'),
              description: new TranslatableMarkup('One conductor.'),
              property_definitions: [
                'uuid' => new OutputDefinition(
                  data_type: 'string',
                  label: new TranslatableMarkup('UUID'),
                  description: new TranslatableMarkup('The conductor UUID, as bakers_ticket_update takes it.'),
                ),
                'conductor_id' => new OutputDefinition(
                  data_type: 'string',
                  label: new TranslatableMarkup('Conductor ID'),
                  description: new TranslatableMarkup('The process registration key.'),
                ),
                'label' => new OutputDefinition(
                  data_type: 'string',
                  label: new TranslatableMarkup('Label'),
                  description: new TranslatableMarkup('The conductor label.'),
                  nullable: TRUE,
                ),
                'project' => new OutputDefinition(
                  data_type: 'string',
                  label: new TranslatableMarkup('Project'),
                  description: new TranslatableMarkup('The project UUID.'),
                  nullable: TRUE,
                ),
                'status' => new OutputDefinition(
                  data_type: 'string',
                  label: new TranslatableMarkup('Status'),
                  description: new TranslatableMarkup('online or offline.'),
                ),
                'assignment_setting' => new OutputDefinition(
                  data_type: 'string',
                  label: new TranslatableMarkup('Assignment setting'),
                  description: new TranslatableMarkup("The conductor's own setting: machine, allow or forbid."),
                ),
                'assignment' => new OutputDefinition(
                  data_type: 'string',
                  label: new TranslatableMarkup('Assignment'),
                  description: new TranslatableMarkup('allow or forbid in force: whether others may assign this conductor; the owner always may.'),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  ],
)]
final class UserRead extends ToolBase {

  use TicketInputTrait;
  use UserTeamsTrait;

  /**
   * The one refusal for unknown, blocked and invisible users alike.
   */
  private const REFUSAL = 'No such user is visible to you.';

  /**
   * Who and which teams the caller may read.
   */
  protected BbWorkspaceReadScopeInterface $readScope;

  /**
   * Finds the user's workspace profiles.
   */
  protected Profiles $profileStore;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->readScope = $container->get('bb_core.workspace_read_scope');
    $instance->profileStore = $container->get(Profiles::class);
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $user = $this->visibleUser(trim((string) ($values['user'] ?? '')));
    $profile = [
      'uuid' => (string) $user->uuid(),
      'name' => (string) $user->getDisplayName(),
      'mail' => $user->get('mail')->access('view', $this->currentUser) ? $user->getEmail() : NULL,
    ];
    $profile['profiles'] = $this->profiles($user);
    $self = (int) $user->id() === (int) $this->currentUser->id();
    $profile['teams'] = $this->teams($user);
    $profile['machines'] = $this->machines($user, $self);
    return ExecutableResult::success(new TranslatableMarkup('Read user @name.', ['@name' => $profile['name']]), $profile);
  }

  /**
   * The user's profiles the caller may view, by workspace id.
   *
   * @return list<array{workspace: string, position: string, background: string}>
   *   One row per readable profile.
   */
  private function profiles(UserInterface $user): array {
    $rows = [];
    foreach ($this->profileStore->ofAccount((int) $user->id()) as $profile) {
      $workspace = $profile->get('workspace_id')->entity;
      if ($workspace === NULL || !$profile->access('view', $this->currentUser)) {
        continue;
      }
      $rows[] = [
        'workspace' => (string) $workspace->uuid(),
        'position' => trim($profile->position()),
        'background' => trim($profile->background()),
      ];
    }
    return $rows;
  }

  /**
   * The caller, or the active user in its read scope by mail or username.
   *
   * @throws \InvalidArgumentException
   */
  private function visibleUser(string $name): UserInterface {
    $storage = $this->entities()->getStorage('user');
    if ($name === '') {
      $user = $storage->load($this->currentUser->id());
      assert($user instanceof UserInterface);
      return $user;
    }
    $query = $storage->getQuery()->accessCheck(FALSE)->condition('status', 1);
    // Mail case-insensitive, like core's unique-mail check; escaped LIKE.
    $query->condition($query->orConditionGroup()
      ->condition('mail', addcslashes($name, '\\%_'), 'LIKE')
      ->condition('name', $name));
    $visible = array_intersect(
      array_map('intval', $query->execute()),
      $this->readScope->peopleIds($this->currentUser),
    );
    $user = $visible ? $storage->load(reset($visible)) : NULL;
    if (!$user instanceof UserInterface) {
      throw new \InvalidArgumentException(self::REFUSAL);
    }
    return $user;
  }

  /**
   * The user's machines with the user's conductors the caller can view.
   *
   * @return array<array<string, mixed>>
   *   Machine rows, by name.
   */
  private function machines(UserInterface $user, bool $self): array {
    $conductor_storage = $this->entities()->getStorage('bb_conductor');
    $conductor_ids = $conductor_storage->getQuery()->accessCheck(TRUE)
      ->condition('owner_user_id', $user->id())
      ->sort('label')
      ->sort('id')
      ->execute();
    $by_machine = [];
    foreach ($conductor_storage->loadMultiple($conductor_ids) as $conductor) {
      assert($conductor instanceof BbConductorInterface);
      // shortcut: a conductor without a machine is left out, the output nests
      // conductors under machines; add a top-level list if that case matters.
      if ($conductor->get('machine')->isEmpty() || !$conductor->access('view', $this->currentUser)) {
        continue;
      }
      $effective = $conductor->getEffectiveAssignment();
      $by_machine[(int) $conductor->get('machine')->target_id][] = [
        'uuid' => (string) $conductor->uuid(),
        'conductor_id' => $conductor->getConductorId(),
        'label' => $conductor->get('label')->value,
        'project' => $conductor->get('project_id')->entity?->uuid(),
        'status' => (string) $conductor->get('status')->value,
        'assignment_setting' => $conductor->getAssignment(),
        'assignment' => $effective['value'],
      ];
    }
    $machine_storage = $this->entities()->getStorage('bb_machine');
    $machine_ids = array_keys($by_machine);
    if ($self) {
      $machine_ids = array_merge($machine_ids, $machine_storage->getQuery()->accessCheck(TRUE)
        ->condition('owner_user_id', $user->id())
        ->execute());
    }
    $machines = [];
    foreach ($machine_storage->loadMultiple(array_unique($machine_ids)) as $id => $machine) {
      assert($machine instanceof BbMachineInterface);
      $machines[] = [
        'uuid' => (string) $machine->uuid(),
        'machine_id' => $machine->getHostKey(),
        'name' => $machine->get('name')->value,
        'max_parallel' => $machine->getMaxParallel(),
        'current_load' => $machine->getCurrentLoad(),
        'assignment' => $machine->getAssignment(),
        'conductors' => $by_machine[(int) $id] ?? [],
      ];
    }
    usort($machines, static fn (array $a, array $b): int => [(string) $a['name'], $a['machine_id']]
      <=> [(string) $b['name'], $b['machine_id']]);
    return $machines;
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    $access = $account->isAuthenticated()
      ? AccessResult::allowed()
      : AccessResult::forbidden('Only a signed-in user can read users.');
    $access->cachePerUser();
    return $return_as_object ? $access : $access->isAllowed();
  }

}
