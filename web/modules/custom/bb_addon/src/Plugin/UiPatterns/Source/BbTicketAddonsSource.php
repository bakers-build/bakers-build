<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_addon\AddonRepository;
use Drupal\bb_addon\Controller\TicketAddonsController;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The ticket's Addons card: always inline in the right column (BB-661).
 *
 * No overlay, no dialog, no button to open it — present whenever the
 * ticket's conductor runs an addon, empty otherwise.
 */
#[Source(
  id: 'bb_ticket_addons',
  label: new TranslatableMarkup('[bakers.build] Ticket addons'),
  description: new TranslatableMarkup('The ticket Addons card, inline, for a ticket whose conductor runs addons.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', label: new TranslatableMarkup('Ticket'), required: TRUE),
  ],
)]
final class BbTicketAddonsSource extends SourcePluginBase {

  /**
   * Tells whether the ticket's conductor runs addons.
   */
  private AddonRepository $repository;

  /**
   * Builds the card.
   */
  private TicketAddonsController $controller;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $source = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $source->repository = $container->get('bb_addon.repository');
    $source->controller = TicketAddonsController::create($container);
    return $source;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $build = [];
    $ticket = $this->ticket();
    if ($ticket !== NULL && $this->repository->forTicket($ticket) !== []) {
      $build = $this->controller->overlay($ticket);
    }
    if ($ticket !== NULL) {
      CacheableMetadata::createFromObject($ticket)
        ->addCacheTags(['bb_addon_list'])
        ->addCacheContexts(['user'])
        ->applyTo($build);
    }
    return $build;
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
