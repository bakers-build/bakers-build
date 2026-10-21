<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Field\Plugin\Field\FieldFormatter\EntityReferenceFormatterBase;

/**
 * A reference cell that may be told what the referenced record is CALLED.
 *
 * ONE PLACE STATES THE `view label` DECISION for all three reference columns,
 * because three copies of it would drift the first time one of them was
 * corrected — the same argument spec D12 makes for
 * the facets `translate_entity` processor serving both rows and chips.
 *
 * `view label` RATHER THAN `view`, AND IT IS LOAD-BEARING. It is the operation
 * core defines for being told what an entity is called as opposed to being
 * shown it. No role on a bakers.build site holds `access user profiles`, so an
 * assignee column gated on `view` would render every person as nothing and be
 * worse than the uid it replaced — D12 measured `user/3` answering
 * `view label = TRUE` and `view = FALSE` for a plain workspace member.
 * `EntityReferenceLabelFormatter` makes exactly the same override.
 */
abstract class TicketReferenceCellFormatterBase extends EntityReferenceFormatterBase {

  use TicketCellRenderTrait;

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity) {
    $access = $entity->access('view label', NULL, TRUE);
    // `access()` promises the INTERFACE while the parent's signature asks for
    // the class. Re-wrapping rather than casting to a boolean is what keeps
    // the cacheability of the decision on the render array.
    return $access instanceof AccessResult
      ? $access
      : AccessResult::allowedIf($access->isAllowed())->addCacheableDependency($access);
  }

}
