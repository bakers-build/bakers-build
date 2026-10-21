<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\bb_core\Access\BbActiveWorkspaceInterface;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Fills and hides the workspace field.
 *
 * On an add form the picker is replaced by a read-only "Workspace: <name>"
 * line; a bypassed account keeps the picker. The resolver answers only on add
 * routes, so edit forms keep the picker and moving a row stays possible,
 * gated by BbWorkspaceScope. Dependent references are narrowed in
 * `bb_core_field_widget_single_element_form_alter()`, not here.
 */
trait AmbientWorkspaceFormTrait {

  /**
   * The active-workspace resolver.
   *
   * @var \Drupal\bb_core\Access\BbActiveWorkspaceInterface
   */
  protected BbActiveWorkspaceInterface $ambientWorkspaceResolver;

  /**
   * The membership oracle, asked for the bypass and for the error wording.
   *
   * @var \Drupal\bb_core\Access\BbWorkspaceReadScopeInterface
   */
  protected BbWorkspaceReadScopeInterface $ambientWorkspaceReadScope;

  /**
   * The workspace field this form fills and hides.
   *
   * @return string
   *   The field name, `workspace_id` for both current users.
   */
  abstract protected function ambientWorkspaceField(): string;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $instance = parent::create($container);
    $instance->ambientWorkspaceResolver = $container->get('bb_core.active_workspace');
    $instance->ambientWorkspaceReadScope = $container->get('bb_core.workspace_read_scope');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getEntityFromRouteMatch(RouteMatchInterface $route_match, $entity_type_id) {
    $entity = parent::getEntityFromRouteMatch($route_match, $entity_type_id);
    $workspace = $this->ambientWorkspaceResolver->resolve();
    if ($entity instanceof FieldableEntityInterface
      && $entity->isNew()
      && $workspace !== NULL) {
      $entity->set($this->ambientWorkspaceField(), $workspace->id());
    }
    return $entity;
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    return $this->applyAmbientWorkspace($form);
  }

  /**
   * Hides the workspace picker and states the workspace instead.
   *
   * @param array<string, mixed> $form
   *   The built form.
   *
   * @return array<string, mixed>
   *   The form.
   */
  protected function applyAmbientWorkspace(array $form): array {
    $account = $this->currentUser();
    $entity_type_id = $this->getEntity()->getEntityTypeId();
    if ($this->ambientWorkspaceReadScope->isBypassed($account, $entity_type_id)) {
      // The escape hatch keeps the picker, and the fill from the route stands:
      // that account opened that route on purpose.
      return $form;
    }
    $workspace = $this->ambientWorkspaceResolver->resolve();
    if ($workspace === NULL) {
      // Not an add-form route, so there is no context to bind: the form is left
      // exactly as built and the picker stays visible. That covers the edit
      // form (where the picker is wanted) and any off-route render (where
      // hiding a field the account would then have no way to fill helps
      // nobody). Not a hole either way — BbWorkspaceScope is the gate on the
      // write, and every add route carries a workspace, so no ADD form reaches
      // this branch.
      return $form;
    }
    $field = $this->ambientWorkspaceField();
    $weight = 0;
    if (isset($form[$field])) {
      $weight = $form[$field]['#weight'] ?? 0;
      $form[$field]['#access'] = FALSE;
    }
    $form['ambient_workspace'] = [
      '#type' => 'item',
      '#markup' => $this->t('Workspace: @name', [
        '@name' => $workspace->label(),
      ]),
      '#weight' => $weight,
    ];
    return $form;
  }

}
