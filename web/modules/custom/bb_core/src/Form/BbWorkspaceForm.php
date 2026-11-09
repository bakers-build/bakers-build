<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\RunLog\RunLogPolicy;

/**
 * Workspace entity form with a meta header block on admin screens.
 *
 * The product Settings surface skips Meta (created/changed). Delete is not
 * offered here until Linear-style delayed delete exists.
 */
final class BbWorkspaceForm extends BbContentEntityFormBase {

  /**
   * {@inheritdoc}
   */
  protected static function metaGroups(): array {
    return [
      'meta' => [
        'label' => new TranslatableMarkup('Meta'),
        'open' => TRUE,
        'weight' => 0,
        'fields' => ['created', 'changed'],
      ],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    if ($this->getOperation() !== 'settings') {
      return $form;
    }
    // The slug is the public URL handle. It is authored once at provision
    // (derived from the name) and must not move afterwards — a rename of
    // the slug would rewrite every product URL. Shown here so a lead can
    // copy it; not a widget on the shared settings display, because that
    // display is also the create dialog, which must keep deriving the slug.
    $form['slug_display'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Slug'),
      '#default_value' => $this->entity instanceof BbWorkspaceInterface
        ? $this->entity->getSlug()
        : '',
      '#description' => $this->t('The workspace handle used as the first path segment of every product URL.'),
      '#disabled' => TRUE,
      '#attributes' => [
        'readonly' => 'readonly',
        'disabled' => 'disabled',
      ],
      '#weight' => 1,
    ];
    if (!RunLogPolicy::isAvailable()) {
      // Field access hides the checkbox; say why instead of leaving a gap.
      $form['run_log_storage_unavailable'] = [
        '#type' => 'item',
        '#title' => $this->t('Store agent run logs'),
        '#markup' => $this->t('Unavailable: this deployment does not store agent transcripts. Error messages of failed runs are still kept.'),
        '#weight' => 4,
      ];
    }
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    if ($this->getOperation() === 'settings') {
      $actions['#attributes']['class'][] = 'flex-wrap';
      $actions['workspace_overview'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#variant' => 'neutral',
        '#props' => [
          'label' => $this->t('Workspace overview'),
          'href' => Url::fromRoute('bb_core.home')->toString(),
          'attributes' => new Attribute(['data-hx-boost' => 'false']),
        ],
        '#weight' => 10,
      ];
    }
    return $actions;
  }

}
