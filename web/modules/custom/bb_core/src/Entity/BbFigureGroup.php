<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Config\Entity\ConfigEntityBase;
use Drupal\Core\Entity\Attribute\ConfigEntityType;
use Drupal\Core\Entity\EntityDeleteForm;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_core\Form\BbFigureGroupForm;
use Drupal\bb_core\BbFigureInterface;
use Drupal\bb_core\BbFigureGroupInterface;
use Drupal\bb_core\ListBuilder\BbFigureGroupListBuilder;

/**
 * Stores a titled, ordered group of statistics figures.
 */
#[ConfigEntityType(
  id: 'bb_figure_group',
  label: new TranslatableMarkup('bakers.build figure group'),
  label_collection: new TranslatableMarkup('bakers.build figure groups'),
  label_singular: new TranslatableMarkup('bakers.build figure group'),
  label_plural: new TranslatableMarkup('bakers.build figure groups'),
  config_prefix: 'bb_figure_group',
  entity_keys: ['id' => 'id', 'label' => 'label', 'weight' => 'weight'],
  handlers: [
    'list_builder' => BbFigureGroupListBuilder::class,
    'form' => [
      'add' => BbFigureGroupForm::class,
      'edit' => BbFigureGroupForm::class,
      'delete' => EntityDeleteForm::class,
    ],
    'route_provider' => ['html' => AdminHtmlRouteProvider::class],
  ],
  links: [
    'add-form' => '/admin/bakers/config/statistics/groups/add',
    'edit-form' => '/admin/bakers/config/statistics/groups/{bb_figure_group}/edit',
    'delete-form' => '/admin/bakers/config/statistics/groups/{bb_figure_group}/delete',
    'collection' => '/admin/bakers/config/statistics/groups',
  ],
  admin_permission: 'administer bakers',
  config_export: ['id', 'label', 'weight', 'figures'],
)]
final class BbFigureGroup extends ConfigEntityBase implements BbFigureGroupInterface {

  /**
   * The configuration identifier.
   */
  protected string $id = '';
  /**
   * The display title.
   */
  protected string $label = '';
  /**
   * The display weight.
   */
  protected int $weight = 0;
  /**
   * The ordered figure identifiers.
   */
  protected array $figures = [];

  /**
   * {@inheritdoc}
   */
  public function getWeight(): int {
    return $this->weight;
  }

  /**
   * {@inheritdoc}
   */
  public function getFigures(): array {
    return $this->figures;
  }

  /**
   * {@inheritdoc}
   */
  public function calculateDependencies() {
    parent::calculateDependencies();
    foreach ($this->figures as $figureId) {
      $this->addDependency('config', 'bb_core.bb_figure.' . $figureId);
    }
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function preSave(EntityStorageInterface $storage): void {
    parent::preSave($storage);
    if (count($this->figures) !== count(array_unique($this->figures))) {
      throw new \InvalidArgumentException(sprintf('bakers.build figure group "%s" contains duplicate figures.', $this->id()));
    }
    $figureStorage = \Drupal::entityTypeManager()->getStorage('bb_figure');
    foreach ($this->figures as $figureId) {
      if (!$figureStorage->load($figureId) instanceof BbFigureInterface) {
        throw new \InvalidArgumentException(sprintf('bakers.build figure group "%s" references unknown figure "%s".', $this->id(), $figureId));
      }
    }
  }

}
