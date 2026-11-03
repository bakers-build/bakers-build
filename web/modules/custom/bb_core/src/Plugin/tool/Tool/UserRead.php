<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\OutputDefinition;
use Drupal\user\UserInterface;

/**
 * Reads the calling user's own profile; it takes no input, so no other user.
 */
#[Tool(
  id: 'bakers_user_read',
  label: new TranslatableMarkup('Read your user'),
  description: new TranslatableMarkup('Reads your own user: name, position and background, which say whom you work for.'),
  operation: ToolOperation::Read,
  output_definitions: [
    'uuid' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('UUID'),
      description: new TranslatableMarkup('Your user UUID.'),
    ),
    'name' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Name'),
      description: new TranslatableMarkup('Your display name.'),
    ),
    'position' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Position'),
      description: new TranslatableMarkup('Your position, or an empty string.'),
    ),
    'background' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Background'),
      description: new TranslatableMarkup('What bakers.build should know about your background, or an empty string.'),
    ),
  ],
)]
final class UserRead extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $user = $this->entities()->getStorage('user')->load($this->currentUser->id());
    assert($user instanceof UserInterface);
    $profile = ['uuid' => (string) $user->uuid(), 'name' => (string) $user->getDisplayName()];
    // The fields live in config/sync; a site without them reads empty.
    foreach (['position' => 'field_developer_title', 'background' => 'field_bb_background'] as $key => $field) {
      $profile[$key] = $user->hasField($field) ? trim((string) $user->get($field)->value) : '';
    }
    return ExecutableResult::success(new TranslatableMarkup('Read your user.'), $profile);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    $access = $account->isAuthenticated()
      ? AccessResult::allowed()
      : AccessResult::forbidden('Only a signed-in user has a profile to read.');
    $access->cachePerUser();
    return $return_as_object ? $access : $access->isAllowed();
  }

}
