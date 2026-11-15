<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Confirms a workspace delete by its slug, typed out.
 *
 * A blocked workspace keeps the parent's blocker list and gets no field.
 */
final class BbWorkspaceDeleteForm extends BbContentEntityDeleteForm {

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $form = parent::buildForm($form, $form_state);
    if (($form['actions']['submit']['#access'] ?? TRUE) !== FALSE) {
      // The page renders no messages region; a wrong slug is reported here.
      $form['messages'] = ['#type' => 'status_messages', '#weight' => 9];
      $form['confirm_slug'] = [
        '#type' => 'textfield',
        '#title' => $this->t('Type the workspace slug %slug to confirm', ['%slug' => $this->workspace()->getSlug()]),
        '#required' => TRUE,
        '#weight' => 10,
      ];
    }
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    parent::validateForm($form, $form_state);
    if (!isset($form['confirm_slug']) || $form_state->getErrors() !== []) {
      return;
    }
    if (trim((string) $form_state->getValue('confirm_slug')) !== $this->workspace()->getSlug()) {
      $form_state->setErrorByName('confirm_slug', $this->t('The slug does not match. Type %slug to delete this workspace.', ['%slug' => $this->workspace()->getSlug()]));
    }
  }

  /**
   * The workspace being deleted.
   */
  private function workspace(): BbWorkspaceInterface {
    $entity = $this->getEntity();
    assert($entity instanceof BbWorkspaceInterface);
    return $entity;
  }

}
