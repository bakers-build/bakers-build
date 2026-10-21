<?php

declare(strict_types=1);

namespace Drupal\bb_connector\Entity;

use Drupal\Core\Config\Entity\ConfigEntityBase;
use Drupal\Core\Entity\Attribute\ConfigEntityType;
use Drupal\Core\Entity\EntityDeleteForm;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_connector\Form\BbConnectorForm;
use Drupal\bb_connector\ListBuilder\BbConnectorListBuilder;

/**
 * Represents one configured external system instance (e.g. a GitLab).
 *
 * Tokens are stored as a config property but their real value is injected
 * via config overrides in settings.php from an environment variable:
 * @code
 * $config['bb_connector.connector.keytec_gitlab']['settings']['token']
 *   = getenv('BB_GITLAB_TOKEN_KEYTEC');
 * @endcode
 */
#[ConfigEntityType(
  id: 'bb_connector',
  label: new TranslatableMarkup('bakers.build connector'),
  label_collection: new TranslatableMarkup('bakers.build connectors'),
  label_singular: new TranslatableMarkup('bakers.build connector'),
  label_plural: new TranslatableMarkup('bakers.build connectors'),
  config_prefix: 'connector',
  entity_keys: ['id' => 'id', 'label' => 'label'],
  handlers: [
    'list_builder' => BbConnectorListBuilder::class,
    'form' => [
      'add' => BbConnectorForm::class,
      'edit' => BbConnectorForm::class,
      'delete' => EntityDeleteForm::class,
    ],
    'route_provider' => ['html' => AdminHtmlRouteProvider::class],
  ],
  links: [
    'add-form' => '/admin/bakers/config/connector/add',
    'edit-form' => '/admin/bakers/config/connector/{bb_connector}/edit',
    'delete-form' => '/admin/bakers/config/connector/{bb_connector}/delete',
    'collection' => '/admin/bakers/config/connectors',
  ],
  admin_permission: 'administer bakers',
  config_export: ['id', 'label', 'plugin', 'import_interval', 'settings'],
)]
final class BbConnector extends ConfigEntityBase implements BbConnectorInterface {

  /**
   * The connector machine name.
   */
  protected string $id = '';

  /**
   * The human-readable label.
   */
  protected string $label = '';

  /**
   * The connector plugin ID.
   */
  protected string $plugin = 'gitlab';

  /**
   * Cron import interval in seconds; 0 disables cron import.
   */
  protected int $import_interval = 0;

  /**
   * Plugin-specific settings.
   *
   * @var array<string, mixed>
   */
  protected array $settings = [];

  /**
   * {@inheritdoc}
   */
  public function getPluginId(): string {
    return $this->plugin;
  }

  /**
   * {@inheritdoc}
   */
  public function getImportInterval(): int {
    return $this->import_interval;
  }

  /**
   * {@inheritdoc}
   */
  public function getSetting(string $key): mixed {
    return $this->settings[$key] ?? NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getSettings(): array {
    return $this->settings;
  }

}
