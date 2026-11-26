<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\island\Form\WrappedDialogFormTrait;
use Symfony\Component\DependencyInjection\ContainerInterface;

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
 *
 * An entity without a page of its own (no `canonical` link) is edited in
 * place like a Settings tab: the save stays on its edit form, or lands on a
 * given `destination`. Opened through the dialog wrapper format, the form
 * posts into the dialog and answers the save there. A new entity with a
 * `workspace_id` takes the route's workspace, which is still validated.
 */
class BbContentEntityFormBase extends ContentEntityForm {

  use WrappedDialogFormTrait;

  /**
   * {@inheritdoc}
   *
   * Core's construction, not the trait's: the base answers a dialog by
   * navigation and sends no island intents, so it needs no
   * `island.responder`. A subclass that returns intents from
   * dialogResponse() uses the trait itself.
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('entity.repository'),
      $container->get('entity_type.bundle.info'),
      $container->get('datetime.time'),
    );
  }

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
    if ($this->editsInPlace()) {
      return $this->inPlaceForm($form);
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
   * The in-place form: no meta groups, messages inside, read-only fields out.
   *
   * @param array<string, mixed> $form
   *   The built form.
   *
   * @return array<string, mixed>
   *   The form, saved through a native round trip or into its dialog.
   */
  private function inPlaceForm(array $form): array {
    if ($this->getOperation() === 'settings') {
      // The tab body marker the browser suite locates a settings tab by.
      $form['#attributes']['data-bakers-tab-body'] = 'settings';
    }
    if (!$this->isDialogRequest()) {
      // Saved by an explicit Save through a native page round trip; a
      // boosted submit would swap the response instead of reloading it.
      $form['#attributes']['data-hx-boost'] = 'false';
      $form['#action'] = $this->settingsUrl()->toString();
      // The shell island profile places no messages region, so the Save
      // confirmation and validation errors render inside the form. A dialog
      // has its own message region.
      $form['messages'] = ['#type' => 'status_messages', '#weight' => -1000];
    }
    unset($form['created'], $form['changed']);
    $text = $this->dangerZoneText();
    if ($text !== []) {
      $form += static::dangerZone($this->entity, ...$text);
    }
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getEntityFromRouteMatch(RouteMatchInterface $route_match, $entity_type_id) {
    $entity = parent::getEntityFromRouteMatch($route_match, $entity_type_id);
    $workspace = $route_match->getParameter('bb_workspace');
    if ($entity->isNew() && !$entity->hasLinkTemplate('canonical') && $workspace instanceof BbWorkspaceInterface
      && $entity instanceof FieldableEntityInterface && $entity->hasField('workspace_id') && $entity->get('workspace_id')->isEmpty()) {
      $entity->set('workspace_id', $workspace->id());
    }
    return $entity;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): ContentEntityInterface {
    $entity = parent::validateForm($form, $form_state);
    // Core filters violations of unedited fields; the route-bound workspace
    // must still satisfy its scope constraint.
    if ($this->editsInPlace() && $entity->hasField('workspace_id')) {
      foreach ($entity->get('workspace_id')->validate() as $violation) {
        $form_state->setErrorByName('', $violation->getMessage());
      }
    }
    return $entity;
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    if ($this->editsInPlace()) {
      $result = $this->entity->save();
      $this->addSavedMessage();
      $this->landInPlace($form_state);
      return $result;
    }
    $result = parent::save($form, $form_state);
    $this->addSavedMessage();
    $form_state->setRedirectUrl($this->landing());

    return $result;
  }

  /**
   * Where an in-place save lands: its tab, the opening screen or its edit form.
   */
  private function landInPlace(FormStateInterface $form_state): void {
    if ($this->getOperation() === 'settings') {
      $form_state->setRedirectUrl($this->settingsUrl());
      return;
    }
    if ($this->isDialogRequest() || $this->getRequest()->query->has(static::RETURN_PARAMETER)) {
      $this->respondAtReturnUrl($form_state);
      // Core would redirect to the raw destination, htmx keys and all.
      $this->getRequest()->query->remove(static::RETURN_PARAMETER);
      return;
    }
    $form_state->setRedirectUrl($this->entity->toUrl('edit-form'));
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
    return HtmxTransport::currentUrl($this->getRequest());
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
    // Settings with a danger zone offer Delete there instead.
    if ($this->getOperation() === 'settings' && $this->dangerZoneText() !== []) {
      return $actions;
    }
    // Opened over a screen, Cancel returns there without saving.
    if ($this->editsInPlace() && $this->getRequest()->query->has(static::RETURN_PARAMETER)) {
      $actions['cancel'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => [
          'variant' => 'ghost',
          'label' => (string) $this->t('Cancel'),
          'href' => $this->returnUrl()->toString(),
          'attributes' => new Attribute(['data-dialog-cancel' => 'data-dialog-cancel']),
        ],
        '#weight' => -10,
      ];
    }
    return $actions + static::deleteAction($this->getEntity());
  }

  /**
   * Whether the form edits in place: a Settings tab, or an entity with no page.
   */
  private function editsInPlace(): bool {
    return $this->getOperation() === 'settings' || !$this->entity->hasLinkTemplate('canonical');
  }

  /**
   * The label and description of the Settings danger zone, if it has one.
   *
   * @return array{}|array{0: \Drupal\Core\StringTranslation\TranslatableMarkup, 1: \Drupal\Core\StringTranslation\TranslatableMarkup}
   *   Empty keeps Delete in the action row.
   */
  protected function dangerZoneText(): array {
    return [];
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

  /**
   * A saved entity's Delete set apart in a danger zone, for who may delete.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup $label
   *   The row title and button label, e.g. "Delete workspace".
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup $description
   *   What the delete removes, and what still blocks it.
   *
   * @return array<string, array<string, mixed>>
   *   The `danger_zone` element, or nothing without delete access.
   */
  public static function dangerZone(EntityInterface $entity, TranslatableMarkup $label, TranslatableMarkup $description): array {
    $delete = static::deleteAction($entity)['delete'] ?? NULL;
    if ($delete === NULL) {
      return [];
    }
    $delete['#props']['label'] = (string) $label;
    $delete['#props']['variant'] = 'danger';
    return [
      'danger_zone' => [
        '#type' => 'component',
        '#component' => 'bb_theme:danger_zone',
        '#props' => ['title' => $label, 'description' => $description],
        '#slots' => ['action' => ['delete' => $delete]],
        '#weight' => 1000,
      ],
    ];
  }

}
