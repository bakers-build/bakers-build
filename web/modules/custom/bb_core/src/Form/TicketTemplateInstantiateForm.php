<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\Display\EntityFormDisplayInterface;
use Drupal\Core\Entity\Entity\EntityFormDisplay;
use Drupal\Core\Field\WidgetInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\Plugin\Field\FieldWidget\PickerWidgetInterface;
use Drupal\bb_core\TicketTemplate\TemplateNotFoundException;
use Drupal\bb_core\TicketTemplate\TicketTemplateAccessDeniedException;
use Drupal\bb_core\TicketTemplate\TicketTemplateInstantiator;
use Drupal\bb_core\TicketTemplate\TicketTemplateValidationException;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The create-ticket dialog of a template, prefilled with its defaults.
 *
 * The ticket create dialog on an entity prefilled from the template. A
 * project template binds its project, so the conductor is offered; a
 * workspace template binds none, so the reader picks the project and the
 * conductor is left for later. The edited values reach the ticket as
 * overrides of the template defaults, through the instantiator. The target
 * state is the template's own picker, offering the chosen workflow's targets,
 * so a changed workflow never leaves an unreachable preset. Opened as a
 * dialog with JavaScript and as a plain page without it; either way it
 * finishes on the ticket.
 */
class TicketTemplateInstantiateForm extends BbTicketCreateForm {

  use TargetStateRefreshTrait;

  /**
   * The template being instantiated.
   *
   * Protected, not private: the base class's DependencySerializationTrait
   * restores only properties it can see when the form comes from the cache.
   */
  protected ?BbTicketTemplateInterface $template = NULL;

  /**
   * The instantiator; protected for the same reason as $template.
   */
  protected TicketTemplateInstantiator $instantiator;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->instantiator = $container->get('bb_core.ticket_template_instantiator');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_ticket_template_instantiate_form';
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?BbTicketTemplateInterface $bb_ticket_template = NULL): array {
    $this->template ??= $bb_ticket_template;
    return parent::buildForm($form, $form_state);
  }

  /**
   * Prefills the ticket from the template, once per form.
   *
   * A rebuild after a rejected submission keeps the edited entity.
   */
  protected function init(FormStateInterface $form_state): void {
    if ($this->template instanceof BbTicketTemplateInterface) {
      $this->setEntity($this->instantiator->prefill($this->template));
      $form_state->set('project_bound', !$this->template->isWorkspaceScoped());
    }
    parent::init($form_state);
  }

  /**
   * Leaves out parent and blockers: they are no template fields.
   */
  protected function alterFormDisplay(EntityFormDisplayInterface $display, FormStateInterface $form_state): void {
    parent::alterFormDisplay($display, $form_state);
    $display->removeComponent('parent_id');
    $display->removeComponent('blocked_by');
  }

  /**
   * Adds the template's target-state picker beside the workflow.
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    if (!$this->template instanceof BbTicketTemplateInterface || !isset($form['workflow'])) {
      return $form;
    }
    $target = $this->targetState($form_state);
    $widget = $this->targetStateWidget($target);
    $form['target_state'] = $widget->form($target->get('target_state'), $form, $form_state);
    $form['target_state']['#weight'] = ($form['workflow']['#weight'] ?? 0) + 0.5;
    $form['target_state']['#picker_region'] = $widget instanceof PickerWidgetInterface ? $widget->pickerRegion() : 'lines';
    $form['target_state']['#picker_label'] = $widget instanceof PickerWidgetInterface ? $widget->pickerLabel() : '';
    $this->attachTargetStateRefresh($form);
    return $form;
  }

  /**
   * The template, unsaved, on the workflow in the dialog.
   *
   * Its target state is the template's preset while that workflow reaches it,
   * otherwise none; the picker reads its options from this workflow.
   */
  private function targetState(FormStateInterface $form_state): BbTicketTemplateInterface {
    assert($this->template instanceof BbTicketTemplateInterface);
    $posted = $form_state->getUserInput()['workflow'] ?? NULL;
    $posted = is_array($posted) ? reset($posted) : $posted;
    $workflow = is_string($posted) && array_key_exists($posted, TypeWorkflows::ticketWorkflowOptions())
      ? $posted
      : (string) $this->entity->get('workflow')->value;
    $target = clone $this->template;
    $target->set('workflow', $workflow);
    if (!array_key_exists($target->getTargetState(), TypeWorkflows::templateTargetStateOptions($workflow))) {
      $target->set('target_state', NULL);
    }
    return $target;
  }

  /**
   * The target-state widget of the template's own form display.
   */
  private function targetStateWidget(BbTicketTemplateInterface $target): WidgetInterface {
    $widget = EntityFormDisplay::collectRenderDisplay($target, 'default')->getRenderer('target_state');
    assert($widget instanceof WidgetInterface);
    return $widget;
  }

  /**
   * {@inheritdoc}
   *
   * The dialog finishes on the new ticket, not where it was opened.
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    $actions['submit']['#submit'] = array_values(array_diff($actions['submit']['#submit'], ['::landAtReturnUrl']));
    return $actions;
  }

  /**
   * Creates the ticket through the template, with the edited values.
   *
   * A rejected instantiation shows the dialog again with the values as
   * edited.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $ticket = $this->entity;
    $overrides = [];
    foreach (array_keys($this->getFormDisplay($form_state)->getComponents()) as $field) {
      $overrides[$field] = match ($field) {
        'labels' => array_column($ticket->get('labels')->getValue(), 'target_id'),
        'project_id', 'conductor_id' => $ticket->get($field)->target_id,
        default => (string) $ticket->get($field)->value,
      };
    }
    if (isset($form['target_state'])) {
      $target = $this->targetState($form_state);
      $this->targetStateWidget($target)->extractFormValues($target->get('target_state'), $form, $form_state);
      $overrides['target_state'] = $target->getTargetState();
    }
    $overrides = array_intersect_key($overrides, array_flip(TicketTemplateInstantiator::OVERRIDABLE));

    try {
      $result = $this->instantiator->instantiate((string) $this->template?->uuid(), $this->currentUser(), $overrides);
    }
    catch (TemplateNotFoundException | TicketTemplateAccessDeniedException) {
      $this->messenger()->addError($this->t('This template cannot be used to create a ticket.'));
      $form_state->setRebuild();
      return 0;
    }
    catch (TicketTemplateValidationException $e) {
      $this->messenger()->addError($e->getMessage());
      $form_state->setRebuild();
      return 0;
    }

    $created = $this->entityRepository->loadEntityByUuid('bb_ticket', $result['ticket_uuid']);
    if ($created !== NULL) {
      // A `destination` from the opening link would win over this redirect.
      $this->getRequest()->query->remove('destination');
      TicketNavigation::finishAt($created->toUrl(), $form_state, $this->getRequest());
    }
    return SAVED_NEW;
  }

}
