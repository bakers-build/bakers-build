<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldWidget;

use Drupal\Core\Field\Attribute\FieldWidget;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\WidgetBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Symfony\Component\Validator\ConstraintViolationInterface;

/**
 * Provides a widget for the bb_repo field type.
 *
 * Renders three text inputs — URL, default branch and branch convention — so
 * editors can capture full repository metadata within a single field instance.
 */
#[FieldWidget(
  id: 'bb_repo',
  label: new TranslatableMarkup('bakers.build repository'),
  field_types: ['bb_repo'],
)]
final class BbRepoWidget extends WidgetBase {

  /**
   * {@inheritdoc}
   */
  public function formElement(FieldItemListInterface $items, $delta, array $element, array &$form, FormStateInterface $form_state): array {
    $item = $items[$delta];
    // One labelled unit for the three parts, as core's LinkWidget does.
    $element['#type'] = 'fieldset';
    // A plain textfield, not '#type' => 'url': Drupal's url element validates
    // absolute URLs via UrlHelper::isValid($v, TRUE), which rejects both SSH
    // forms (scp shorthand has no scheme; 'ssh' is not whitelisted). Validation
    // is owned by the bb_repo field's BbRepoUrl constraint instead, which
    // surfaces a specific message on this sub-element.
    $element['url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('URL'),
      '#default_value' => $item->url ?? NULL,
      '#required' => $element['#required'] ?? FALSE,
      '#maxlength' => 2048,
      '#description' => $this->t('Repository clone URL. Use an <code>https://</code> URL, the SSH URI form <code>ssh://git@host/path.git</code>, or the SSH shorthand <code>git@host:path.git</code>. This is the repository a run clones a worktree from.'),
    ];
    $element['default_branch'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Default branch'),
      '#default_value' => $item->default_branch ?? NULL,
      '#description' => $this->t("Branch new work is based on (worktree base / MR target). A sub-ticket uses its parent ticket's own branch instead. Leave empty to default to <code>main</code>."),
    ];
    $element['branch_convention'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Branch convention'),
      '#default_value' => $item->branch_convention ?? NULL,
      '#description' => $this->t("Drupal-token template naming the branch created for a new ticket; it never renames an existing ticket's branch. Leave empty to use the default <code>feat/[bb_ticket:identifier]-[bb_ticket:title]</code>."),
    ];
    return $element;
  }

  /**
   * {@inheritdoc}
   *
   * Routes a sub-property violation (chiefly the BbRepoUrl constraint on the
   * `url` property) to its own sub-element, mirroring core LinkWidget. Without
   * this the whole per-delta element is flagged, wrongly marking the empty
   * default_branch/branch_convention inputs and detaching the message from the
   * offending field.
   */
  public function errorElement(array $element, ConstraintViolationInterface $violation, array $form, FormStateInterface $form_state) {
    $element = parent::errorElement($element, $violation, $form, $form_state);
    if ($element === FALSE) {
      return FALSE;
    }
    $property_path = explode('.', $violation->getPropertyPath());
    $property = end($property_path);
    return $element[$property] ?? $element;
  }

}
