<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbEnvironmentInterface;
use Drupal\bb_core\Entity\BbProjectInterface;

/**
 * Environment entity form with a meta header block.
 *
 * Environments are added only from within their project: the project-scoped
 * add route (`entity.bb_environment.add_for_project`) carries a
 * `bb_project` parameter which this form uses to pre-fill and lock the
 * environment's project.
 */
final class BbEnvironmentForm extends BbContentEntityFormBase {

  /**
   * {@inheritdoc}
   */
  protected static function metaGroups(): array {
    return [
      'meta' => [
        'label' => new TranslatableMarkup('Meta'),
        'open' => TRUE,
        'weight' => 0,
        'fields' => ['project_id', 'base_url', 'tier', 'created', 'changed'],
      ],
    ];
  }

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
    // When the project is fixed by the route (add-from-project), the
    // environment is bound to that project — hide the selector so it
    // cannot be repointed.
    if ($this->getRouteMatch()->getParameter('bb_project') instanceof BbProjectInterface
      && isset($form['project_id'])) {
      $form['project_id']['#access'] = FALSE;
    }
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * The parent redirects to the entity collection, which this entity has no
   * link for. Redirect to the owning project instead.
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $entity = $this->getEntity();
    assert($entity instanceof BbEnvironmentInterface);
    $result = $entity->save();

    $this->messenger()->addStatus($this->t('@type %label saved.', [
      '@type' => $entity->getEntityType()->getLabel(),
      '%label' => $entity->label() ?? $entity->id(),
    ]));
    $project = $entity->getProject();
    if ($project instanceof BbProjectInterface) {
      $form_state->setRedirectUrl($project->toUrl());
    }

    return $result;
  }

}
