<?php

declare(strict_types=1);

namespace Drupal\bb_core\Reference;

use Drupal\Component\Utility\Html;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityReferenceSelection\SelectionInterface;
use Drupal\Core\Entity\EntityReferenceSelection\SelectionPluginManagerInterface;
use Drupal\Core\Field\EntityReferenceFieldItemListInterface;

/**
 * Reads the access-checked candidates for one entity-reference field.
 *
 * Any entity-reference field already delegates "what may this account
 * reference" to a selection handler, resolved from the field definition and
 * the host entity that carries it. A picker needs exactly that read, twice
 * over: once for a parent's or a project's inspector, once for a create
 * surface that has no saved host yet but still needs the same
 * access-checked candidates. This service is the one place that read lives,
 * so both surfaces consume it unchanged instead of one copying the other.
 *
 * It names no entity type of its own on purpose: every
 * subject it can be asked about is named by the caller, through the host
 * entity and the field name.
 */
final class ReferenceOptions {

  public function __construct(
    private readonly SelectionPluginManagerInterface $selectionManager,
  ) {}

  /**
   * Returns the access-checked candidates for one field on a host entity.
   *
   * No production caller passes `$match` yet; it is the plug-in point for a
   * server-side picker search. `PickerWidget` passes no `$limit`, so the
   * picker offers the first 50 candidates and its client-side search box
   * filters only among those.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $host
   *   The entity the field belongs to; also the selection handler's context
   *   (e.g. a ticket, so a project-scoped conductor handler can narrow to
   *   the ticket's project).
   * @param string $field
   *   The entity-reference field name.
   * @param string|null $match
   *   An optional label filter, applied on the server by the selection
   *   handler rather than by the caller. Unused by production callers.
   * @param int $limit
   *   The maximum number of candidates to return. Every caller that omits
   *   this takes 50 (see above) — the whole candidate set as far as an
   *   operator can tell, since nothing today asks for more.
   * @param string|null $handler
   *   A selection handler plugin id used instead of the field's own, e.g. a
   *   form display that narrows one field's candidates for that form only.
   *   NULL or empty uses the field's own handler.
   *
   * @return array<int|string, string>
   *   Plain-string labels keyed by target entity id. Empty if the field
   *   does not exist on the host or has no referenceable candidates. Despite
   *   the explicit `(string) $id` cast below, PHP coerces a numeric-string
   *   array key back to an int at runtime, so this map is int-or-string-keyed
   *   whenever ids are numeric (the common case), never purely string-keyed.
   */
  public function for(ContentEntityInterface $host, string $field, ?string $match = NULL, int $limit = 50, ?string $handler = NULL): array {
    $selection = $this->selection($host, $field, $handler);
    if ($selection === NULL) {
      return [];
    }
    $referenceable = $selection->getReferenceableEntities($match, 'CONTAINS', $limit);

    // getReferenceableEntities() keys its result by target bundle; a picker
    // does not care which bundle a candidate belongs to, so flatten to one
    // id => label map. Labels may carry markup (an entity label can be
    // rendered markup); the picker's option labels are plain strings.
    $options = [];
    foreach ($referenceable as $bundle_options) {
      foreach ($bundle_options as $id => $label) {
        $options[(string) $id] = trim(Html::decodeEntities(strip_tags((string) $label)));
      }
    }

    return $options;
  }

  /**
   * Returns the submitted target ids the given handler does not accept.
   *
   * Uncapped, unlike {@see for()}: a valid candidate beyond the picker's
   * first 50 is still accepted.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $host
   *   The entity the field belongs to; the handler's context.
   * @param string $field
   *   The entity-reference field name.
   * @param array<int|string> $ids
   *   The submitted target ids.
   * @param string $handler
   *   The selection handler plugin id to validate against; empty uses the
   *   field's own handler.
   *
   * @return list<string>
   *   The rejected ids; all of them when the field does not exist.
   */
  public function unreferenceable(ContentEntityInterface $host, string $field, array $ids, string $handler): array {
    $ids = array_map('strval', $ids);
    if ($ids === []) {
      return [];
    }
    $selection = $this->selection($host, $field, $handler);
    $valid = $selection === NULL ? [] : array_map('strval', $selection->validateReferenceableEntities($ids));
    return array_values(array_diff($ids, $valid));
  }

  /**
   * Returns labels of the host's referenced ids that the reader may view.
   *
   * Viewable means the field's own handler accepts the id: its query applies
   * the workspace read scope, which entity access('view') does not.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $host
   *   The entity the field belongs to.
   * @param string $field
   *   The field name; a field that is not an entity reference has no labels.
   * @param array<int, string> $ids
   *   The referenced target ids to label.
   *
   * @return array<string, string>
   *   Labels keyed by target id; unviewable ids are absent.
   */
  public function viewableLabels(ContentEntityInterface $host, string $field, array $ids): array {
    $items = $host->get($field);
    if (!$items instanceof EntityReferenceFieldItemListInterface) {
      return [];
    }
    $viewable = array_diff($ids, $this->unreferenceable($host, $field, $ids, ''));
    $labels = [];
    foreach ($items->referencedEntities() as $target) {
      if (in_array((string) $target->id(), $viewable, TRUE)) {
        $labels[(string) $target->id()] = (string) $target->label();
      }
    }
    return $labels;
  }

  /**
   * The selection handler for one field, or NULL when the field is missing.
   */
  private function selection(ContentEntityInterface $host, string $field, ?string $handler): ?SelectionInterface {
    $definition = $host->getFieldDefinition($field);
    if ($definition === NULL) {
      return NULL;
    }
    if ($handler === NULL || $handler === '') {
      return $this->selectionManager->getSelectionHandler($definition, $host);
    }
    $selection = $this->selectionManager->getInstance([
      'target_type' => $definition->getSetting('target_type'),
      'handler' => $handler,
      'entity' => $host,
    ]);
    assert($selection instanceof SelectionInterface);
    return $selection;
  }

}
