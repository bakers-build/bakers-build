<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\EntityDeleteForm;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Confirms a config entity delete; opened from a trigger, as the dialog.
 */
class BbConfigEntityDeleteForm extends EntityDeleteForm {

  use DeleteDialogFormTrait;

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $form = parent::buildForm($form, $form_state);
    $this->attachDeleteDialog($form);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getQuestion(): TranslatableMarkup {
    return $this->t('Delete @label', ['@label' => $this->getEntity()->label() ?: $this->getEntity()->getEntityType()->getSingularLabel()]);
  }

}
