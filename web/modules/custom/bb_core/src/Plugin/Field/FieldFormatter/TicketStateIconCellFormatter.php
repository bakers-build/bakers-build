<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicket;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;

/**
 * Working vs not: filled disc while the phase is running, empty ring otherwise.
 *
 * Feature `coding` and epic `active` are both the running phase. Same label
 * source as TicketStateCellFormatter, so the icon and the badge never name a
 * state differently. The tooltip is the workflow's own label.
 */
#[FieldFormatter(
  id: 'bb_ticket_state_icon_cell',
  label: new TranslatableMarkup('Table cell: state icon'),
  description: new TranslatableMarkup('Filled disc while the phase is running, empty ring otherwise; named by the workflow label.'),
  field_types: ['state'],
)]
final class TicketStateIconCellFormatter extends FormatterBase {

  use TicketCellRenderTrait;

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $ticket = $items->getEntity();
    $working = $ticket instanceof BbTicket && $this->isRunningPhase($ticket);
    $elements = [];
    foreach ($items as $delta => $item) {
      if (!$item instanceof StateItemInterface) {
        continue;
      }
      $label = (string) ($item->getLabel() ?? $item->getId());
      if ($label === '') {
        continue;
      }
      $elements[$delta] = $this->cellElement([
        'kind' => 'status',
        'label' => $label,
        'working' => $working,
      ]);
    }
    return $elements;
  }

  /**
   * TRUE when the ticket's stored state is the running phase.
   */
  private function isRunningPhase(BbTicket $ticket): bool {
    $workflow = (string) ($ticket->get('workflow')->value ?? '');
    $state = (string) ($ticket->get('state')->value ?? '');
    if (TypeWorkflows::stateMetadata($workflow, $state) === []) {
      return FALSE;
    }
    return TypeWorkflows::phase($workflow, $state) === 'running';
  }

}
