<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityDeleteForm;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\EntityDeleteRules;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Confirms a delete, naming what goes with it, what is detached or blocks it.
 *
 * Returns to the page the entity is managed from, not the admin collection;
 * opened from a Delete trigger, it is the dialog over the current page.
 */
class BbContentEntityDeleteForm extends ContentEntityDeleteForm {

  use DeleteDialogFormTrait;

  /**
   * How many referencing entities a list names before it summarizes.
   */
  private const int LIST_LIMIT = 20;

  /**
   * The delete rules.
   */
  protected EntityDeleteRules $deleteRules;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->deleteRules = $container->get('bb_core.entity_delete_rules');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $form = parent::buildForm($form, $form_state);
    // A native round trip: a boosted submit would swap the redirect target
    // into the island instead of leaving the page of a deleted entity.
    $form['#attributes']['data-hx-boost'] = 'false';
    $references = $this->deleteRules->references($this->getEntity());
    $form['consequences'] = $this->consequences($references) + ['#weight' => -10];
    if ($references[EntityDeleteRules::BLOCK] !== []) {
      $form['actions']['submit']['#access'] = FALSE;
      unset($form['description']);
    }
    $this->attachDeleteDialog($form);
    return $form;
  }

  /**
   * What the delete would block on, take along or detach.
   *
   * @param array<string, list<\Drupal\Core\Entity\ContentEntityInterface>> $references
   *   The referencing entities, keyed by delete rule.
   *
   * @return array<string, mixed>
   *   A warning when blocked, else a note per cascade and detach.
   */
  private function consequences(array $references): array {
    $label = $this->getEntity()->label() ?: $this->getEntity()->getEntityType()->getSingularLabel();
    $build = [];
    if ($references[EntityDeleteRules::BLOCK] !== []) {
      $build['blocked'] = $this->consequence('bb_theme:message', ['status' => 'warning'], $this->formatPlural(
        count($references[EntityDeleteRules::BLOCK]),
        "%label can't be deleted: @counts still uses it. Remove or reassign it first.",
        "%label can't be deleted: @counts still use it. Remove or reassign them first.",
        ['%label' => $label, '@counts' => $this->counts($references[EntityDeleteRules::BLOCK])],
      ), $references[EntityDeleteRules::BLOCK], TRUE);
      return $build;
    }
    if ($references[EntityDeleteRules::CASCADE] !== []) {
      $build['cascade'] = $this->consequence('bb_theme:note', ['tone' => 'attention'], $this->t(
        'This also deletes @counts:',
        ['@counts' => $this->counts($references[EntityDeleteRules::CASCADE])],
      ), $references[EntityDeleteRules::CASCADE], FALSE);
    }
    if ($references[EntityDeleteRules::DETACH] !== []) {
      $build['detach'] = $this->consequence('bb_theme:note', ['tone' => 'neutral'], $this->t(
        '@counts will be detached from it:',
        ['@counts' => $this->counts($references[EntityDeleteRules::DETACH])],
      ), $references[EntityDeleteRules::DETACH], FALSE);
    }
    return $build;
  }

  /**
   * The count per entity type, e.g. "3 tickets and 1 environment".
   *
   * @param list<\Drupal\Core\Entity\ContentEntityInterface> $entities
   *   The referencing entities.
   */
  private function counts(array $entities): string {
    $counts = array_count_values(array_map(static fn ($entity) => $entity->getEntityTypeId(), $entities));
    $parts = [];
    foreach ($counts as $type => $count) {
      $parts[] = (string) $this->entityTypeManager->getDefinition($type)->getCountLabel($count);
    }
    $last = array_pop($parts);
    return $parts === [] ? $last : (string) $this->t('@list and @last', [
      '@list' => implode(', ', $parts),
      '@last' => $last,
    ]);
  }

  /**
   * One consequence: a sentence, then the entities grouped by type.
   *
   * @param string $component
   *   The component that carries it.
   * @param array<string, string> $props
   *   Its props.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup $sentence
   *   The sentence.
   * @param list<\Drupal\Core\Entity\ContentEntityInterface> $entities
   *   The referencing entities.
   * @param bool $linked
   *   Whether each label links to its entity.
   *
   * @return array<string, mixed>
   *   The component.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  private function consequence(string $component, array $props, TranslatableMarkup $sentence, array $entities, bool $linked): array {
    $groups = [];
    foreach ($entities as $entity) {
      $groups[$entity->getEntityTypeId()][] = $entity;
    }
    $body = ['sentence' => ['#markup' => $sentence]];
    foreach ($groups as $type => $members) {
      $body[$type] = [
        '#theme' => 'item_list',
        '#title' => $this->t('@type (@count)', [
          '@type' => $members[0]->getEntityType()->getSingularLabel(),
          '@count' => count($members),
        ]),
        '#items' => $this->listItems($members, $linked),
      ];
    }
    return [
      '#type' => 'component',
      '#component' => $component,
      '#props' => $props,
      '#slots' => ['body' => $body],
    ];
  }

  /**
   * One line per referencing entity, then a count of the rest.
   *
   * @param list<\Drupal\Core\Entity\ContentEntityInterface> $entities
   *   The referencing entities of one type.
   * @param bool $linked
   *   Whether each label links to its entity, where the user may see it.
   *
   * @return list<mixed>
   *   The list items.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  private function listItems(array $entities, bool $linked): array {
    $items = [];
    foreach (array_slice($entities, 0, self::LIST_LIMIT) as $entity) {
      $label = $entity->label() ?: '#' . $entity->id();
      $items[] = $linked && $entity->hasLinkTemplate('canonical') && $entity->access('view')
        ? ['#type' => 'link', '#title' => $label, '#url' => $entity->toUrl()]
        : $label;
    }
    $rest = count($entities) - self::LIST_LIMIT;
    if ($rest > 0) {
      $items[] = $this->formatPlural($rest, 'and 1 more', 'and @count more');
    }
    return $items;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    // A reference appeared while the form was open: show the blocked form.
    if ($this->deleteRules->references($this->getEntity())[EntityDeleteRules::BLOCK] !== []) {
      $form_state->setRebuild();
      return;
    }
    if ($this->getEntity()->getEntityTypeId() !== 'bb_invite') {
      parent::submitForm($form, $form_state);
      return;
    }
    // The Members screen shows its own result line instead of status toasts.
    $this->getEntity()->delete();
    $this->messenger()->addMessage($this->getDeletionMessage(), WorkspaceInviteForm::RESULT_MESSAGE_TYPE);
    $form_state->setRedirectUrl($this->getRedirectUrl());
    $this->logDeletionMessage();
  }

  /**
   * {@inheritdoc}
   */
  public function getCancelUrl(): Url {
    $entity = $this->getEntity();
    // An invitation has no page of its own to return to.
    return $entity->hasLinkTemplate('canonical') || $entity->hasLinkTemplate('edit-form')
      ? parent::getCancelUrl()
      : $this->getRedirectUrl();
  }

  /**
   * Titles a workspace delete route by the entity it deletes.
   *
   * Core's deleteTitle() titles the route's first entity, the workspace.
   */
  public function title(RouteMatchInterface $route_match): TranslatableMarkup {
    [$entity_type_id] = explode('.', (string) $route_match->getRouteObject()?->getDefault('_entity_form'));
    $entity = $route_match->getParameter($entity_type_id);
    return $this->t('Delete @label', [
      '@label' => $entity instanceof EntityInterface
        ? ($entity->label() ?: $entity->getEntityType()->getSingularLabel())
        : $this->t('item'),
    ]);
  }

  /**
   * {@inheritdoc}
   */
  public function getQuestion(): TranslatableMarkup {
    $entity = $this->getEntity();
    return $this->t('Delete @label', ['@label' => $entity->label() ?: $entity->getEntityType()->getSingularLabel()]);
  }

  /**
   * {@inheritdoc}
   */
  protected function getDeletionMessage(): TranslatableMarkup {
    $entity = $this->getEntity();
    return $this->t('Deleted %label.', ['%label' => $entity->label() ?: $entity->getEntityType()->getSingularLabel()]);
  }

  /**
   * {@inheritdoc}
   */
  protected function getRedirectUrl(): Url {
    $entity = $this->getEntity();
    $reference = fn(string $field) => $entity instanceof FieldableEntityInterface && $entity->hasField($field)
      ? $entity->get($field)->entity
      : NULL;
    $url = match ($entity->getEntityTypeId()) {
      'bb_ticket' => ($project = $reference('project_id'))
        ? Url::fromRoute('view.tickets.project_tickets', ['bb_project' => $project->id()])
        : Url::fromRoute('view.tickets.my_work'),
      'bb_project' => Url::fromRoute('view.projects.workspace_list'),
      'bb_team', 'bb_group' => Url::fromRoute('view.groups.workspace_list'),
      'bb_environment' => ($project = $reference('project_id'))
        ? Url::fromRoute('bb_core.bb_project.settings', ['bb_project' => $project->id()])
        : NULL,
      'bb_ticket_template' => ($project = $reference('project_id'))
        ? Url::fromRoute('view.bb_ticket_templates.project_list', ['bb_project' => $project->id()])
        : Url::fromRoute('view.bb_ticket_templates.workspace_list'),
      'bb_ticket_trigger' => ($template = $reference('template_id'))
        ? Url::fromRoute('view.bb_ticket_triggers.template_list', ['bb_ticket_template' => $template->id()])
        : NULL,
      'bb_term' => Url::fromRoute('view.bb_terms.' . match ($entity->bundle()) {
        'type' => 'types',
        'recipe' => 'recipes',
        default => 'labels',
      }),
      'bb_invite' => Url::fromRoute('bb_core.bb_workspace.members'),
      'bb_comment' => ($ticket = $reference('ticket_id')) ? $ticket->toUrl() : NULL,
      'bb_workspace' => Url::fromRoute('<front>'),
      // Conductor and machine: their admin collection.
      default => NULL,
    };
    return $url ?? parent::getRedirectUrl();
  }

}
