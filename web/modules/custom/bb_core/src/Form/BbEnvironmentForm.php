<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbEnvironmentInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Plugin\Field\FieldWidget\PickerWidget;
use Drupal\island\Form\WrappedDialogFormTrait;

/**
 * Environment entity form with a meta header block.
 *
 * The project-scoped add route (`entity.bb_environment.add_for_project`)
 * carries a `bb_project` parameter which this form uses to pre-fill and lock
 * the environment's project. The Catalog add route
 * (`entity.bb_environment.add_for_workspace`) offers the projects of the
 * route's workspace instead and refuses any other.
 */
final class BbEnvironmentForm extends BbContentEntityFormBase {

  use WrappedDialogFormTrait;

  /**
   * The add route on the Catalog Environments tab.
   */
  private const WORKSPACE_ADD_ROUTE = 'entity.bb_environment.add_for_workspace';

  /**
   * The project picker of the workspace add form: this workspace's projects.
   *
   * @var array<string, mixed>
   */
  private const PROJECT_PICKER = [
    'type' => 'bb_picker',
    'weight' => 1,
    'region' => 'content',
    'settings' => [
      'picker_region' => 'pills',
      'label' => 'Project',
      'icon' => 'folder',
      'searchable' => TRUE,
      'fallback' => TRUE,
      'clear_label' => '',
      'create_label' => '',
      'context_parameter' => '',
      'default_value' => '',
      'note_lead' => '',
      'note_prefix' => '',
      'note_suffix' => '',
      'selection_handler' => 'bb_project_in_active_workspace',
    ],
  ];

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
   * Whether this is the add form of the Catalog Environments tab.
   */
  private function onWorkspaceAdd(): bool {
    return $this->entity->isNew() && $this->getRouteMatch()->getRouteName() === self::WORKSPACE_ADD_ROUTE;
  }

  /**
   * {@inheritdoc}
   *
   * The workspace add form offers the project as a picker of its projects.
   */
  protected function init(FormStateInterface $form_state): void {
    parent::init($form_state);
    if ($this->onWorkspaceAdd()) {
      $this->getFormDisplay($form_state)->setComponent('project_id', self::PROJECT_PICKER);
    }
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
    if (!$this->isDialogRequest()) {
      // A boosted page submit is an htmx request, for which core drops the
      // redirect: the save would land nowhere and show no message.
      $form['#attributes']['data-hx-boost'] = 'false';
      // Opened by a boosted link, core's action keeps `ajax_page_state`; a
      // page re-rendered after an error would then arrive without assets.
      $form['#action'] = HtmxTransport::currentUrl($this->getRequest())->toString();
      $form['messages'] = ['#type' => 'status_messages', '#weight' => -1000];
    }
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * Opened over a screen, Cancel returns there without saving.
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    if ($this->getRequest()->query->has(static::RETURN_PARAMETER)) {
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
    return $actions;
  }

  /**
   * {@inheritdoc}
   *
   * The project must be one the workspace add form offers: this workspace's.
   */
  public function validateForm(array &$form, FormStateInterface $form_state): ContentEntityInterface {
    $entity = parent::validateForm($form, $form_state);
    if ($this->onWorkspaceAdd()) {
      $widget = $this->getFormDisplay($form_state)->getRenderer('project_id');
      if ($widget instanceof PickerWidget && $widget->rejectedValues($entity->get('project_id')) !== []) {
        $form_state->setErrorByName('project_id', $this->t('Pick a project of this workspace.'));
      }
    }
    return $entity;
  }

  /**
   * {@inheritdoc}
   *
   * The parent redirects to the entity collection, which this entity has no
   * link for. A dialog returns to the screen it was opened over, the Catalog
   * add page to its tab, any other save to the owning project.
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $entity = $this->getEntity();
    assert($entity instanceof BbEnvironmentInterface);
    $from_catalog = $this->onWorkspaceAdd();
    $result = $entity->save();

    $this->messenger()->addStatus($this->t('@type %label saved.', [
      '@type' => $entity->getEntityType()->getLabel(),
      '%label' => $entity->label() ?? $entity->id(),
    ]));
    $project = $entity->getProject();
    if ($this->isDialogRequest()) {
      $this->respondAtReturnUrl($form_state);
    }
    elseif ($from_catalog) {
      $form_state->setRedirectUrl(Url::fromRoute('view.bb_environments.catalog'));
    }
    elseif ($project instanceof BbProjectInterface) {
      $form_state->setRedirectUrl($project->toUrl());
    }

    return $result;
  }

}
