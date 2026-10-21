<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;
use Drupal\bb_core\Access\BbWorkspaceCreateAccess;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\island\IslandResponse;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * The shared create-dialog subject for workspace groups and teams.
 */
final class BbGroupTeamCreateForm extends BbCreateDialogFormBase {

  /**
   * The scoped creation gate shared with the routes.
   */
  protected BbWorkspaceCreateAccess $workspaceCreateAccess;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->routeMatch = $container->get('current_route_match');
    $form->workspaceCreateAccess = $container->get('bb_core.workspace_create_access');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $workspace = $this->getRouteMatch()->getParameter('bb_workspace');
    if (!$workspace instanceof BbWorkspaceInterface) {
      throw new AccessDeniedHttpException('Workspace context is required.');
    }
    $this->entity->set('workspace_id', $workspace->id());
    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   *
   * `bb_group` and `bb_team` diverge here: `bb_team` creates through
   * its `settings` form mode, shared with the team Settings screen;
   * `bb_group` keeps its own `create` display. Both
   * subjects share this one class, and the routed operation is `create` for
   * both (`entity.bb_group.create_form` / `entity.bb_team.create_form`),
   * so the divergence has to be resolved by entity type rather than by the
   * operation string — see `BbCreateDialogFormBase::formDisplayMode()`.
   */
  protected function formDisplayMode(): string {
    return $this->entity->getEntityTypeId() === 'bb_team' ? 'settings' : 'create';
  }

  /**
   * {@inheritdoc}
   */
  protected function createAccess(): AccessResultInterface {
    return $this->workspaceCreateAccess->check($this->entity->getEntityTypeId(), $this->getRouteMatch()->getParameter('bb_workspace'), $this->currentUser());
  }

  /**
   * {@inheritdoc}
   */
  protected function copyFormValuesToEntity(EntityInterface $entity, array $form, FormStateInterface $form_state): void {
    parent::copyFormValuesToEntity($entity, $form, $form_state);
    assert($entity instanceof ContentEntityInterface);
    $workspace = $this->getRouteMatch()->getParameter('bb_workspace');
    if (!$workspace instanceof BbWorkspaceInterface) {
      throw new AccessDeniedHttpException('Workspace context is required.');
    }
    $entity->set('workspace_id', $workspace->id());
    $entity->set('owner_user_id', $this->currentUser()->id());
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): ContentEntityInterface {
    $this->assertCreateAccess();
    $entity = parent::validateForm($form, $form_state);
    // Core filters violations of unedited fields. The hidden workspace must
    // still satisfy its scope constraint, independently of widget access.
    foreach ($entity->get('workspace_id')->validate() as $violation) {
      $form_state->setErrorByName('', $violation->getMessage());
    }
    return $entity;
  }

  /**
   * Keeps direct saves behind the same workspace access check.
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $this->assertCreateAccess();
    return parent::save($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    if (isset($form['name']['widget'][0]['value'])) {
      $widget = &$form['name']['widget'][0]['value'];
      $widget['#title'] = $this->t('Name');
      $widget['#required_error'] = $this->t('Enter a name.');
    }
    return $form;
  }

  /**
   * Keeps the sanitized destination within the trusted workspace.
   */
  protected function returnUrl(): Url {
    $workspace = $this->getRouteMatch()->getParameter('bb_workspace');
    assert($workspace instanceof BbWorkspaceInterface);
    $return = parent::returnUrl();
    $path = parse_url($return->toString(), PHP_URL_PATH);
    if (is_string($path) && str_starts_with($path, '/' . $workspace->getSlug() . '/')) {
      return $return;
    }
    $fallback = $this->entity->getEntityTypeId() === 'bb_group'
      ? 'view.groups.workspace_list'
      : 'view.projects.workspace_list';
    return Url::fromRoute($fallback, ['bb_workspace' => $workspace->getSlug()]);
  }

  /**
   * {@inheritdoc}
   */
  protected function dialogResponse(): ?IslandResponse {
    return $this->entity->getEntityTypeId() === 'bb_team'
      ? IslandResponse::make()->dispatch('bakers.team.created') : NULL;
  }

  /**
   * {@inheritdoc}
   */
  protected function actionLabels(): array {
    return [
      'submit' => $this->entity->getEntityTypeId() === 'bb_group'
        ? $this->t('Create group') : $this->t('Create team'),
      'cancel' => $this->t('Cancel'),
    ];
  }

}
