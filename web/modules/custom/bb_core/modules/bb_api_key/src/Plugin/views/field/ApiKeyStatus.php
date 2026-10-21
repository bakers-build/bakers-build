<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\views\field;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Disabled / Expired / Active, computed at render time.
 */
#[ViewsField('bb_api_key_status')]
final class ApiKeyStatus extends FieldPluginBase {

  /**
   * The time service, for the expiry comparison.
   */
  protected TimeInterface $time;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->time = $container->get('datetime.time');
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
   * @return array<string, mixed>|string
   *   A status badge, or nothing for a non-consumer row.
   */
  public function render(ResultRow $values) {
    $entity = $this->getEntity($values);
    if (!$entity instanceof ConsumerInterface) {
      return '';
    }
    [$label, $tone] = match (TRUE) {
      !(bool) $entity->get('status')->value => [$this->t('Disabled'), 'offline'],
      $this->isExpired($entity) => [$this->t('Expired'), 'critical'],
      default => [$this->t('Active'), 'running'],
    };
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:badge',
      '#props' => ['label' => (string) $label, 'tone' => $tone],
      // Time-sensitive: an Active badge must not outlive its expiry.
      '#cache' => ['max-age' => 0],
    ];
  }

  /**
   * Whether the key has reached its stored expiry.
   */
  private function isExpired(ConsumerInterface $entity): bool {
    $expires = $entity->get('bb_expires')->value;
    // A managed key with no expiry at all is invalid, not perpetually valid.
    return $expires === NULL || $expires === '' || (int) $expires <= $this->time->getCurrentTime();
  }

}
