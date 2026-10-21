<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\views\field;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Datetime\DateFormatterInterface;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\user\UserInterface;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * One row's key summary: how many managed keys, and until when (UTC).
 *
 * Never the secret — only `ApiKeyManager::create()`'s own one-time response
 * carries it, and nothing here reads or serializes it. Each key is listed
 * and revoked on the account's API keys page.
 */
#[ViewsField('bb_service_account_keys')]
final class ServiceAccountKeys extends FieldPluginBase {

  /**
   * Reads each row's workspace and managed consumers.
   */
  protected ServiceAccountManager $serviceAccountManager;

  /**
   * The time service, for the expiry comparison.
   */
  protected TimeInterface $time;

  /**
   * Formats each key's dates.
   */
  protected DateFormatterInterface $dateFormatter;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->serviceAccountManager = $container->get(ServiceAccountManager::class);
    $instance->time = $container->get('datetime.time');
    $instance->dateFormatter = $container->get('date.formatter');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
  }

  /**
   * {@inheritdoc}
   *
   * @return array<int|string, mixed>|string
   *   One line per key; empty for a non-user row.
   */
  public function render(ResultRow $values) {
    $user = $this->getEntity($values);
    if (!$user instanceof UserInterface) {
      return '';
    }
    $workspace = $this->serviceAccountManager->workspace($user);
    if (!$workspace instanceof BbWorkspaceInterface) {
      return '';
    }

    $consumers = $this->serviceAccountManager->managedConsumers($user);
    if ($consumers === []) {
      return ['#markup' => $this->t('No key'), '#cache' => ['max-age' => 0]];
    }
    // `bb_expires` is the midnight AFTER the last valid UTC day (see
    // ApiKeyManager::expiryTimestamp()); show the day the admin picked.
    $latest = max(array_map(fn ($consumer): int => (int) $consumer->get('bb_expires')->value, $consumers));
    $args = [
      '@date' => $this->dateFormatter->format($latest - 1, 'custom', 'j M Y', 'UTC'),
    ];
    $summary = $latest <= $this->time->getCurrentTime()
      ? $this->formatPlural(count($consumers), '1 key · expired @date', '@count keys · expired @date', $args)
      : $this->formatPlural(count($consumers), '1 key · until @date', '@count keys · until @date', $args);
    return ['#markup' => $summary, '#cache' => ['max-age' => 0]];
  }

}
