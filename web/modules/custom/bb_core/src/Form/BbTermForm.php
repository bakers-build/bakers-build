<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbTermInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Adds or edits a term of one bundle in the workspace of the route.
 *
 * The workspace is fixed by the route, so only name and description are
 * editable. After saving, the form returns to the bundle's settings tab.
 */
final class BbTermForm extends BbContentEntityFormBase {

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
   * messages region, so validation errors render inside the form. The edit
   * page saves through a native round trip: a boosted submit would swap the
   * redirect's response in place instead of landing on the tab.
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    if (!$this->getEntity()->isNew()) {
      $form['#attributes']['data-hx-boost'] = 'false';
    }
    $form['owner_user_id']['#access'] = FALSE;
    $form['messages'] = ['#type' => 'status_messages', '#weight' => -1000];
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
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $term = $this->getEntity();
    assert($term instanceof BbTermInterface);
    $result = $term->save();
    $this->messenger()->addStatus($this->t('%label saved.', ['%label' => $term->label()]));
    $workspace = $term->get('workspace_id')->entity;
    $route = self::TAB_ROUTES[$term->bundle()] ?? NULL;
    if ($route !== NULL && $workspace instanceof BbWorkspaceInterface) {
      $form_state->setRedirectUrl(Url::fromRoute($route, ['bb_workspace' => $workspace->getSlug()]));
    }
    return $result;
  }

  /**
   * {@inheritdoc}
   *
   * Terms have no delete route.
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    unset($actions['delete']);
    return $actions;
  }

}
