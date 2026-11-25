<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\views\field;

use Drupal\user\UserInterface;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;

/**
 * One row's account status badge: Active or Disabled.
 *
 * Status is read from the user here because core only shows another
 * account's `status` field to holders of `administer users`, which a
 * workspace administrator lacks; this view is already limited to them.
 */
#[ViewsField('bb_service_account_status')]
final class ServiceAccountStatus extends FieldPluginBase {

  /**
   * {@inheritdoc}
   */
  public function query(): void {
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>|string
   *   The status badge.
   */
  public function render(ResultRow $values) {
    $user = $this->getEntity($values);
    if (!$user instanceof UserInterface) {
      return '';
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:badge',
      '#props' => [
        'label' => (string) ($user->isBlocked() ? $this->t('Disabled') : $this->t('Active')),
        'tone' => $user->isBlocked() ? 'offline' : 'running',
      ],
      '#cache' => ['max-age' => 0],
    ];
  }

}
