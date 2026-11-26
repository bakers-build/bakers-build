<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\bb_core\Entity\BbEnvironmentInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Plugin\Field\FieldWidget\PickerWidget;

/**
 * The environment form: the plain entity form and two route rules.
 *
 * Its fields come from the form display; the `add` form mode offers the
 * project as a picker of the active workspace's projects. Kept as a class for
 * what a form display cannot express: the Catalog add
 * (`entity.bb_environment.add_for_workspace`) refuses a project outside the
 * workspace, and the project-page add (`entity.bb_environment.add_for_project`)
 * fixes the project from its route and hides the selector.
 */
final class BbEnvironmentForm extends BbContentEntityFormBase {

  /**
   * The add route on the Catalog Environments tab.
   */
  private const WORKSPACE_ADD_ROUTE = 'entity.bb_environment.add_for_workspace';

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

  /**
   * {@inheritdoc}
   *
   * The project must be one the Catalog add form offers: this workspace's.
   */
  public function validateForm(array &$form, FormStateInterface $form_state): ContentEntityInterface {
    $entity = parent::validateForm($form, $form_state);
    if ($entity->isNew() && $this->getRouteMatch()->getRouteName() === self::WORKSPACE_ADD_ROUTE) {
      $widget = $this->getFormDisplay($form_state)->getRenderer('project_id');
      // Fails closed: only the `add` form display's picker knows the workspace.
      if (!$widget instanceof PickerWidget || $widget->rejectedValues($entity->get('project_id')) !== []) {
        $form_state->setErrorByName('project_id', $this->t('Pick a project of this workspace.'));
      }
    }
    return $entity;
  }

}
