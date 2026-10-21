<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\Field\FieldWidget\PickerWidget;
use Drupal\bb_core\Plugin\Field\FieldWidget\PickerWidgetInterface;
use Drupal\bb_core\Reference\ReferenceOptions;
use Drupal\island\Form\WrappedDialogFormTrait;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Ticket template add/edit form.
 *
 * Templates are added from their project: the project-scoped add route
 * (`entity.bb_ticket_template.add_for_project`) carries a `bb_project`
 * parameter which this form uses to pre-fill and lock the template's project,
 * as `BbEnvironmentForm` does. A workspace template is added on
 * `entity.bb_ticket_template.add_for_workspace`, which fixes the route's
 * workspace instead and offers neither project nor conductor. Opened from the
 * `Add template` action it answers through the dialog wrapper format and lands
 * back on the list; otherwise saving returns to the matching Templates list.
 */
final class BbTicketTemplateForm extends BbContentEntityFormBase {

  use WrappedDialogFormTrait;
  use TargetStateRefreshTrait;

  /**
   * The add route on the workspace Templates tab.
   */
  private const WORKSPACE_ADD_ROUTE = 'entity.bb_ticket_template.add_for_workspace';

  /**
   * The project picker of the workspace add form: optional, this workspace's.
   *
   * Without a project the template is a workspace template; with one it is
   * that project's template.
   *
   * @var array<string, mixed>
   */
  private const PROJECT_PICKER = [
    'type' => 'bb_picker',
    'weight' => 7,
    'region' => 'content',
    'settings' => [
      'picker_region' => 'pills',
      'label' => 'Project',
      'icon' => 'folder',
      'searchable' => TRUE,
      'fallback' => TRUE,
      'clear_label' => 'No project: every project of the workspace',
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
   * Access-checked reference candidates, for the posted project.
   *
   * Protected, not private: the base class's DependencySerializationTrait
   * restores only properties it can see when the form comes from the cache.
   */
  protected ReferenceOptions $referenceOptions;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->referenceOptions = $container->get('bb_core.reference_options');
    return $form;
  }

  /**
   * Whether this is the add form of the workspace Templates tab.
   */
  private function onWorkspaceAdd(): bool {
    return $this->entity->isNew() && $this->getRouteMatch()->getRouteName() === self::WORKSPACE_ADD_ROUTE;
  }

  /**
   * {@inheritdoc}
   *
   * The workspace add form offers the project as an optional picker.
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
    assert($entity instanceof BbTicketTemplateInterface);
    $project = $route_match->getParameter('bb_project');
    if ($entity->isNew() && $project instanceof BbProjectInterface) {
      $entity->set('project_id', $project->id());
    }
    $workspace = $route_match->getParameter('bb_workspace');
    if ($entity->isNew() && $route_match->getRouteName() === 'entity.bb_ticket_template.add_for_workspace' && $workspace instanceof BbWorkspaceInterface) {
      $entity->set('workspace_id', $workspace->id());
    }
    return $entity;
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    // A new template holds the workflow its picker opens on, so the
    // target-state picker offers that workflow's states.
    $template = $this->entity;
    assert($template instanceof BbTicketTemplateInterface);
    $opening = $this->getFormDisplay($form_state)->getComponent('workflow')['settings']['default_value'] ?? '';
    if ($template->isNew() && $template->getWorkflow() === '' && $opening !== '') {
      $template->set('workflow', $opening);
    }
    $this->applyPostedProject($form_state);
    $form = parent::form($form, $form_state);
    // The route fixes the project; a saved template's project is immutable.
    if (isset($form['project_id']) && ($this->getRouteMatch()->getParameter('bb_project') instanceof BbProjectInterface || !$this->entity->isNew())) {
      $form['project_id']['#access'] = FALSE;
    }
    $this->hideProjectFieldsOfWorkspaceTemplate($form);
    $this->placeInPresenter($form, $form_state);
    if (!$this->isDialogRequest()) {
      // A boosted page submit is an htmx request, for which core drops the
      // redirect: the save would land nowhere and show no message.
      $form['#attributes']['data-hx-boost'] = 'false';
      // Opened by a boosted link, core's action keeps `ajax_page_state`; a
      // page re-rendered after an error would then arrive without assets.
      $form['#action'] = $this->cleanCurrentUrl()->toString();
      // The shell places no messages region, so the Settings tab's save
      // confirmation and errors lead the form, as other Settings screens do.
      $form['messages'] = ['#type' => 'status_messages', '#weight' => -1000, '#picker_region' => 'lines'];
    }
    $this->attachDialogHtmx($form);
    $this->attachTargetStateRefresh($form);
    $this->attachConductorRefresh($form);
    return $form;
  }

  /**
   * Applies a posted project before the conductor picker reads it.
   *
   * ContentEntityForm copies submitted values only when it validates, which a
   * project refresh (a non-button trigger) never does. Only a project the
   * picker offers is applied.
   */
  private function applyPostedProject(FormStateInterface $form_state): void {
    if (!$this->onWorkspaceAdd()) {
      return;
    }
    $template = $this->entity;
    assert($template instanceof BbTicketTemplateInterface);
    $posted = $form_state->getUserInput()['project_id'] ?? NULL;
    $offered = $this->referenceOptions->for($template, 'project_id', NULL, 50, (string) self::PROJECT_PICKER['settings']['selection_handler']);
    if (is_scalar($posted) && array_key_exists((string) $posted, $offered)) {
      $template->set('project_id', $posted);
    }
  }

  /**
   * Refreshes the conductor picker when the add form's project changes.
   *
   * @param array $form
   *   The form, mutated in place; ungenerified for `Htmx::applyTo()`.
   */
  private function attachConductorRefresh(array &$form): void {
    if (!$this->onWorkspaceAdd() || !isset($form['project_id'], $form['conductor_id'])) {
      return;
    }
    $form['conductor_id']['#attributes']['data-template-conductor'] = TRUE;
    $htmx = (new Htmx())
      ->post($this->isDialogRequest() ? $this->dialogPostUrl() : Url::fromUserInput($this->getRequest()->getPathInfo()))
      ->trigger('change')
      ->vals(['_triggering_element_name' => 'project_id'])
      ->select('[data-template-conductor]')
      ->target('[data-template-conductor]')
      ->swap('outerHTML');
    if (!$this->isDialogRequest()) {
      $htmx->onlyMainContent();
    }
    $htmx->applyTo($form['project_id']);
  }

  /**
   * {@inheritdoc}
   *
   * On the workspace add form a chosen project makes the template that
   * project's: the workspace is dropped, so exactly one scope stays set.
   */
  public function buildEntity(array $form, FormStateInterface $form_state) {
    $entity = parent::buildEntity($form, $form_state);
    assert($entity instanceof BbTicketTemplateInterface);
    if ($this->onWorkspaceAdd() && !$entity->get('project_id')->isEmpty()) {
      $entity->set('workspace_id', NULL);
    }
    return $entity;
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
   * Hides project and conductor on a saved workspace template.
   *
   * It has no project, so no conductor either: both are chosen when a ticket
   * is created from it. Its scope cannot change after the first save.
   *
   * @param array $form
   *   The form, mutated in place.
   */
  private function hideProjectFieldsOfWorkspaceTemplate(array &$form): void {
    $template = $this->entity;
    assert($template instanceof BbTicketTemplateInterface);
    if (!$template->isWorkspaceScoped() || $template->isNew()) {
      return;
    }
    foreach (['project_id', 'conductor_id'] as $name) {
      if (isset($form[$name])) {
        $form[$name]['#access'] = FALSE;
      }
    }
  }

  /**
   * Hands the widgets to the create dialog's presenter: one row of pills.
   *
   * Core's empty revision/author footer goes, as in BbCreateDialogFormBase.
   *
   * @param array $form
   *   The form, mutated in place; ungenerified, as the form arrays it is
   *   handed are.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  private function placeInPresenter(array &$form, FormStateInterface $form_state): void {
    $form['#theme'] = 'bb_create_dialog';
    unset($form['footer']);
    $display = $this->getFormDisplay($form_state);
    foreach (array_keys($display->getComponents()) as $name) {
      if (isset($form[$name])) {
        $widget = $display->getRenderer($name);
        $form[$name]['#picker_region'] = $widget instanceof PickerWidgetInterface ? $widget->pickerRegion() : 'lines';
        $form[$name]['#picker_label'] = $widget instanceof PickerWidgetInterface ? $widget->pickerLabel() : '';
      }
    }
  }

  /**
   * {@inheritdoc}
   *
   * Opened from the tab's action, the form offers Cancel back to the tab, as
   * the create dialogs do.
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
   * The collection is an unlinked admin route: a new template returns to its
   * project's Templates tab or its workspace's Templates page, a saved one
   * stays on its Settings tab.
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $settings = !$this->entity->isNew();
    $result = parent::save($form, $form_state);
    if ($this->isDialogRequest()) {
      $this->respondAtReturnUrl($form_state);
      return $result;
    }
    if ($this->getRequest()->query->has(static::RETURN_PARAMETER)) {
      // Back where the form was opened, without the htmx keys a boosted
      // screen leaves in its destination: core would redirect to the raw one.
      $this->respondAtReturnUrl($form_state);
      $this->getRequest()->query->remove(static::RETURN_PARAMETER);
      return $result;
    }
    if ($settings) {
      // The Settings tab stays where it is, as other Settings screens do.
      $form_state->setRedirectUrl($this->cleanCurrentUrl());
      return $result;
    }
    $entity = $this->getEntity();
    assert($entity instanceof BbTicketTemplateInterface);
    $project = $entity->get('project_id')->entity;
    $workspace = $entity->get('workspace_id')->entity;
    if ($project instanceof BbProjectInterface) {
      $form_state->setRedirectUrl(Url::fromRoute('view.bb_ticket_templates.project_list', $project->toUrl()->getRouteParameters()));
    }
    elseif ($workspace instanceof BbWorkspaceInterface) {
      $form_state->setRedirectUrl(Url::fromRoute('view.bb_ticket_templates.workspace_list', ['bb_workspace' => $workspace->getSlug()]));
    }
    return $result;
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
