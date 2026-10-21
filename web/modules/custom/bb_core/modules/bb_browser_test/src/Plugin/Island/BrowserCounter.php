<?php

declare(strict_types=1);

namespace Drupal\bb_browser_test\Plugin\Island;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandEvent;
use Drupal\island\IslandPluginBase;
use Drupal\island\IslandResponse;

/**
 * Makes configured placement identity and event delivery visible to a browser.
 */
#[Island(
  id: 'browser_counter',
  label: new TranslatableMarkup('Browser event counter'),
  type: 'view',
)]
final class BrowserCounter extends IslandPluginBase {

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    $label = (string) ($this->configuration['label'] ?? 'Counter');
    $build = [
      'value' => ['#plain_text' => ($data['refreshed'] ?? FALSE) ? 'Refreshed ' . $label : 'Original ' . $label],
    ];
    if ($this->configuration['trigger'] ?? FALSE) {
      $build['action'] = $this->action('refresh', [], $this->t('Refresh counters'));
    }
    return $build;
  }

  /**
   * {@inheritdoc}
   */
  public function accessAction(string $action, array $parameters, AccountInterface $account): AccessResultInterface {
    return AccessResult::allowedIf($action === 'refresh')
      ->andIf(AccessResult::allowedIfHasPermission($account, 'administer island profiles'));
  }

  /**
   * {@inheritdoc}
   */
  public function applyAction(string $action, array $parameters): IslandResponse {
    if ($action === 'refresh') {
      // App data changes during the action. Subscribed component mappings must
      // read this request's data again when the responder dispatches the event.
      $this->requestStack->getCurrentRequest()?->attributes->set('bb_browser_test_refreshed', TRUE);
    }
    return $action === 'refresh'
      ? IslandResponse::make()->rebuildSelf()->dispatch('counter.changed')
      : parent::applyAction($action, $parameters);
  }

  /**
   * {@inheritdoc}
   */
  public function getSubscribedEvents(): array {
    return ['counter.changed' => 'onCounterChanged'];
  }

  /**
   * Shows an event arrived while preserving the placement's configuration.
   *
   * @return array<string, mixed>
   *   The refreshed placement.
   */
  public function onCounterChanged(IslandEvent $event): array {
    return $this->build(['refreshed' => $event->name === 'counter.changed']);
  }

}
