<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\views\field;

use Drupal\Core\Url;
use Drupal\user\UserInterface;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;

/**
 * The row's one link: the account name to its profile, the account's page.
 *
 * Its profile carries Manage API keys and Disable. A disabled account has no
 * reachable profile, so its name stays plain text.
 */
#[ViewsField('bb_service_account_name')]
final class ServiceAccountName extends FieldPluginBase {

  /**
   * {@inheritdoc}
   */
  public function query(): void {
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>|string
   *   The name, linked to the profile where the viewer may open it.
   */
  public function render(ResultRow $values) {
    $user = $this->getEntity($values);
    if (!$user instanceof UserInterface) {
      return '';
    }
    $profile = Url::fromRoute('bb_core.user.profile', ['user' => $user->id()]);
    $access = $profile->access(NULL, TRUE);
    $build = $user->isActive() && $access->isAllowed()
      ? ['#type' => 'link', '#title' => $user->getAccountName(), '#url' => $profile]
      : ['#plain_text' => $user->getAccountName()];
    $build['#cache'] = ['max-age' => 0];
    return $build;
  }

}
