<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
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
 * Finds users in the caller's read scope by part of full name or username.
 */
#[Tool(
  id: 'bakers_user_search',
  label: new TranslatableMarkup('Search users'),
  description: new TranslatableMarkup("Finds users you can see by part of their full name or username, any case; several matches return all, none an empty list. Use it to get a person's uuid before assigning, mentioning or adding reviewers."),
  operation: ToolOperation::Read,
  input_definitions: [
    'query' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Query'),
      description: new TranslatableMarkup('Part of the full name or username, e.g. a first name, a last name or "first last".'),
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
    'users' => new ListOutputDefinition(
      label: new TranslatableMarkup('Users'),
      description: new TranslatableMarkup('The matching users, by username.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('User'),
        description: new TranslatableMarkup('One user.'),
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
          'mail' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Mail'),
            description: new TranslatableMarkup('The e-mail address, null without mail view access.'),
            nullable: TRUE,
          ),
          'teams' => new ListOutputDefinition(
            label: new TranslatableMarkup('Teams'),
            description: new TranslatableMarkup('The teams of the user you can read, as bakers_user_read returns them.'),
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
final class UserSearch extends ToolBase {

  use TicketInputTrait;
  use PagedQueryTrait;
  use UserTeamsTrait;

  /**
   * Who and which teams the caller may read.
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
    $text = trim((string) $values['query']);
    $storage = $this->entities()->getStorage('user');
    // Scope and status sit in the query, so pages count visible users only.
    $query = $storage->getQuery()->accessCheck(FALSE)
      ->condition('status', 1)
      ->condition('uid', $this->readScope->peopleIds($this->currentUser), 'IN')
      ->sort('name')
      ->sort('uid');
    $query->condition($query->orConditionGroup()
      ->condition('field_full_name', $text, 'CONTAINS')
      ->condition('name', $text, 'CONTAINS'));
    [$ids, $next] = $this->page($query, $values);
    $users = [];
    foreach ($storage->loadMultiple($ids) as $user) {
      assert($user instanceof UserInterface);
      $users[] = [
        'uuid' => (string) $user->uuid(),
        'name' => $user->getAccountName(),
        'full_name' => $user->get('field_full_name')->value,
        'mail' => $user->get('mail')->access('view', $this->currentUser) ? $user->getEmail() : NULL,
        'teams' => $this->teams($user),
      ];
    }
    return ExecutableResult::success(new TranslatableMarkup('@count users found.', ['@count' => count($users)]), [
      'users' => $users,
      'next_offset' => $next,
    ]);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    $access = $account->isAuthenticated()
      ? AccessResult::allowed()
      : AccessResult::forbidden('Only a signed-in user can search users.');
    $access->cachePerUser();
    return $return_as_object ? $access : $access->isAllowed();
  }

}
