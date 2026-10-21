<?php

declare(strict_types=1);

namespace Drupal\island\Entity;

use Drupal\Core\Config\Entity\ConfigEntityBase;
use Drupal\Core\Entity\Attribute\ConfigEntityType;
use Drupal\Core\Entity\EntityDeleteForm;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Form\AppForm;
use Drupal\island\ListBuilder\AppListBuilder;
use Drupal\Core\Entity\Routing\AdminHtmlRouteProvider;

/**
 * Defines a first-class island application.
 */
#[ConfigEntityType(
  id: 'island_app',
  label: new TranslatableMarkup('Island app'),
  label_collection: new TranslatableMarkup('Island apps'),
  label_singular: new TranslatableMarkup('island app'),
  label_plural: new TranslatableMarkup('island apps'),
  config_prefix: 'app',
  entity_keys: ['id' => 'id', 'label' => 'label'],
  handlers: [
    'list_builder' => AppListBuilder::class,
    'form' => ['add' => AppForm::class, 'edit' => AppForm::class, 'delete' => EntityDeleteForm::class],
    'route_provider' => ['html' => AdminHtmlRouteProvider::class],
  ],
  links: [
    'add-form' => '/admin/structure/island/apps/add',
    'edit-form' => '/admin/structure/island/apps/{island_app}/edit',
    'delete-form' => '/admin/structure/island/apps/{island_app}/delete',
    'collection' => '/admin/structure/island/apps',
  ],
  admin_permission: 'administer island apps',
  config_export: ['id', 'label', 'status', 'provider', 'default_profile'],
)]
final class App extends ConfigEntityBase implements AppInterface {

  /**
   * The machine name.
   */
  protected string $id = '';

  /**
   * The human-readable label.
   */
  protected string $label = '';

  /**
   * The provider integration id.
   */
  protected string $provider = 'default';

  /**
   * The fallback profile id.
   */
  protected string $default_profile = '';

  /**
   * {@inheritdoc}
   */
  public function getProviderId(): string {
    return $this->provider;
  }

  /**
   * {@inheritdoc}
   */
  public function getDefaultProfileId(): string {
    return $this->default_profile;
  }

  /**
   * Returns the configured provider id for app integrations.
   */
  public function getAppProviderId(): string {
    return $this->getProviderId();
  }

}
