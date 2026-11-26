<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\bb_core\Entity\BbEnvironmentInterface;
use Drupal\bb_core\Entity\BbProjectInterface;

/**
 * The environment form: the plain entity form, its project from the route.
 *
 * Its fields come from the form display. Kept as a class for what a form
 * display cannot express: the project's add form
 * (`entity.bb_environment.add_for_project`) fixes the project from its route
 * and hides the selector.
 */
final class BbEnvironmentForm extends BbContentEntityFormBase {

  /**
   * {@inheritdoc}
   */
  public function getEntityFromRouteMatch(RouteMatchInterface $route_match, $entity_type_id) {
    $entity = parent::getEntityFromRouteMatch($route_match, $entity_type_id);
    $project = $route_match->getParameter('bb_project');
    if ($entity->isNew() && $project instanceof BbProjectInterface) {
      assert($entity instanceof BbEnvironmentInterface);
      $entity->set('project_id', $project->id());
    }
    return $entity;
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    // Bound to the route's project: the selector cannot repoint it.
    if ($this->getRouteMatch()->getParameter('bb_project') instanceof BbProjectInterface && isset($form['project_id'])) {
      $form['project_id']['#access'] = FALSE;
    }
    return $form;
  }

}
