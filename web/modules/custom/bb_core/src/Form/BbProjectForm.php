<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Project entity form with a meta header block.
 */
final class BbProjectForm extends BbContentEntityFormBase {

  /**
   * {@inheritdoc}
   */
  protected static function metaGroups(): array {
    return [
      'meta' => [
        'label' => new TranslatableMarkup('Meta'),
        'open' => TRUE,
        'weight' => 0,
        'fields' => ['group_id', 'created', 'changed'],
      ],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    if ($this->getOperation() === 'settings') {
      $form += static::dangerZone(
        $this->entity,
        $this->t('Delete project'),
        $this->t('Deletes this project with its environments, conductors, templates and time accounts. Its tickets and logged time must be removed first.'),
      );
    }
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    if ($this->getOperation() === 'settings') {
      // Offered in the danger zone below the form instead.
      unset($actions['delete']);
    }
    return $actions;
  }

}
