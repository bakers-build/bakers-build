<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\ui_patterns\Attribute\Source;

/**
 * The `New ticket` affordance, for whatever slot a screen puts it in.
 *
 * A ui_patterns Source so it is placed from configuration by plugin id and
 * survives restructures of the screen that composes it. With JavaScript off
 * the `href` navigates to a real page carrying the same dialog. Everything
 * but the subject lives in `CreateActionSourceBase`.
 */
#[Source(
  id: 'bb_ticket_create_action',
  label: new TranslatableMarkup('[bakers.build] New ticket action'),
  description: new TranslatableMarkup('The add action that opens the create-ticket dialog over the current screen.'),
  prop_types: ['slot'],
)]
final class TicketCreateActionSource extends CreateActionSourceBase {

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return 'entity.bb_ticket.create_form';
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) $this->t('New ticket');
  }

  /**
   * {@inheritdoc}
   *
   * Yes: `?project=…` is the ticket list's project facet, which the dialog's
   * project picker opens with.
   */
  protected function forwardsScreenQuery(): bool {
    return TRUE;
  }

  /**
   * {@inheritdoc}
   */
  protected function appliesToCurrentRoute(): bool {
    return str_starts_with((string) $this->routeMatch->getRouteName(), 'view.tickets.');
  }

  /**
   * {@inheritdoc}
   *
   * The per-project ticket list carries its project as the `bb_project`
   * ROUTE parameter
   * (`/_workspace/{bb_workspace}/project/{bb_project}/tickets`), which
   * the forwarded screen query never carries. Binding the dialog to that
   * project is what AC-1 asks for; a global ticket list without that route
   * parameter forces nothing here and the dialog falls back to any
   * forwarded `project` facet.
   */
  protected function routeBoundQuery(): array {
    $project = $this->routeMatch->getParameter('bb_project');
    return $project instanceof BbProjectInterface ? ['project' => (string) $project->id()] : [];
  }

}
