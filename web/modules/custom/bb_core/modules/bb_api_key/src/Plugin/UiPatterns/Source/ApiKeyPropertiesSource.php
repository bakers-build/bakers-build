<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\UiPatterns\Source;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_api_key\Plugin\views\field\ApiKeyStatus;
use Drupal\bb_core\Time\BbDate;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The API key page's properties: name, created, expires and status.
 *
 * Last use is not shown: no key records when it was last used.
 */
#[Source(
  id: 'bb_api_key_properties',
  label: new TranslatableMarkup('[bakers.build] API key properties'),
  description: new TranslatableMarkup('The name, dates and status of an API key.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:consumer', label: new TranslatableMarkup('API key'), required: TRUE),
  ],
)]
final class ApiKeyPropertiesSource extends SourcePluginBase {

  /**
   * Formats the key's dates.
   */
  protected BbDate $date;

  /**
   * The current time, for the status.
   */
  protected TimeInterface $time;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->date = $container->get(BbDate::class);
    $instance->time = $container->get('datetime.time');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $key = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$key instanceof ConsumerInterface) {
      return [];
    }
    $rows = [
      (string) $this->t('Name') => (string) $key->label(),
      (string) $this->t('Created') => $this->date($key->get('bb_key_created')->value),
      (string) $this->t('Expires') => $this->date($key->get('bb_expires')->value),
      (string) $this->t('Status') => (string) ApiKeyStatus::statusOf($key, $this->time->getCurrentTime())[0],
    ];
    $items = [];
    foreach ($rows as $label => $value) {
      $items[] = [
        'cells' => [
          'label' => ['kind' => 'text', 'value' => $label, 'emphasis' => 'faint'],
          'value' => ['kind' => 'text', 'value' => $value],
        ],
      ];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:list',
      '#props' => ['layout' => 'plain', 'items' => $items],
      // Time-sensitive: an Active status must not outlive the expiry.
      '#cache' => ['max-age' => 0],
    ];
  }

  /**
   * A stored timestamp as a date, or a dash.
   */
  private function date(mixed $timestamp): string {
    return is_numeric($timestamp) ? $this->date->date((int) $timestamp) : '—';
  }

}
