<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;

/**
 * Shared content entity form that groups fields into a meta container.
 *
 * Subclasses declare meta groups via metaGroups(). The base builds the
 * standard `advanced` container and one element per group:
 *   - the reserved key `meta` renders as the always-open header block;
 *   - any other key renders as a collapsible `details` accordion panel.
 * Each listed field is assigned to its group only when present on the form, so
 * fields hidden by other code are left untouched. Fields not listed in any
 * group stay in the main column.
 */
class BbContentEntityFormBase extends ContentEntityForm {

  /**
   * Declares the meta groups for this entity form.
   *
   * @return array<string, array{label: \Drupal\Core\StringTranslation\TranslatableMarkup, open?: bool, weight?: int, fields: string[]}>
   *   Groups keyed by machine name. Key `meta` is the always-open header
   *   block; any other key is a collapsible accordion panel. A group key must
   *   not equal a field machine name on the same entity. Empty → no meta
   *   container.
   */
  protected static function metaGroups(): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    if ($this->getOperation() === 'settings') {
      // The tab body marker the browser suite locates a settings tab by.
      $form['#attributes']['data-bakers-tab-body'] = 'settings';
      // Settings save on an explicit Save through a native page round trip;
      // a boosted submit would swap the response instead of reloading it.
      $form['#attributes']['data-hx-boost'] = 'false';
      $form['#action'] = $this->settingsUrl()->toString();
      // The shell island profile places no messages region, so the Save
      // confirmation and validation errors render inside the form.
      $form['messages'] = ['#type' => 'status_messages', '#weight' => -1000];
      unset($form['created'], $form['changed']);
      return $form;
    }

    $groups = static::metaGroups();
    if ($groups === []) {
      return $form;
    }

    // Only create the meta container when the parent has not already set
    // one up (e.g. as vertical tabs for a revisionable entity).
    if (!isset($form['advanced'])) {
      $form['advanced'] = [
        '#type' => 'container',
        '#weight' => 99,
        '#attributes' => ['class' => ['entity-meta']],
      ];
    }

    foreach ($groups as $key => $group) {
      $element = [
        '#type' => 'details',
        '#title' => $group['label'],
        '#group' => 'advanced',
        '#open' => $group['open'] ?? TRUE,
        '#weight' => $group['weight'] ?? 0,
      ];
      // The reserved `meta` key is the always-open header block at the top of
      // the container, marked like core's NodeForm. Other keys are collapsible
      // panels.
      if ($key === 'meta') {
        $element['#attributes']['class'][] = 'entity-meta__header';
      }
      $form[$key] = $element;
      foreach ($group['fields'] as $field_name) {
        if (isset($form[$field_name])) {
          $form[$field_name]['#group'] = $key;
        }
      }
    }

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    if ($this->getOperation() === 'settings') {
      $result = $this->entity->save();
      $this->addSavedMessage();
      $form_state->setRedirectUrl($this->settingsUrl());
      return $result;
    }
    $result = parent::save($form, $form_state);
    $this->addSavedMessage();
    $form_state->setRedirectUrl($this->landing());

    return $result;
  }

  /**
   * The product page a save lands on: the entity's own, a comment's ticket.
   */
  private function landing(): Url {
    $entity = $this->getEntity();
    $ticket = $entity instanceof FieldableEntityInterface && $entity->getEntityTypeId() === 'bb_comment'
      ? $entity->get('ticket_id')->entity
      : NULL;
    if ($ticket instanceof EntityInterface) {
      return $ticket->toUrl();
    }
    return $entity->hasLinkTemplate('canonical') ? $entity->toUrl() : Url::fromRoute('<front>');
  }

  /**
   * The current Settings screen, without core's htmx transport keys.
   *
   * A Settings tab is opened by an htmx GET, and `htmx-assets.js` puts
   * `ajax_page_state[...]` on its query. Kept in the POST target or the
   * redirect, the landing page treats every library as already loaded and
   * arrives with no CSS or JS.
   */
  private function settingsUrl(): Url {
    $query = $this->getRequest()->query->all();
    unset($query['ajax_page_state'], $query['_wrapper_format'], $query['_triggering_element_name'], $query['_triggering_element_value']);
    return Url::fromRoute('<current>', [], ['query' => $query]);
  }

  /**
   * Adds the ordinary "saved" status message for the edited entity.
   */
  private function addSavedMessage(): void {
    $entity = $this->getEntity();
    $this->messenger()->addStatus($this->t('@type %label saved.', [
      '@type' => $entity->getEntityType()->getLabel(),
      '%label' => $entity->label() ?? $entity->id(),
    ]));
  }

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    unset($actions['delete']);
    return $actions + static::deleteAction($this->getEntity());
  }

  /**
   * The Delete action of a saved entity, shown only to who may delete it.
   *
   * @return array<string, array<string, mixed>>
   *   The `delete` action, or nothing when the entity has no delete form.
   */
  public static function deleteAction(EntityInterface $entity): array {
    if ($entity->isNew() || !$entity->hasLinkTemplate('delete-form') || !$entity->access('delete')) {
      return [];
    }
    // The confirm dialog over this page; the href is the page without JS.
    $url = $entity->toUrl('delete-form');
    return [
      'delete' => [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#attached' => ['library' => ['core/drupal.htmx']],
        '#props' => [
          'label' => (string) new TranslatableMarkup('Delete'),
          'href' => $url->toString(),
          'variant' => 'ghost',
          'attributes' => new Attribute(OverlayTrigger::attributes($url)),
        ],
        '#weight' => 100,
      ],
    ];
  }

}
