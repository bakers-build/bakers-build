<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Resource;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Drupal\jsonapi\ResourceResponse;
use Drupal\user\UserInterface;
use Drupal\jsonapi_resources\Resource\ResourceBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Route;

/**
 * A conductor's inbox: its pending messages.
 *
 * `worktree_path` comes from the newest run of the ticket on this conductor.
 */
final class InboxPendingResource extends ResourceBase implements ContainerInjectionInterface {

  use PlainResourceTrait;

  private const TYPE = 'bb_inbox';

  /**
   * Seconds a running message may go unanswered.
   *
   * The conductor's 60 s handler timeout plus a margin for a tick and the
   * writes around it.
   */
  private const ANSWER_WINDOW = 180;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly AccountInterface $currentUser,
    private readonly TimeInterface $time,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('entity_type.manager'),
      $container->get('current_user'),
      $container->get('datetime.time'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getRouteResourceTypes(Route $route, string $route_name): array {
    return [self::plainResourceType(self::TYPE, ['messages'])];
  }

  /**
   * Handles the inbox GET.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The request.
   * @param string $conductor_id
   *   The conductor's registration id (its `conductor_id` field).
   *
   * @return \Drupal\jsonapi\ResourceResponse
   *   200 with `messages`.
   */
  public function process(Request $request, string $conductor_id): ResourceResponse {
    $conductor = $this->ownConductor($conductor_id);
    $this->failStaleRunning($conductor);
    $paths = [];
    $messages = [];
    foreach ($this->pendingMessages($conductor) as $message) {
      $ticket = $message->ticket();
      $tid = (int) $ticket?->id();
      $paths[$tid] ??= $this->worktreePath($tid, $conductor);
      $requester = $message->get('requested_by')->entity;
      $messages[] = [
        'id' => $message->uuid(),
        'message_id' => $message->messageId(),
        'version' => (string) $message->get('version')->value,
        'ticket' => $ticket?->uuid(),
        'payload' => $message->payload(),
        'worktree_path' => $paths[$tid],
        'requested_by' => $requester instanceof UserInterface ? $requester->uuid() : NULL,
      ];
    }
    return $this->plainResponse($request, self::plainResourceType(self::TYPE, ['messages']), $conductor->uuid(), [
      'messages' => $messages,
    ]);
  }

  /**
   * The conductor with that registration id, owned by the current user.
   */
  private function ownConductor(string $conductor_id): BbConductorInterface {
    $conductors = $this->entityTypeManager->getStorage('bb_conductor')
      ->loadByProperties(['conductor_id' => $conductor_id]);
    $conductor = reset($conductors);
    if (!$conductor instanceof BbConductorInterface) {
      throw new NotFoundHttpException('No such conductor.');
    }
    if (!$conductor->isOwnedBy($this->currentUser)) {
      throw new AccessDeniedHttpException('Only the conductor owner reads its inbox.');
    }
    return $conductor;
  }

  /**
   * Fails running messages left unanswered past the answer window.
   *
   * A conductor that restarted mid-handler, or lost its result write, never
   * fetches a running message again; without this it would stay running and
   * every open panel would poll it forever.
   */
  private function failStaleRunning(BbConductorInterface $conductor): void {
    $storage = $this->entityTypeManager->getStorage('bb_inbox_message');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('conductor_id', $conductor->id())
      ->condition('status', BbInboxMessageInterface::STATUS_RUNNING)
      ->condition('changed', $this->time->getRequestTime() - self::ANSWER_WINDOW, '<')
      ->execute();
    foreach ($storage->loadMultiple($ids) as $message) {
      if ($message instanceof BbInboxMessageInterface) {
        $message->setResult(BbInboxMessageInterface::STATUS_FAILED, [
          'markdown' => 'The conductor did not answer in time.',
        ])->save();
      }
    }
  }

  /**
   * Pending messages of the conductor, oldest first.
   *
   * @return \Drupal\bb_inbox\Entity\BbInboxMessageInterface[]
   *   The messages.
   */
  private function pendingMessages(BbConductorInterface $conductor): array {
    $storage = $this->entityTypeManager->getStorage('bb_inbox_message');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('conductor_id', $conductor->id())
      ->condition('status', BbInboxMessageInterface::STATUS_PENDING)
      ->sort('id')
      ->execute();
    return array_values(array_filter(
      $storage->loadMultiple($ids),
      static fn ($m) => $m instanceof BbInboxMessageInterface,
    ));
  }

  /**
   * The newest run's worktree path of a ticket on this conductor.
   */
  private function worktreePath(int $ticket_id, BbConductorInterface $conductor): ?string {
    $ids = $this->entityTypeManager->getStorage('bb_run')->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket_id)
      ->condition('conductor_id', $conductor->id())
      ->exists('worktree_path')
      ->condition('worktree_path', '', '<>')
      ->sort('id', 'DESC')
      ->range(0, 1)
      ->execute();
    if ($ids === []) {
      return NULL;
    }
    $run = $this->entityTypeManager->getStorage('bb_run')->load(reset($ids));
    return $run instanceof BbRunInterface ? (string) $run->get('worktree_path')->value : NULL;
  }

}
