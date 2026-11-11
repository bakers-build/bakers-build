<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Component\Render\PlainTextOutput;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Plugin\Field\FieldWidget\PickerWidgetInterface;
use Drupal\bb_core\Ticket\TicketInspectorRows;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Saves the configured ticket property widgets without overwriting edits.
 */
final class BbTicketPropertyForm extends BbPropertyFormBase {

  use ProjectScopedRelationsTrait;

  /**
   * The current ticket.
   *
   * @var \Drupal\bb_core\Entity\BbTicketInterface
   */
  protected $entity;

  /**
   * Formats properties that the visitor cannot edit.
   */
  protected TicketInspectorRows $inspectorRows;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->inspectorRows = $container->get('bb_core.ticket_inspector_rows');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    if (isset($form['property_baseline'])) {
      $form['#after_build'][] = '::prepareSurface';
    }
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * Saving yourself in or out of Reviewers reloads the ticket: the Reviews
   * block beside this form offers Write a review by that membership, and the
   * Save swaps only this form.
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $baseline = $form_state->get('property_baseline');
    $result = parent::save($form, $form_state);
    if ($baseline instanceof BbTicketInterface && $this->isReviewer($baseline) !== $this->isReviewer($this->entity)) {
      TicketNavigation::finishAt($this->entity->toUrl(), $form_state, $this->getRequest());
    }
    return $result;
  }

  /**
   * Whether the visitor is one of the ticket's reviewers.
   */
  private function isReviewer(BbTicketInterface $ticket): bool {
    return in_array((string) $this->currentUser()->id(), array_column($ticket->get('reviewers')->getValue(), 'target_id'), FALSE);
  }

  /**
   * {@inheritdoc}
   */
  protected function autosaves(): bool {
    return TRUE;
  }

  /**
   * {@inheritdoc}
   */
  protected function readOnly(): array {
    return $this->inspectorRows->propertiesBlock($this->inspectorRows->build($this->entity));
  }

  /**
   * Lays the configured widgets out as the Properties block's labelled rows.
   *
   * An editable picker is its row's value cell; fields the visitor may not
   * edit render as read-only rows. A picker says "Saved" after its field was
   * just written, or the error that refused it.
   */
  public function prepareSurface(array $element, FormStateInterface $form_state, ?BbTicketInterface $entity = NULL): array {
    $entity ??= $this->buildEntity($element, $form_state);
    $display = $this->getFormDisplay($form_state);
    $rows = $this->inspectorRows->build($entity);
    $statuses = $this->fieldStatuses($form_state);
    foreach (array_keys($display->getComponents()) as $field) {
      $widget = $display->getRenderer($field);
      if (!isset($element[$field]) || !$widget instanceof PickerWidgetInterface || !isset($rows[$field])) {
        continue;
      }
      if (!$entity->get($field)->access('edit') || !$entity->get($field)->access('view')) {
        $element[$field]['#printed'] = TRUE;
        continue;
      }
      $props = $widget->pickerElement($entity->get($field))['#props'];
      $rows[$field]['cells']['value'] = [
        'kind' => 'picker',
        'name' => $field,
        'picker_id' => $element[$field]['widget']['#id'] ?? 'property-' . $field,
        'label' => $props['label'],
        'icon' => $props['icon'] ?? '',
        'multiple' => $entity->get($field)->getFieldDefinition()->getFieldStorageDefinition()->isMultiple(),
        'value_labels' => $props['value_labels'] ?? (isset($props['value_label']) && $props['value_label'] !== '' ? [$props['value_label']] : []),
        'options' => $props['options'] ?? [],
        'clearable' => $props['clearable'] ?? FALSE,
        'clear_label' => $props['clear_label'] ?? '',
        'creatable' => $props['creatable'] ?? FALSE,
        'create_label' => $props['create_label'] ?? '',
        'searchable' => $props['searchable'] ?? FALSE,
        'selected_chips' => $props['selected_chips'] ?? FALSE,
        'selected' => $props['selected'] ?? [],
        'open' => FALSE,
        'autosave' => $this->autosaves(),
      ] + ($statuses[$field] ?? ['status' => '', 'invalid' => FALSE]);
      $element[$field]['#printed'] = TRUE;
    }
    // `#parents` lets the form error handler walk this display-only element
    // after a rejected save.
    $element['inspector'] = $this->inspectorRows->propertiesBlock($rows) + [
      '#weight' => -100,
      '#parents' => ['inspector'],
    ];
    return $element;
  }

  /**
   * What the last write did to each field: the error refusing it, or "Saved".
   *
   * "Saved" belongs to the answer of the save only, not to later requests of
   * the same form.
   *
   * @return array<string, array{status: string, invalid: bool}>
   *   Field statuses keyed by field name.
   */
  private function fieldStatuses(FormStateInterface $form_state): array {
    $statuses = [];
    foreach ($form_state->getErrors() as $name => $message) {
      $statuses[explode('][', (string) $name)[0]] ??= [
        'status' => PlainTextOutput::renderFromHtml((string) $message),
        'invalid' => TRUE,
      ];
    }
    foreach ($form_state->isRebuilding() ? $form_state->get('property_saved') ?? [] : [] as $field) {
      $statuses[$field] ??= ['status' => (string) $this->t('Saved'), 'invalid' => FALSE];
    }
    return $statuses;
  }

  /**
   * {@inheritdoc}
   *
   * Newly chosen Parent and Blocked by values must be open tickets of this
   * ticket's project; relations it already holds are kept.
   */
  public function validateForm(array &$form, FormStateInterface $form_state): EntityInterface {
    $entity = parent::validateForm($form, $form_state);
    assert($entity instanceof BbTicketInterface);
    $stored = $this->entityTypeManager->getStorage('bb_ticket')->loadUnchanged($entity->id());
    assert($stored instanceof BbTicketInterface);
    $this->rejectProjectScopedRelations($this->getFormDisplay($form_state), $entity, $form_state, $stored);
    if ($form_state->getErrors()) {
      // Lay the rows out again, so each refused field shows its error.
      $form = $this->prepareSurface($form, $form_state, $entity);
    }
    return $entity;
  }

  /**
   * {@inheritdoc}
   */
  public function buildEntity(array $form, FormStateInterface $form_state): BbTicketInterface {
    $built = parent::buildEntity($form, $form_state);
    assert($built instanceof BbTicketInterface);
    return $built;
  }

}
