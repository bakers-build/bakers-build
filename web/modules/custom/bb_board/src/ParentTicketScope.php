<?php

declare(strict_types=1);

namespace Drupal\bb_board;

use Drupal\Component\Uuid\Uuid;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Resolves a Project Board parent to the visible tickets below it.
 *
 * Walks `parent_id` breadth-first to every depth inside one project, through
 * closed tickets too: the open predicate belongs to the board query, so an
 * open grandchild of a closed child still counts. A ticket the reader cannot
 * see, or whose scope fields are hidden, is neither returned nor walked.
 */
final class ParentTicketScope {

  /**
   * The fields that place a ticket in a parent's scope.
   */
  private const SCOPE_FIELDS = ['project_id', 'parent_id', 'workflow', 'state', 'closed'];

  /**
   * Request-local results, keyed by actor, project and input.
   *
   * @var array<string, array{mode: string, parent: ?\Drupal\bb_core\Entity\BbTicketInterface, ticket_ids: list<string>, message: ?\Drupal\Core\StringTranslation\TranslatableMarkup}>
   */
  private array $resolved = [];

  /**
   * Request-local parent choices, keyed by actor and project.
   *
   * @var array<string, array<string, string>>
   */
  private array $options = [];

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly AccountProxyInterface $currentUser,
  ) {}

  /**
   * Parent choices: this project's viewable tickets, by identifier.
   *
   * @return array<string, string>
   *   Ticket UUID => "IDENTIFIER Title".
   */
  public function options(BbProjectInterface $project): array {
    // Every board display builds the exposed form, so the picker asks for the
    // same options several times per request.
    return $this->options[$this->currentUser->id() . ':' . $project->id()] ??= $this->buildOptions($project);
  }

  /**
   * Builds the parent choices for one project.
   *
   * @return array<string, string>
   *   Ticket UUID => "IDENTIFIER Title".
   */
  private function buildOptions(BbProjectInterface $project): array {
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('project_id', $project->id())
      ->sort('identifier')
      ->sort('id')
      ->execute();
    $tickets = $storage->loadMultiple($ids);
    $parent_ids = [];
    foreach ($tickets as $ticket) {
      if (!$ticket instanceof BbTicketInterface || !$this->inScope($ticket, $project)) {
        continue;
      }
      $parent_id = $ticket->get('parent_id')->target_id;
      if ($parent_id) {
        $parent_ids[(string) $parent_id] = TRUE;
      }
    }
    $options = [];
    foreach ($ids as $id) {
      $ticket = $tickets[$id] ?? NULL;
      if (!$ticket instanceof BbTicketInterface || !$this->inScope($ticket, $project)) {
        continue;
      }
      if (!$this->isEligibleParent($ticket, $parent_ids)) {
        continue;
      }
      $options[(string) $ticket->uuid()] = $ticket->getIdentifier() . ' ' . $ticket->getTitle();
    }
    return $options;
  }

  /**
   * Whether this ticket may appear as a parent choice.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   Candidate parent.
   * @param array<string, true> $parent_ids
   *   Ids that have at least one in-scope child.
   */
  private function isEligibleParent(BbTicketInterface $ticket, array $parent_ids): bool {
    if (!isset($parent_ids[(string) $ticket->id()])) {
      return FALSE;
    }
    if ($ticket->get('closed')->value) {
      return FALSE;
    }
    return !in_array((string) $ticket->get('state')->value, ['done', 'cancelled'], TRUE);
  }

  /**
   * Resolves the submitted parent for one project.
   *
   * @param \Drupal\bb_core\Entity\BbProjectInterface $project
   *   The board's project.
   * @param mixed $uuid
   *   The raw `parent_id` input: NULL or '' for none.
   *
   * @return array{mode: string, parent: ?\Drupal\bb_core\Entity\BbTicketInterface, ticket_ids: list<string>, message: ?\Drupal\Core\StringTranslation\TranslatableMarkup}
   *   Mode `project` (no parent), `parent` (ticket_ids may be empty for a
   *   leaf)
   *   or `invalid` (message set, nothing revealed).
   */
  public function resolve(BbProjectInterface $project, mixed $uuid): array {
    if ($uuid === NULL || $uuid === '') {
      return ['mode' => 'project', 'parent' => NULL, 'ticket_ids' => [], 'message' => NULL];
    }
    $key = implode(':', [$this->currentUser->id(), $project->id(), is_scalar($uuid) ? (string) $uuid : '[]']);
    return $this->resolved[$key] ??= $this->resolveParent($project, $uuid);
  }

  /**
   * Validates the parent and walks its subtree.
   *
   * @return array{mode: string, parent: ?\Drupal\bb_core\Entity\BbTicketInterface, ticket_ids: list<string>, message: ?\Drupal\Core\StringTranslation\TranslatableMarkup}
   *   See resolve().
   */
  private function resolveParent(BbProjectInterface $project, mixed $uuid): array {
    $invalid = [
      'mode' => 'invalid',
      'parent' => NULL,
      'ticket_ids' => [],
      'message' => new TranslatableMarkup('Parent ticket is unavailable.'),
    ];
    if (!is_string($uuid) || !Uuid::isValid($uuid)) {
      return $invalid;
    }
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('uuid', $uuid)
      ->condition('project_id', $project->id())
      ->execute();
    $parent = $ids === [] ? NULL : $storage->load(reset($ids));
    if (!$parent instanceof BbTicketInterface || !$this->inScope($parent, $project)) {
      return $invalid;
    }

    return [
      'mode' => 'parent',
      'parent' => $parent,
      'ticket_ids' => $this->descendantIds($parent, $project),
      'message' => NULL,
    ];
  }

  /**
   * The ids below one parent, breadth-first, each visible one once.
   *
   * @return list<string>
   *   Ticket ids, the parent excluded even when a cycle leads back to it.
   */
  private function descendantIds(BbTicketInterface $parent, BbProjectInterface $project): array {
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $frontier = [$parent->id()];
    $seen = [(string) $parent->id() => TRUE];
    $descendants = [];
    while ($frontier !== []) {
      $child_ids = $storage->getQuery()
        ->accessCheck(TRUE)
        ->condition('project_id', $project->id())
        ->condition('parent_id', $frontier, 'IN')
        ->execute();
      $frontier = [];
      foreach ($storage->loadMultiple($child_ids) as $ticket) {
        $id = (string) $ticket->id();
        if (isset($seen[$id]) || !$ticket instanceof BbTicketInterface) {
          continue;
        }
        $seen[$id] = TRUE;
        if ($this->inScope($ticket, $project)) {
          $frontier[] = $ticket->id();
          $descendants[] = $id;
        }
      }
    }
    return $descendants;
  }

  /**
   * Whether the reader may see this ticket and the fields that scope it.
   */
  private function inScope(BbTicketInterface $ticket, BbProjectInterface $project): bool {
    if (!$ticket->access('view')) {
      return FALSE;
    }
    foreach (self::SCOPE_FIELDS as $field) {
      if (!$ticket->get($field)->access('view')) {
        return FALSE;
      }
    }
    return (string) $ticket->get('project_id')->target_id === (string) $project->id();
  }

}
