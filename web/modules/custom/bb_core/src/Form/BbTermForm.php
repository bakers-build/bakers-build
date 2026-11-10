<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbTermInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\island\Form\WrappedDialogFormTrait;

/**
 * Adds or edits a term of one bundle in the workspace of the route.
 *
 * The workspace is fixed by the route, so only name and description are
 * editable. Opened from the tab's Add action it answers through the dialog
 * wrapper format and lands back where it was opened; otherwise saving returns
 * to the bundle's settings tab.
 */
final class BbTermForm extends BbContentEntityFormBase {

  use WrappedDialogFormTrait;

  /**
   * The settings tab route of each bundle.
   */
  private const TAB_ROUTES = [
    'type' => 'view.bb_terms.types',
    'recipe' => 'view.bb_terms.recipes',
    'label' => 'view.bb_terms.labels',
  ];

  /**
   * {@inheritdoc}
   */
  public function getEntityFromRouteMatch(RouteMatchInterface $route_match, $entity_type_id) {
    $entity = parent::getEntityFromRouteMatch($route_match, $entity_type_id);
    assert($entity instanceof BbTermInterface);
    $workspace = $route_match->getParameter('bb_workspace');
    if ($entity->isNew() && $workspace instanceof BbWorkspaceInterface) {
      $entity->set('workspace_id', $workspace->id());
    }
    return $entity;
  }

  /**
   * {@inheritdoc}
   *
   * The owner is the acting account and not edited here. The shell places no
   * messages region, so validation errors render inside the form. On the page
   * the form saves through a native round trip: a boosted submit would swap
   * the redirect's response in place instead of landing on the tab.
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    if (!$this->isDialogRequest()) {
      $form['#attributes']['data-hx-boost'] = 'false';
      // Opened by a boosted link, core's action keeps `ajax_page_state`; a
      // page re-rendered after an error would then arrive without assets.
      $form['#action'] = $this->cleanCurrentUrl()->toString();
    }
    $form['owner_user_id']['#access'] = FALSE;
    $form['messages'] = ['#type' => 'status_messages', '#weight' => -1000];
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): ContentEntityInterface {
    $entity = parent::validateForm($form, $form_state);
    // Core filters violations of unedited fields. The route-bound workspace
    // must still satisfy its scope constraint.
    foreach ($entity->get('workspace_id')->validate() as $violation) {
      $form_state->setErrorByName('', $violation->getMessage());
    }
    return $entity;
  }

  /**
   * {@inheritdoc}
   *
   * Cancel leaves without saving: back where the form was opened, else to
   * the bundle's tab.
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    $back = $this->getRequest()->query->has(static::RETURN_PARAMETER) ? $this->returnUrl() : $this->tabUrl();
    if ($back !== NULL) {
      $actions['cancel'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => [
          'variant' => 'ghost',
          'label' => (string) $this->t('Cancel'),
          'href' => $back->toString(),
          'attributes' => new Attribute(['data-dialog-cancel' => 'data-dialog-cancel']),
        ],
        '#weight' => -10,
      ];
    }
    return $actions;
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $term = $this->getEntity();
    assert($term instanceof BbTermInterface);
    $result = $term->save();
    $this->messenger()->addStatus($this->t('%label saved.', ['%label' => $term->label()]));
    if ($this->isDialogRequest() || $this->getRequest()->query->has(static::RETURN_PARAMETER)) {
      // Back where the form was opened, without the htmx keys a boosted
      // screen leaves in its destination: core would redirect to the raw one.
      $this->respondAtReturnUrl($form_state);
      $this->getRequest()->query->remove(static::RETURN_PARAMETER);
      return $result;
    }
    $tab = $this->tabUrl();
    if ($tab !== NULL) {
      $form_state->setRedirectUrl($tab);
    }
    return $result;
  }

  /**
   * The bundle's settings tab in the term's workspace, if it has one.
   */
  private function tabUrl(): ?Url {
    $term = $this->getEntity();
    assert($term instanceof BbTermInterface);
    $workspace = $term->get('workspace_id')->entity;
    $route = self::TAB_ROUTES[$term->bundle()] ?? NULL;
    return $route !== NULL && $workspace instanceof BbWorkspaceInterface
      ? Url::fromRoute($route, ['bb_workspace' => $workspace->getSlug()])
      : NULL;
  }

  /**
   * The current page, without the htmx keys a boosted link leaves on it.
   */
  private function cleanCurrentUrl(): Url {
    $query = $this->getRequest()->query->all();
    unset($query['ajax_page_state'], $query['_wrapper_format'], $query['_triggering_element_name'], $query['_triggering_element_value']);
    return Url::fromRoute('<current>', [], ['query' => $query]);
  }

}
