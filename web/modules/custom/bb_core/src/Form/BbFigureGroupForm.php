<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\EntityForm;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbFigureGroup;

/**
 * Add/edit form for titled figure groups.
 */
final class BbFigureGroupForm extends EntityForm {

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $formState): array {
    $form = parent::form($form, $formState);
    /** @var \Drupal\bb_core\BbFigureGroupInterface $group */
    $group = $this->entity;
    $form['label'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Title'),
      '#default_value' => $group->label(),
      '#required' => TRUE,
    ];
    $form['id'] = [
      '#type' => 'machine_name',
      '#default_value' => $group->id(),
      '#machine_name' => ['exists' => [BbFigureGroup::class, 'load']],
      '#disabled' => !$group->isNew(),
    ];
    $form['weight'] = [
      '#type' => 'number',
      '#title' => $this->t('Weight'),
      '#default_value' => $group->getWeight(),
    ];
    $form['figures'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Figure IDs'),
      '#description' => $this->t('One ID per line, in display order.'),
      '#default_value' => implode("\n", $group->getFigures()),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $formState): void {
    $lines = preg_split('/\R/', (string) $formState->getValue('figures')) ?: [];
    $formState->setValue('figures', array_values(array_filter(array_map('trim', $lines))));
    parent::submitForm($form, $formState);
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $formState): int {
    $result = $this->entity->save();
    $this->messenger()->addStatus($this->t('Figure group %label saved.', ['%label' => $this->entity->label()]));
    $formState->setRedirectUrl($this->entity->toUrl('collection'));
    return $result;
  }

}
