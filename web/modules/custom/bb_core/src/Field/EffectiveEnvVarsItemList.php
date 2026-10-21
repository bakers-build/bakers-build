<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\EnvVars;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Resolves `env_vars` along project → parent_id chain (nearest wins).
 *
 * Walks parent_id root→self (cycle-guarded by tracking visited uuids), parses
 * each ticket's own `env_vars`, merges project→root→self so the nearest value
 * wins, and returns the canonical `KEY=value` lines. Malformed lines are
 * skipped with a loud, content-free log (line number + entity id only —
 * values are secret). Read-only: the ticket's project, parent_id and env_vars
 * remain the source of truth.
 */
final class EffectiveEnvVarsItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $ticket = $this->getEntity();
    if (!$ticket instanceof BbTicketInterface) {
      return;
    }

    // Merge project → root → … → self so the nearest value wins on a
    // duplicate key. THE PROJECT IS ONE MAP AT THE HEAD OF THE CHAIN, and that
    // placement is what keeps the conductor untouched: Conductor reads only
    // ticket.effectiveEnvVars and hands it to resolveRunEnv(), which is also
    // the single place reserved core keys are protected. Project defaults
    // arrive inside that one string, through that one guard.
    $maps = [$this->projectMap($ticket)];
    foreach ($this->collectChainRootToSelf($ticket) as $node) {
      $maps[] = $this->parseNode($node);
    }

    $this->list[0] = $this->createItem(0, [
      'value' => EnvVars::toLines(EnvVars::merge(...$maps)),
    ]);
  }

  /**
   * Parses the ticket's project's own env_vars, logging malformed lines.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket whose project supplies the defaults.
   *
   * @return array<string, string>
   *   The parsed KEY=value map, empty when there is no project or no value.
   */
  private function projectMap(BbTicketInterface $ticket): array {
    if ($ticket->get('project_id')->isEmpty()) {
      return [];
    }
    $project = $ticket->get('project_id')->entity;
    if (!$project instanceof ContentEntityInterface || !$project->hasField('env_vars')) {
      return [];
    }
    $skipped = NULL;
    $map = EnvVars::parse((string) $project->get('env_vars')->value, $skipped);
    foreach ($skipped as $lineNumber) {
      \Drupal::logger('bb_core')->warning(
        'env_vars line @n skipped (malformed) on project @id',
        ['@n' => $lineNumber, '@id' => (string) $project->id()],
      );
    }
    return $map;
  }

  /**
   * Walks parent_id self→root, guarding against cycles, returns root→self.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket to resolve the ancestor chain for.
   *
   * @return array<\Drupal\bb_core\Entity\BbTicketInterface>
   *   The chain ordered root→self (ready to merge in precedence order).
   */
  private function collectChainRootToSelf(BbTicketInterface $ticket): array {
    $chain = [];
    $seen = [];
    $current = $ticket;
    while ($current instanceof BbTicketInterface) {
      $uuid = $current->uuid();
      if ($uuid !== NULL && isset($seen[$uuid])) {
        break;
      }
      if ($uuid !== NULL) {
        $seen[$uuid] = TRUE;
      }
      $chain[] = $current;
      $parent = $current->get('parent_id')->isEmpty()
        ? NULL
        : $current->get('parent_id')->entity;
      $current = $parent instanceof BbTicketInterface ? $parent : NULL;
    }
    return array_reverse($chain);
  }

  /**
   * Parses one ticket's own env_vars, logging any malformed lines by number.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $node
   *   The ticket whose own env_vars to parse.
   *
   * @return array<string, string>
   *   The parsed KEY=value map (malformed lines dropped).
   */
  private function parseNode(BbTicketInterface $node): array {
    $skipped = NULL;
    $map = EnvVars::parse((string) $node->get('env_vars')->value, $skipped);
    foreach ($skipped as $lineNumber) {
      \Drupal::logger('bb_core')->warning(
        'env_vars line @n skipped (malformed) on ticket @id',
        ['@n' => $lineNumber, '@id' => (string) $node->id()],
      );
    }
    return $map;
  }

}
