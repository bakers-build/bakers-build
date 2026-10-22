<?php

declare(strict_types=1);

namespace Drupal\bb_core\Resource;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Resolves the conductor registration owned by the authenticated user.
 */
trait ConductorResolverTrait {

  /**
   * The current user account, injected by the consuming class.
   *
   * @var \Drupal\Core\Session\AccountInterface
   */
  private readonly AccountInterface $currentUser;

  /**
   * Resolves the conductor entity owned by the authenticated user.
   *
   * Optionally filters by the conductor_id attribute (legacy machine_id alias)
   * included in the request body. Throws HTTP exceptions when the user lacks
   * permission or no matching conductor registration exists.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The incoming HTTP request, possibly containing a conductor_id attribute.
   *
   * @return \Drupal\bb_core\Entity\BbConductorInterface
   *   The matching conductor entity.
   *
   * @throws \Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException
   *   When the current user does not have the 'claim bakers tickets'
   *   permission.
   * @throws \Symfony\Component\HttpKernel\Exception\NotFoundHttpException
   *   When no conductor registration is found for the current user.
   */
  private function resolveConductor(Request $request): BbConductorInterface {
    if (!$this->currentUser->hasPermission('claim bakers tickets')) {
      throw new AccessDeniedHttpException('The current user may not claim bakers.build tickets.');
    }
    $attributes = $this->requestAttributes($request);
    $query = $this->entityTypeManager->getStorage('bb_conductor')->getQuery()
      ->accessCheck(FALSE)
      ->condition('owner_user_id', $this->currentUser->id())
      ->range(0, 1);
    $registrationId = $this->registrationIdFromAttributes($attributes);
    if ($registrationId !== '') {
      $query->condition('conductor_id', $registrationId);
    }
    $ids = $query->execute();
    if ($ids === []) {
      throw new NotFoundHttpException('No bakers.build conductor registration found for the current user.');
    }
    $conductor = $this->entityTypeManager->getStorage('bb_conductor')->load(reset($ids));
    if (!$conductor instanceof BbConductorInterface) {
      throw new NotFoundHttpException('No bakers.build conductor registration found for the current user.');
    }
    return $conductor;
  }

  /**
   * Reads conductor_id, accepting legacy machine_id as an alias.
   *
   * @param array<string, mixed> $attributes
   *   Request data.attributes map.
   */
  private function registrationIdFromAttributes(array $attributes): string {
    if (isset($attributes['conductor_id']) && is_string($attributes['conductor_id']) && $attributes['conductor_id'] !== '') {
      return $attributes['conductor_id'];
    }
    if (isset($attributes['machine_id']) && is_string($attributes['machine_id']) && $attributes['machine_id'] !== '') {
      return $attributes['machine_id'];
    }
    return '';
  }

  /**
   * Decodes and returns the data.attributes map from the JSON:API request body.
   *
   * Returns an empty array when the body is absent or does not conform to the
   * expected JSON:API structure.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The incoming HTTP request.
   *
   * @return array<string, mixed>
   *   The decoded attributes map, or an empty array.
   */
  private function requestAttributes(Request $request): array {
    $raw = $request->getContent();
    if ($raw === '') {
      return [];
    }
    $decoded = json_decode($raw, TRUE);
    return is_array($decoded) && isset($decoded['data']['attributes']) && is_array($decoded['data']['attributes'])
      ? $decoded['data']['attributes']
      : [];
  }

  /**
   * Extracts the lease_seconds attribute from the request body.
   *
   * Falls back to 300 seconds when the attribute is absent or non-numeric.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The incoming HTTP request.
   *
   * @return int
   *   The requested lease duration in seconds.
   */
  private function leaseSeconds(Request $request): int {
    $attributes = $this->requestAttributes($request);
    return isset($attributes['lease_seconds']) && is_numeric($attributes['lease_seconds'])
      ? (int) $attributes['lease_seconds']
      : 300;
  }

}
