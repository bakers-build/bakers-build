<?php

declare(strict_types=1);

namespace Drupal\bb_track\Controller;

use Drupal\Component\Uuid\Uuid;
use Drupal\Core\Controller\ControllerBase;
use Drupal\bb_track\WorkActivityInput;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Narrow authenticated activity ingress; never an approval API.
 */
final class WorkActivityController extends ControllerBase {

  /**
   * Constructs the input adapter.
   */
  public function __construct(private WorkActivityInput $activities) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('bb_track.activity_input'));
  }

  /**
   * Accepts one attributed activity with bounded JSON, without remote fetches.
   */
  public function input(Request $request): JsonResponse {
    try {
      if (strlen($request->getContent()) > 131072 || $request->getContentTypeFormat() !== 'json') {
        return new JsonResponse([
          'error' => 'Supply at most 128 KiB of application/json.',
        ], 400);
      }
      $input = json_decode($request->getContent(), TRUE, 16, JSON_THROW_ON_ERROR);
      if (!is_array($input) || array_is_list($input)) {
        throw new \InvalidArgumentException('Supply one activity object.');
      }
      $input = $this->references($input);
      $activity = $this->activities->input($input);
      return new JsonResponse([
        'id' => $activity->uuid(),
        'revision' => (int) $activity->get('source_revision')->value,
        'account_id' => $activity->get('account_id')->entity?->uuid(),
      ], 200, [
        'Cache-Control' => 'private, no-store',
      ]);
    }
    catch (\InvalidArgumentException | \JsonException $error) {
      return new JsonResponse([
        'error' => $error->getMessage(),
      ], 400);
    }
    catch (\DomainException $error) {
      return new JsonResponse([
        'error' => $error->getMessage(),
      ], 409);
    }
    catch (\Throwable $error) {
      $this->getLogger('bb_track')->error('Activity input failed: @message', [
        '@message' => $error->getMessage(),
      ]);
      return new JsonResponse([
        'error' => 'Activity could not be stored. Refresh and retry.',
      ], 409);
    }
  }

  /**
   * Resolves only viewable reference UUIDs at the HTTP boundary.
   */
  private function references(array $input): array {
    foreach ([
      'project_id' => 'bb_project',
      'ticket_id' => 'bb_ticket',
      'submission_id' => 'bb_track_submission',
      'account_id' => 'bb_track_account',
    ] as $field => $type) {
      if (!isset($input[$field])) {
        continue;
      }
      if (!is_string($input[$field]) || !Uuid::isValid($input[$field])) {
        throw new \InvalidArgumentException('Project, ticket, submission and billing account references must be UUIDs.');
      }
      $entity = $this->entityTypeManager()->getStorage($type)->loadByProperties([
        'uuid' => $input[$field],
      ]);
      $entity = $entity ? reset($entity) : NULL;
      if (!$entity || !$entity->access('view', $this->currentUser())) {
        throw new \DomainException('Assignment unavailable.');
      }
      $input[$field] = (int) $entity->id();
    }
    return $input;
  }

}
