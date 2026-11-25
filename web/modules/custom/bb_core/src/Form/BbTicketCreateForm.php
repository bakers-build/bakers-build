<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityInterface;
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
   * Its `project_id` picker names PROJECT_HANDLER.
   */
  private const FORM_MODE = 'create';

  /**
   * The selection handler of the Project picker: creatable projects only.
   */
  private const PROJECT_HANDLER = 'bb_project_ticket_creatable';

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
   * Preselects the project before Drupal builds dependent widgets.
   *
   * The dialog's own `?project=` is preselected when the reader may create
   * there, else nothing. Without one: the only creatable project; else the
   * creatable project of the reader's newest own ticket; else none, and the
   * required picker asks.
   */
  protected function init(FormStateInterface $form_state): void {
    parent::init($form_state);
    if (!$this->entity->get('project_id')->isEmpty()) {
      return;
    }
    $candidates = array_map('strval', array_keys($this->projectCandidates()));
    $project = $this->getRequest()->query->get('project');
    // A named project the reader may not create in preselects nothing rather
    // than silently another project.
    $project = is_scalar($project)
      ? (in_array((string) $project, $candidates, TRUE) ? (string) $project : NULL)
      : $this->defaultProject($candidates);
    if ($project !== NULL) {
      $this->entity->set('project_id', $project);
    }
  }

  /**
   * The project a dialog without `?project=` starts with.
   *
   * @param list<string> $candidates
   *   The creatable project ids.
   */
  private function defaultProject(array $candidates): ?string {
    if (count($candidates) <= 1) {
      return $candidates[0] ?? NULL;
    }
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    // Unchecked: owner and candidates already bound the result to the reader.
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('owner_user_id', $this->currentUser()->id())
      ->condition('project_id', $candidates, 'IN')
      ->sort('created', 'DESC')
      ->sort('id', 'DESC')
      ->range(0, 1)
      ->execute();
    $ticket = $ids === [] ? NULL : $storage->load(reset($ids));
    return $ticket instanceof ContentEntityInterface ? (string) $ticket->get('project_id')->target_id : NULL;
  }

  /**
   * The projects the reader may create tickets in, as the picker offers them.
   *
   * @return array<int|string, string>
   *   Labels keyed by project id.
   */
  private function projectCandidates(): array {
    return $this->referenceOptions->for($this->entity, 'project_id', NULL, 0, self::PROJECT_HANDLER);
  }

  /**
   * Applies the posted project, then wires the dependent pickers' refresh.
   *
   * ContentEntityForm copies submitted values onto the entity only when it
   * validates, which a project refresh (a non-button trigger) never does.
   * Parent, Blocked by and Conductor read their candidates from the entity,
   * so the posted project is applied here, and only when the reader may
   * create there.
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $posted = $form_state->getUserInput()['project_id'] ?? NULL;
    if (is_scalar($posted) && array_key_exists((string) $posted, $this->projectCandidates())) {
      $this->entity->set('project_id', $posted);
    }
    $form = parent::form($form, $form_state);
    $this->attachRelationRefresh($form);
    return $form;
  }

  /**
   * Refreshes the project-dependent pickers when the project changes.
   *
   * The pickers read their candidates from the submitted project and drop a
   * value the new project does not offer. Without JavaScript nothing
   * refreshes; validation rejects the stale value instead.
   *
   * @param array $form
   *   The form, mutated in place; ungenerified for `Htmx::applyTo()`.
   */
  private function attachRelationRefresh(array &$form): void {
    if (!isset($form['project_id'], $form['parent_id'], $form['blocked_by'])) {
      return;
    }
    foreach (['parent_id', 'blocked_by'] as $name) {
      $form[$name]['#attributes']['data-ticket-project-scoped'] = $name;
    }
    // `hx-select-oob` takes element ids only, so the out-of-band pickers get
    // fixed ones.
    $oob = ['#bakers-ticket-create-blocked-by'];
    $form['blocked_by']['#id'] = 'bakers-ticket-create-blocked-by';
    if (isset($form['conductor_id'])) {
      $form['conductor_id']['#id'] = 'bakers-ticket-create-conductor';
      $oob[] = '#bakers-ticket-create-conductor';
    }
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
      ->selectOob($oob);
    if (!$this->isDialogRequest()) {
      $htmx->onlyMainContent();
    }
    $htmx->applyTo($form['project_id']);
  }

  /**
   * Rejects relations outside the new ticket's project or the reader's view.
   *
   * Checked against the entity's effective project. The error never names the
   * rejected ticket: its label may be private.
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
