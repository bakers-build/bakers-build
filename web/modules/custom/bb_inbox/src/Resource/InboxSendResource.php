<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Resource;

use Drupal\Core\Access\AccessException;
use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_inbox\InboxRejected;
use Drupal\bb_inbox\InboxSender;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi_resources\Resource\EntityResourceBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Sends a message about a ticket: `{ticket, message_id, payload}`.
 *
 * Generic JSON:API create cannot see the ticket when it checks create access,
 * so people send through here; the responsible handler decides access.
 */
final class InboxSendResource extends EntityResourceBase implements ContainerInjectionInterface {

  use PlainResourceTrait;

  public function __construct(
    EntityTypeManagerInterface $entity_type_manager,
    private readonly AccountInterface $currentUser,
    private readonly InboxSender $sender,
  ) {
    $this->entityTypeManager = $entity_type_manager;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('entity_type.manager'),
      $container->get('current_user'),
      $container->get('bb_inbox.sender'),
    );
  }

  /**
   * Handles the send POST.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The request carrying data.attributes.
   *
   * @return \Drupal\jsonapi\ResourceResponse
   *   201 with the pending message.
   */
  public function process(Request $request): ResourceResponse {
    $attributes = $this->requestAttributes($request);
    $ticket = $this->loadTicket((string) ($attributes['ticket'] ?? ''));
    $payload = $attributes['payload'] ?? [];
    if (!is_array($payload)) {
      throw new UnprocessableEntityHttpException('The payload must be an object.');
    }
    try {
      $message = $this->sender->send($ticket, (string) ($attributes['message_id'] ?? ''), $payload, $this->currentUser);
    }
    catch (InboxRejected $e) {
      throw new UnprocessableEntityHttpException($e->getMessage(), $e);
    }
    catch (AccessException $e) {
      throw new AccessDeniedHttpException($e->getMessage(), $e);
    }
    return $this->createJsonapiResponse($this->createIndividualDataFromEntity($message), $request, 201);
  }

  /**
   * Loads a ticket the current user may view, by UUID.
   */
  private function loadTicket(string $uuid): BbTicketInterface {
    $tickets = $uuid === '' ? [] : $this->entityTypeManager->getStorage('bb_ticket')->loadByProperties(['uuid' => $uuid]);
    $ticket = reset($tickets);
    if (!$ticket instanceof BbTicketInterface || !$ticket->access('view', $this->currentUser)) {
      throw new NotFoundHttpException('Ticket not found.');
    }
    return $ticket;
  }

}
