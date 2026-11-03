<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbMachineInterface;

/**
 * Machine admin form: the instance admin's maintenance form.
 *
 * Owners edit on the detail page cards. Host key is frozen after save; the
 * form replaces its widget with a locked badge. Current load stays on the
 * form for the instance admin.
 */
final class BbMachineForm extends BbContentEntityFormBase {

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    if ($this->entity->isNew()) {
      return $form;
    }
    $host_key = $this->entity instanceof BbMachineInterface
      ? $this->entity->getHostKey()
      : '';
    $form['host_key_display'] = [
      '#type' => 'item',
      '#title' => $this->t('Host key'),
      '#weight' => $form['host_key']['#weight'] ?? 1,
      '#description' => $this->t('Assigned at registration and cannot be changed.'),
      'value' => [
        '#type' => 'component',
        '#component' => 'bb_theme:badge',
        '#props' => [
          'label' => $host_key,
          'icon' => 'lock',
          'tone' => 'neutral',
          'mono' => TRUE,
        ],
      ],
    ];
    return $form;
  }

}
