<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityDeleteForm;
use Drupal\Core\Entity\EntityListBuilder;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\Field\FieldStorageDefinitionInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\EntityPermissionProvider;
use Drupal\entity\Menu\EntityCollectionLocalActionProvider;
use Drupal\entity\QueryAccess\QueryAccessHandler;
use Drupal\bb_core\Access\BbTicketTemplateAccessControlHandler;
use Drupal\bb_core\Form\BbTicketTemplateForm;
use Drupal\bb_core\Routing\BbTicketTemplateRouteProvider;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\views\EntityViewsData;
use Symfony\Component\Validator\Context\ExecutionContextInterface;

/**
 * Represents a bakers.build ticket template — a reusable recipe for creating tickets.
 *
 * Instantiation (placeholder rendering, overrides, the initial
 * transition) is service-owned; this entity only stores the recipe.
 *
 * @see \Drupal\bb_core\TicketTemplate\TicketTemplateInstantiator
 */
#[ContentEntityType(
  id: 'bb_ticket_template',
  label: new TranslatableMarkup('bakers.build ticket template'),
  label_collection: new TranslatableMarkup('bakers.build ticket templates'),
  label_singular: new TranslatableMarkup('bakers.build ticket template'),
  label_plural: new TranslatableMarkup('bakers.build ticket templates'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'label' => 'name'],
  handlers: [
    'access' => BbTicketTemplateAccessControlHandler::class,
    // Narrowed to the account's read scope by WorkspaceReadScopeSubscriber.
    'query_access' => QueryAccessHandler::class,
    'list_builder' => EntityListBuilder::class,
    'permission_provider' => EntityPermissionProvider::class,
    'views_data' => EntityViewsData::class,
    'form' => [
      'default' => BbTicketTemplateForm::class,
      'add' => BbTicketTemplateForm::class,
      'edit' => BbTicketTemplateForm::class,
      'delete' => ContentEntityDeleteForm::class,
    ],
    'local_action_provider' => ['collection' => EntityCollectionLocalActionProvider::class],
    'route_provider' => ['html' => BbTicketTemplateRouteProvider::class],
  ],
  links: [
    // Product routes, not /admin: the entry point is the owning project's
    // "Templates" tab. `collection` stays an unlinked admin route purely to
    // satisfy `field_ui_base_route`.
    'canonical' => '/_workspace/{bb_workspace}/ticket-template/{bb_ticket_template}',
    'add-form' => '/_workspace/{bb_workspace}/ticket-template/add',
    'edit-form' => '/_workspace/{bb_workspace}/ticket-template/{bb_ticket_template}/settings',
    'delete-form' => '/_workspace/{bb_workspace}/ticket-template/{bb_ticket_template}/delete',
    'collection' => '/admin/bakers/ticket-templates',
  ],
  admin_permission: 'administer bakers',
  field_ui_base_route: 'entity.bb_ticket_template.collection',
  base_table: 'bb_ticket_template',
  constraints: [
    'Callback' => ['callback' => [self::class, 'validateScope']],
    'BbTemplateTargetState' => [],
  ],
)]
final class BbTicketTemplate extends BbContentEntityBase implements BbTicketTemplateInterface {

  use BbBaseFieldsTrait;

  /**
   * Enforces the template scope: exactly one project or one workspace.
   *
   * A project template carries `project_id`, a workspace template
   * `workspace_id`; both or neither is a violation. Neither may change after
   * the first save: a template moving scope would silently redirect every
   * future instantiation. Runs as an entity constraint, so a form or a
   * JSON:API PATCH gets a validation error.
   */
  public static function validateScope(mixed $template, ExecutionContextInterface $context): void {
    if (!$template instanceof self) {
      return;
    }
    if ($template->get('project_id')->isEmpty() === $template->get('workspace_id')->isEmpty()) {
      $context->buildViolation('A ticket template belongs to exactly one project or one workspace.')
        ->atPath('project_id')
        ->addViolation();
    }
    if ($template->isNew()) {
      return;
    }
    $stored = \Drupal::entityTypeManager()->getStorage('bb_ticket_template')->loadUnchanged($template->id());
    if (!$stored instanceof self) {
      return;
    }
    foreach (['project_id', 'workspace_id'] as $field) {
      if ((int) $stored->get($field)->target_id !== (int) $template->get($field)->target_id) {
        $context->buildViolation('The scope of a ticket template cannot be changed.')
          ->atPath($field)
          ->addViolation();
      }
    }
  }

  /**
   * The `allowed_values_function` of `target_state`.
   *
   * The targets of the template's own workflow; without a template (a Views
   * filter, say) every ticket workflow's targets.
   *
   * @param \Drupal\Core\Field\FieldStorageDefinitionInterface $definition
   *   The field storage definition.
   * @param \Drupal\Core\Entity\FieldableEntityInterface|null $entity
   *   The template, when known.
   * @param bool $cacheable
   *   Set to FALSE: the options vary with the template's workflow.
   *
   * @return array<string, string>
   *   State => label.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public static function targetStateOptions(FieldStorageDefinitionInterface $definition, ?FieldableEntityInterface $entity = NULL, bool &$cacheable = TRUE): array {
    $cacheable = FALSE;
    if ($entity instanceof BbTicketTemplateInterface) {
      return TypeWorkflows::templateTargetStateOptions($entity->getWorkflow());
    }
    $options = [];
    foreach (array_keys(TypeWorkflows::ticketWorkflowOptions()) as $workflow_id) {
      $options += TypeWorkflows::templateTargetStateOptions($workflow_id);
    }
    return $options;
  }

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields['name'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Name'))
      ->setRequired(TRUE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 0]);
    $fields['enabled'] = BaseFieldDefinition::create('boolean')
      ->setLabel(new TranslatableMarkup('Enabled'))
      ->setDescription(new TranslatableMarkup('Disabled templates cannot be instantiated.'))
      ->setDefaultValue(FALSE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'boolean_checkbox', 'weight' => 1]);
    $placeholders = new TranslatableMarkup('Supports {{date}} (UTC YYYY-MM-DD) and {{month}} (UTC YYYY-MM). No other placeholders.');
    $fields['title_pattern'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Title'))
      ->setDescription($placeholders)
      ->setRequired(TRUE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 2]);
    $fields['description'] = BaseFieldDefinition::create('text_long')
      ->setLabel(new TranslatableMarkup('Description'))
      ->setDescription($placeholders)
      ->setRequired(TRUE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'text_textarea', 'weight' => 3]);
    $fields['workflow'] = BaseFieldDefinition::create('list_string')
      ->setLabel(new TranslatableMarkup('Workflow'))
      ->setRequired(TRUE)
      ->setSetting('allowed_values_function', TypeWorkflows::class . '::ticketWorkflowOptions')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'bb_picker', 'weight' => 4]);
    $fields['target_state'] = BaseFieldDefinition::create('list_string')
      ->setLabel(new TranslatableMarkup('Target state'))
      ->setDescription(new TranslatableMarkup("The state a generated ticket is transitioned into after creation: the workflow's initial state or one transition away from it."))
      ->setSetting('allowed_values_function', self::class . '::targetStateOptions')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'bb_picker', 'weight' => 5]);
    $fields['labels'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Labels'))
      ->setSetting('target_type', 'bb_term')
      ->setSetting('handler', 'bb_label_in_entity_workspace')
      ->setSetting('handler_settings', ['target_bundles' => ['bb_labels' => 'bb_labels']])
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->addConstraint('BbTicketLabelWorkspace')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'bb_picker', 'weight' => 6]);
    $fields['project_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Project'))
      ->setDescription(new TranslatableMarkup('Immutable after first save.'))
      ->setSetting('target_type', 'bb_project')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'entity_reference_autocomplete', 'weight' => 7]);
    // Set from the route on a workspace template, never edited in a form.
    $fields['workspace_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Workspace'))
      ->setDescription(new TranslatableMarkup('Set on a workspace template instead of a project. Immutable after first save.'))
      ->setSetting('target_type', 'bb_workspace');
    $fields['conductor_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Conductor'))
      ->setSetting('target_type', 'bb_conductor')
      ->setSetting('handler', 'bb_conductor_by_ticket_project')
      ->addConstraint('BbConductorProjectMatch')
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'bb_picker', 'weight' => 8]);
    $fields['owner_user_id'] = static::ownerBaseFieldDefinition(9, new TranslatableMarkup('Owner'))
      ->setRequired(TRUE);
    return $fields;
  }

  /**
   * {@inheritdoc}
   */
  public function getScopeWorkspaceId(): ?int {
    return $this->isWorkspaceScoped() ? (int) $this->get('workspace_id')->target_id : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function isWorkspaceScoped(): bool {
    return !$this->get('workspace_id')->isEmpty();
  }

  /**
   * {@inheritdoc}
   */
  public function isEnabled(): bool {
    return (bool) $this->get('enabled')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function getTitlePattern(): string {
    return (string) $this->get('title_pattern')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function getDescriptionPattern(): string {
    return (string) $this->get('description')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function getWorkflow(): string {
    return (string) $this->get('workflow')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function getTargetState(): string {
    return (string) $this->get('target_state')->value;
  }

}
