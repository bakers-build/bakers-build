<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Island;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\bb_addon\AddonRepository;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\island\IslandContextProviderInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Hosts the addon panel of the ticket Addons overlay.
 *
 * On the overlay route the ticket and addon come from the route; on the
 * island action POST, which has no such route, from the action's query.
 */
final class AddonsIslandHost implements IslandContextProviderInterface {

  public const HOST_ID = 'ticket_addons';
  public const PANEL = 'addon_panel';

  public function __construct(
    private readonly RouteMatchInterface $routeMatch,
    private readonly RequestStack $requestStack,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly AddonRepository $repository,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function hostId(): string {
    return self::HOST_ID;
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandIds(): array {
    return [self::PANEL];
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandConfiguration(string $island_id): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandData(string $island_id): array {
    $ticket = $this->ticket();
    if ($ticket === NULL) {
      return [];
    }
    $addons = $this->repository->forTicket($ticket);
    $name = (string) ($this->routeMatch->getParameter('addon_name')
      ?: $this->requestStack->getCurrentRequest()?->query->get('addon', ''));
    $addon = $addons[$name] ?? ($name === '' ? reset($addons) : NULL);
    return $addon ? ['ticket' => $ticket, 'addon' => $addon] : [];
  }

  /**
   * The ticket from the route, else from the `ticket` query parameter.
   */
  private function ticket(): ?BbTicketInterface {
    $ticket = $this->routeMatch->getParameter('bb_ticket');
    if ($ticket instanceof BbTicketInterface) {
      return $ticket;
    }
    $uuid = (string) $this->requestStack->getCurrentRequest()?->query->get('ticket', '');
    $tickets = $uuid === '' ? [] : $this->entityTypeManager->getStorage('bb_ticket')->loadByProperties(['uuid' => $uuid]);
    $ticket = reset($tickets);
    return $ticket instanceof BbTicketInterface ? $ticket : NULL;
  }

}
