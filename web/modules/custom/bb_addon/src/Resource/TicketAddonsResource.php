<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Resource;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_addon\AddonReadModel;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_inbox\Resource\PlainResourceTrait;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi_resources\Resource\ResourceBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Route;

/**
 * The addons of a ticket's conductor, as the TUI reads them.
 */
final class TicketAddonsResource extends ResourceBase implements ContainerInjectionInterface {

  use PlainResourceTrait;

  private const TYPE = 'bb_ticket_addons';
  private const FIELDS = ['conductor', 'addons'];

  public function __construct(
    private readonly AccountInterface $currentUser,
    private readonly AddonReadModel $readModel,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('current_user'),
      $container->get('bb_addon.read_model'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getRouteResourceTypes(Route $route, string $route_name): array {
    return [self::plainResourceType(self::TYPE, self::FIELDS)];
  }

  /**
   * Handles the read model GET.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The request.
   * @param \Drupal\bb_core\Entity\BbTicketInterface $bb_ticket
   *   The ticket, resolved from the URL.
   *
   * @return \Drupal\jsonapi\ResourceResponse
   *   200 with `conductor` and `addons`.
   */
  public function process(Request $request, BbTicketInterface $bb_ticket): ResourceResponse {
    return $this->plainResponse(
      $request,
      self::plainResourceType(self::TYPE, self::FIELDS),
      (string) $bb_ticket->uuid(),
      $this->readModel->forTicket($bb_ticket, $this->currentUser),
    );
  }

}
