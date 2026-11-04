<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityDeleteForm;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\EntityDeleteRules;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Confirms a delete, naming what goes with it, what is detached or blocks it.
 *
 * Returns to the page the entity is managed from, not the admin collection.
 */
class BbContentEntityDeleteForm extends ContentEntityDeleteForm {

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
    $references = $this->deleteRules->references($this->getEntity());
    $lists = [
      EntityDeleteRules::BLOCK => $this->t('Cannot be deleted while these still use it:'),
      EntityDeleteRules::CASCADE => $this->t('These will also be deleted:'),
      EntityDeleteRules::DETACH => $this->t('These will be detached from it:'),
    ];
    $weight = -10;
    foreach ($lists as $action => $title) {
      if ($references[$action] !== []) {
        $form['references_' . $action] = [
          '#theme' => 'item_list',
          '#title' => $title,
          '#items' => $this->listItems($references[$action]),
          '#weight' => $weight++,
        ];
      }
    }
    if ($references[EntityDeleteRules::BLOCK] !== []) {
      $form['actions']['submit']['#access'] = FALSE;
      $form['description']['#markup'] = $this->t('Remove or reassign them first.');
    }
    return $form;
  }

  /**
   * One line per referencing entity, then a count of the rest.
   *
   * @param list<\Drupal\Core\Entity\ContentEntityInterface> $entities
   *   The referencing entities.
   *
   * @return list<\Drupal\Core\StringTranslation\TranslatableMarkup>
   *   The list items.
   */
  private function listItems(array $entities): array {
    $items = [];
    foreach (array_slice($entities, 0, self::LIST_LIMIT) as $entity) {
      $items[] = $this->t('@type: @label', [
        '@type' => $entity->getEntityType()->getSingularLabel(),
        '@label' => $entity->label() ?: '#' . $entity->id(),
      ]);
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
  public function validateForm(array &$form, FormStateInterface $form_state): ContentEntityInterface {
    $entity = parent::validateForm($form, $form_state);
    // The page may have been open while a new reference appeared.
    if ($this->deleteRules->references($this->getEntity())[EntityDeleteRules::BLOCK] !== []) {
      $form_state->setErrorByName('', $this->t('%label is still in use and was not deleted.', ['%label' => $this->getEntity()->label()]));
    }
    return $entity;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
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
