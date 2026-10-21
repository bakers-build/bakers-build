<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\Component\Utility\Html;
use Drupal\Core\Entity\EntityReferenceSelection\SelectionInterface;
use Drupal\Core\Entity\EntityReferenceSelection\SelectionPluginManagerInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Access-checked project and ticket candidates for time capture.
 */
final class WorkTargetOptions {

  /**
   * Ticket candidates shown before the employee searches.
   */
  public const TICKET_LIMIT = 50;

  /**
   * Constructs the options source.
   */
  public function __construct(
    private SelectionPluginManagerInterface $selection,
    private EntityTypeManagerInterface $entities,
  ) {}

  /**
   * Projects the current user may record on, labelled "Customer · Project".
   *
   * @return array<string, string>
   *   Labels keyed by project id, in label order.
   */
  public function projects(): array {
    $ids = array_keys($this->candidates('bb_project', 'bb_track_work_project', [], NULL, 0));
    $options = [];
    foreach ($this->entities->getStorage('bb_project')->loadMultiple($ids) as $project) {
      if ($project instanceof BbProjectInterface) {
        $options[(string) $project->id()] = $this->projectLabel($project);
      }
    }
    natcasesort($options);
    return $options;
  }

  /**
   * Tickets of a project the current user may record on.
   *
   * @return array<string, string>
   *   Labels keyed by ticket id.
   */
  public function tickets(int $project, ?string $match = NULL, int $limit = self::TICKET_LIMIT): array {
    return $this->candidates('bb_ticket', 'bb_track_work_ticket', ['bb_selected_project' => $project], $match, $limit);
  }

  /**
   * The ticket's label when it is a visible ticket of the project.
   */
  public function ticketOf(int $ticket, int $project): ?string {
    $entity = $this->entities->getStorage('bb_ticket')->load($ticket);
    if (!$entity instanceof BbTicketInterface || !$entity->access('view')
      || (int) $entity->get('project_id')->target_id !== $project) {
      return NULL;
    }
    return (string) $entity->label();
  }

  /**
   * The plain project name, or an empty string.
   */
  public function projectName(int $project): string {
    return (string) $this->entities->getStorage('bb_project')->load($project)?->label();
  }

  /**
   * The customer-qualified project label.
   */
  public function projectLabel(BbProjectInterface $project): string {
    $group = $project->getGroup();
    $customer = $group instanceof BbGroupInterface ? (string) $group->label() : '';
    return $customer === '' ? (string) $project->label() : $customer . ' · ' . $project->label();
  }

  /**
   * Plain-string labels from a selection handler, keyed by id.
   *
   * @param string $type
   *   Target entity type.
   * @param string $handler
   *   Selection handler plugin ID.
   * @param array<string, mixed> $settings
   *   Extra handler configuration.
   * @param string|null $match
   *   Search text, or NULL for none.
   * @param int $limit
   *   Maximum number of candidates.
   *
   * @return array<string, string>
   *   Labels keyed by entity id.
   */
  private function candidates(string $type, string $handler, array $settings, ?string $match, int $limit): array {
    $instance = $this->selection->getInstance(['target_type' => $type, 'handler' => $handler] + $settings);
    assert($instance instanceof SelectionInterface);
    $options = [];
    foreach ($instance->getReferenceableEntities($match, 'CONTAINS', $limit) as $bundle) {
      foreach ($bundle as $id => $label) {
        $options[(string) $id] = trim(Html::decodeEntities(strip_tags((string) $label)));
      }
    }
    return $options;
  }

}
