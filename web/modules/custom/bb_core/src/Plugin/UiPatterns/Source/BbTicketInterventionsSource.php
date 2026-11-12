<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * The Properties footer: Restart, Freeze, Unfreeze, Cancel ticket, Settings.
 *
 * AI agents drive the workflow; this footer offers only interventions.
 */
#[Source(
  id: 'bb_ticket_interventions',
  label: new TranslatableMarkup('[bakers.build] Ticket interventions'),
  description: new TranslatableMarkup('Restart, freeze, unfreeze, cancel ticket and the Settings entry of a ticket.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', label: new TranslatableMarkup('Ticket'), required: TRUE),
  ],
)]
final class BbTicketInterventionsSource extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $build = [];
    $ticket = $this->ticket();
    if ($ticket === NULL) {
      return $build;
    }
    $parked_run = TicketInterventions::parkedRun($ticket);
    if ($parked_run !== NULL && TicketInterventions::mayCancelRun($parked_run, $ticket)) {
      $build['restart'] = $this->dialogButton(
        (string) $this->t('Restart ticket'),
        TicketInterventions::confirmationUrl($ticket, $parked_run, FALSE),
        TicketInterventions::confirmationUrl($ticket, $parked_run, TRUE),
        'neutral',
      );
    }
    if (TicketInterventions::mayUnfreeze($ticket)) {
      $build['unfreeze'] = $this->dialogButton(
        (string) $this->t('Unfreeze ticket'),
        TicketInterventions::freezeUrl($ticket, FALSE, FALSE),
        TicketInterventions::freezeUrl($ticket, FALSE, TRUE),
        'neutral',
      );
    }
    elseif (TicketInterventions::mayFreeze($ticket)) {
      $build['freeze'] = $this->dialogButton(
        (string) $this->t('Freeze ticket'),
        TicketInterventions::freezeUrl($ticket, TRUE, FALSE),
        TicketInterventions::freezeUrl($ticket, TRUE, TRUE),
        'neutral',
      );
    }
    if (TicketInterventions::mayCancelTicket($ticket)) {
      $build['cancel'] = $this->dialogButton(
        (string) $this->t('Cancel ticket'),
        TicketInterventions::confirmationUrl($ticket, NULL, FALSE),
        TicketInterventions::confirmationUrl($ticket, NULL, TRUE),
      );
    }
    // A closed ticket is frozen, so it gets no Settings entry.
    $settings = $ticket->toUrl('edit-form');
    if ($ticket->get('title')->access('edit') && $settings->access()) {
      $build['settings'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => [
          'label' => (string) $this->t('More settings'),
          'href' => $settings->toString(),
          'variant' => 'ghost',
        ],
      ];
    }
    CacheableMetadata::createFromObject($ticket)
      ->addCacheContexts(['user', 'url.path'])
      // Restart depends on the ticket's runs.
      ->addCacheTags(['og_membership_list', 'bb_run_list'])
      ->applyTo($build);
    return $build;
  }

  /**
   * A button that opens its confirmation in the overlay.
   *
   * @param string $label
   *   The visible label.
   * @param \Drupal\Core\Url $page
   *   The confirmation as a plain page, the no-JavaScript target.
   * @param \Drupal\Core\Url $dialog
   *   The confirmation through the dialog wrapper format.
   * @param string $variant
   *   The button variant.
   *
   * @return array<string, mixed>
   *   The button render array.
   */
  private function dialogButton(string $label, Url $page, Url $dialog, string $variant = 'danger'): array {
    // The create-trigger contract: the overlay is the target, and only the
    // answer's `dialog` element is swapped in.
    $attributes = (new Htmx())->get($dialog)->target('#bakers-overlay')->select('dialog')->swap('innerHTML')
      ->getAttributes();
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      // The dialog's own libraries arrive too late for the first click.
      '#attached' => ['library' => ['core/drupal.htmx']],
      '#props' => [
        'label' => $label,
        'href' => $page->toString(),
        'variant' => $variant,
        'attributes' => $attributes,
      ],
    ];
  }

  /**
   * Returns the ticket context, if present.
   */
  private function ticket(): ?BbTicketInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbTicketInterface ? $entity : NULL;
  }

}
