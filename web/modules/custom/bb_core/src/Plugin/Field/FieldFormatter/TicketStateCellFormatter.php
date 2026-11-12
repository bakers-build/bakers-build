<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbRun;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;

/**
 * The state column: a badge reading the workflow's own label.
 *
 * IT REUSES `StateItemInterface::getLabel()`, WHICH IS NOT AN IMPLEMENTATION
 * DETAIL. That method reads the state's label out of the workflow definition,
 * and it is the same reading `bb_state_label` (`StateLabelFormatter`) renders
 * a ticket's state by and the same one `TypeWorkflows::ticketStateOptions()`
 * offers the facet (spec D12). A mapping of our own here would be a second
 * state vocabulary, which is the defect D12 argues against for the facets and
 * the defect `priority` actually had: the row said `P1` while the facet said
 * `High`.
 *
 * A TICKET'S TONE IS `neutral` AND ITS STATE'S COLOUR LIVES ON THE ROW. `table`
 * draws the status accent as a rail on the row's first cell, from the row's
 * `accent`, so tinting the badge as well would state the same thing twice in
 * two places that could disagree. A RUN'S badge takes its status role from
 * `BbRun::STATE_MARKS`, as every other place that shows a run state does.
 */
#[FieldFormatter(
  id: 'bb_ticket_state_cell',
  label: new TranslatableMarkup('Table cell: state badge'),
  description: new TranslatableMarkup("The workflow state's own label as a badge, in a bb_theme:table cell."),
  field_types: ['state'],
)]
final class TicketStateCellFormatter extends FormatterBase {

  use TicketCellRenderTrait;

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $elements = [];
    $run = $items->getEntity() instanceof BbRunInterface;
    foreach ($items as $delta => $item) {
      if (!$item instanceof StateItemInterface) {
        continue;
      }
      $label = (string) ($item->getLabel() ?? $item->getId());
      if ($label === '') {
        continue;
      }
      $elements[$delta] = $this->cellElement([
        'kind' => 'badge',
        'label' => $label,
        'tone' => $run ? (BbRun::STATE_MARKS[$item->getId()][1] ?? 'neutral') : 'neutral',
      ]);
    }
    return $elements;
  }

}
