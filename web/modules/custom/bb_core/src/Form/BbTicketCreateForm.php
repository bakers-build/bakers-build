<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\Display\EntityFormDisplayInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Url;
use Drupal\bb_core\Reference\ReferenceOptions;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Ticket defaults for the shared create dialog.
 */
class BbTicketCreateForm extends BbCreateDialogFormBase {

  use ProjectScopedRelationsTrait;

  /**
   * The form mode whose display owns the configured fields and widgets.
   *
   * {@see alterFormDisplay()} adjusts it when no project is bound.
   */
  private const FORM_MODE = 'create';

  /**
   * Access-checked project and relation candidates.
   *
   * Protected, not private: the base class's DependencySerializationTrait
   * restores only properties it can see when the form comes from the cache.
   */
  protected ReferenceOptions $referenceOptions;

  /**
   * Stable form ID used by the dialog trigger and Drupal's HTMX form handling.
   */
  public const string FORM_ID = 'bb_ticket_create_form';

  /**
   * Initializes the subject for both routed and direct form construction.
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->prepareSubject($container, 'bb_ticket', self::FORM_MODE);
    $form->referenceOptions = $container->get('bb_core.reference_options');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return self::FORM_ID;
  }

  /**
   * Binds the opening project before Drupal builds dependent widgets.
   *
   * Only the dialog's own `?project=` query binds, and only when it is among
   * the reader's access-checked choices. A posted `project_id` never binds:
   * the project-scoped conductor widget computes its candidates from the
   * entity before submitted input is applied, so binding must come from the
   * request that opened the dialog. Whether the dialog is bound is recorded
   * once per request, so a rebuild after a validation error keeps the picker
   * a project-less dialog opened with.
   */
  protected function init(FormStateInterface $form_state): void {
    parent::init($form_state);
    $project = $this->getRequest()->query->get('project');
    $bound = is_scalar($project)
      && array_key_exists((string) $project, $this->referenceOptions->for($this->entity, 'project_id'));
    if ($bound && $this->entity->get('project_id')->isEmpty()) {
      $this->entity->set('project_id', $project);
    }
    if ($form_state->get('project_bound') === NULL) {
      $form_state->set('project_bound', $bound);
    }
  }

  /**
   * Swaps the conductor for a project picker when no project is bound.
   *
   * A screen without project context (a global ticket list, `my_work`, a
   * team's ticket list) lets the reader choose the project. Conductor
   * candidates depend on the project, so that dialog creates the ticket
   * unassigned; the conductor is assigned afterwards on the ticket.
   */
  protected function alterFormDisplay(EntityFormDisplayInterface $display, FormStateInterface $form_state): void {
    if ($form_state->get('project_bound')) {
      return;
    }
    $display->removeComponent('conductor_id');
    // `pills`, not `lead`: grammar 3a allows at most one emphasised
    // property per surface, and `workflow` already holds that slot.
    $display->setComponent('project_id', [
      'type' => 'bb_picker',
      'weight' => 0,
      'region' => 'content',
      'settings' => [
        'picker_region' => 'pills',
        'label' => 'Project',
        'icon' => 'folder',
        'searchable' => TRUE,
        'clear_label' => '',
        'create_label' => '',
        'context_parameter' => '',
        'default_value' => '',
        'note_lead' => '',
        'note_prefix' => '',
        'note_suffix' => '',
      ],
    ]);
  }

  /**
   * Scopes the unbound dialog's relation pickers to the posted project.
   *
   * Also wires their refresh on a project change.
   *
   * ContentEntityForm copies submitted values onto the entity only when it
   * validates, which a project refresh (a non-button trigger) never does.
   * The relation pickers read their candidates from the entity, so the
   * posted project is applied here, and only when the reader may choose it.
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $posted = $form_state->getUserInput()['project_id'] ?? NULL;
    if (!$form_state->get('project_bound') && is_scalar($posted)
      && array_key_exists((string) $posted, $this->referenceOptions->for($this->entity, 'project_id'))) {
      $this->entity->set('project_id', $posted);
    }
    $form = parent::form($form, $form_state);
    $this->attachRelationRefresh($form, $form_state);
    return $form;
  }

  /**
   * Refreshes the relation pickers when the unbound dialog's project changes.
   *
   * The pickers read their candidates from the submitted project and drop a
   * value the new project does not offer. Without JavaScript nothing
   * refreshes; validateForm() rejects the stale value instead.
   *
   * @param array $form
   *   The form, mutated in place; ungenerified for `Htmx::applyTo()`.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  private function attachRelationRefresh(array &$form, FormStateInterface $form_state): void {
    if ($form_state->get('project_bound') || !isset($form['project_id'], $form['parent_id'], $form['blocked_by'])) {
      return;
    }
    foreach (['parent_id', 'blocked_by'] as $name) {
      $form[$name]['#attributes']['data-ticket-project-scoped'] = $name;
    }
    // `hx-select-oob` takes element ids only, so Blocked by gets a fixed one.
    $form['blocked_by']['#id'] = 'bakers-ticket-create-blocked-by';
    // As in BbTicketTemplateForm: the picker root fires `change` and has no
    // name, so the trigger name is posted; a non-button trigger runs no
    // submit handlers and reports no errors.
    $htmx = (new Htmx())
      ->post($this->isDialogRequest() ? $this->dialogPostUrl() : Url::fromUserInput($this->getRequest()->getPathInfo()))
      ->trigger('change')
      ->vals(['_triggering_element_name' => 'project_id'])
      ->select('[data-ticket-project-scoped="parent_id"]')
      ->target('[data-ticket-project-scoped="parent_id"]')
      ->swap('outerHTML')
      ->selectOob('#bakers-ticket-create-blocked-by');
    if (!$this->isDialogRequest()) {
      $htmx->onlyMainContent();
    }
    $htmx->applyTo($form['project_id']);
  }

  /**
   * Rejects relations outside the new ticket's project or the reader's view.
   *
   * Checked against the entity's effective project, so a bound dialog ignores
   * a posted one. The error never names the rejected ticket: its label may be
   * private.
   */
  public function validateForm(array &$form, FormStateInterface $form_state): ContentEntityInterface {
    $entity = parent::validateForm($form, $form_state);
    $this->rejectProjectScopedRelations($this->getFormDisplay($form_state), $entity, $form_state);
    return $entity;
  }

  /**
   * Re-applies dependent defaults after widgets have supplied their values.
   */
  protected function copyFormValuesToEntity(EntityInterface $entity, array $form, FormStateInterface $form_state): void {
    parent::copyFormValuesToEntity($entity, $form, $form_state);
    assert($entity instanceof ContentEntityInterface);
    $entity->get('state')->applyDefaultValue();
  }

  /**
   * {@inheritdoc}
   */
  protected function actionLabels(): array {
    return [
      'submit' => $this->t('Create ticket'),
      'cancel' => $this->t('Cancel'),
    ];
  }

}
