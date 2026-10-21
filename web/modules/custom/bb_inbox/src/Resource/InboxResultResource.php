<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Resource;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi_resources\Resource\EntityResourceBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * The conductor answers a message: `{status, result}`.
 */
final class InboxResultResource extends EntityResourceBase implements ContainerInjectionInterface {

  public function __construct(
    EntityTypeManagerInterface $entity_type_manager,
    private readonly AccountInterface $currentUser,
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
    );
  }

  /**
   * Handles the result POST.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The request carrying data.attributes.
   * @param \Drupal\bb_inbox\Entity\BbInboxMessageInterface $bb_inbox_message
   *   The message, resolved from the URL.
   *
   * @return \Drupal\jsonapi\ResourceResponse
   *   200 with the updated message.
   */
  public function process(Request $request, BbInboxMessageInterface $bb_inbox_message): ResourceResponse {
    if (!$bb_inbox_message->access('update', $this->currentUser)) {
      throw new AccessDeniedHttpException('Only the conductor owner may answer this message.');
    }
    // Decoded as objects: an associative decode would store a nested `{}`
    // as `[]`, which the result contract then rejects.
    $body = json_decode($request->getContent());
    $attributes = is_object($body) && isset($body->data->attributes) ? $body->data->attributes : new \stdClass();
    $result = $attributes->result ?? NULL;
    if ($result !== NULL && !is_object($result)) {
      throw new UnprocessableEntityHttpException('The result must be an object.');
    }
    $bb_inbox_message->setResult((string) ($attributes->status ?? ''), $result);
    $messages = [];
    foreach ($bb_inbox_message->validate() as $violation) {
      $messages[] = (string) $violation->getMessage();
    }
    if ($messages !== []) {
      throw new UnprocessableEntityHttpException(implode('; ', $messages));
    }
    $bb_inbox_message->save();
    return $this->createJsonapiResponse($this->createIndividualDataFromEntity($bb_inbox_message), $request, 200);
  }

}
