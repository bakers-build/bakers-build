<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Resource;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_addon\AddonRepository;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Drupal\bb_inbox\Resource\PlainResourceTrait;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi_resources\Resource\ResourceBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Route;

/**
 * This person's own earlier messages for a ticket (BB-661 AC-4).
 *
 * Requester selection happens here, server-side, never client-only: the
 * route only requires ticket view access, but every returned message is
 * additionally constrained to `requested_by = current user` — another
 * person's message is never included, regardless of ticket access.
 */
final class TicketMessagesResource extends ResourceBase {

  use PlainResourceTrait;

  private const TYPE = 'bb_ticket_messages';
  private const FIELDS = ['messages'];

  /**
   * The page size: 20 requests per page, per the spec.
   */
  private const PAGE_SIZE = 20;

  public function __construct(
    private readonly AccountInterface $currentUser,
    private readonly AddonRepository $repository,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('current_user'),
      $container->get('bb_addon.repository'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getRouteResourceTypes(Route $route, string $route_name): array {
    return [self::plainResourceType(self::TYPE, self::FIELDS)];
  }

  /**
   * Handles the history GET.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The request; `addon` and `before` are optional query parameters.
   * @param \Drupal\bb_core\Entity\BbTicketInterface $bb_ticket
   *   The ticket, resolved from the URL; view access already enforced by the
   *   route.
   *
   * @return \Drupal\jsonapi\ResourceResponse
   *   200 with this person's own `messages`, newest first.
   */
  public function process(Request $request, BbTicketInterface $bb_ticket): ResourceResponse {
    $addon = $request->query->get('addon');
    $before = $request->query->get('before');
    $messages = $this->repository->historyFor(
      $bb_ticket,
      $this->currentUser,
      is_string($addon) && $addon !== '' ? $addon : NULL,
      is_string($before) && $before !== '' ? $before : NULL,
      self::PAGE_SIZE,
    );
    return $this->plainResponse(
      $request,
      self::plainResourceType(self::TYPE, self::FIELDS),
      (string) $bb_ticket->uuid(),
      ['messages' => array_map(static fn ($m) => self::summarize($m), $messages)],
    );
  }

  /**
   * One message's list entry.
   *
   * @return array<string, mixed>
   *   id, message_id, status, created, changed.
   */
  private static function summarize(BbInboxMessageInterface $message): array {
    return [
      'id' => (string) $message->uuid(),
      'message_id' => $message->messageId(),
      'status' => $message->status(),
      'created' => (int) $message->get('created')->value,
      'changed' => (int) $message->get('changed')->value,
    ];
  }

}
