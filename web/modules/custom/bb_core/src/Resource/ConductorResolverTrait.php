<?php

declare(strict_types=1);

namespace Drupal\bb_core\Resource;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

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
   * The request body's `conductor` attribute is the conductor UUID the
   * heartbeat returned. Throws HTTP exceptions when the user lacks
   * permission, the body carries an old CLI's identity, or no matching
   * conductor of the user exists.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The incoming HTTP request carrying the conductor attribute.
   *
   * @return \Drupal\bb_core\Entity\BbConductorInterface
   *   The matching conductor entity.
   *
   * @throws \Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException
   *   When the current user does not have the 'claim bakers tickets'
   *   permission.
   * @throws \Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException
   *   When the body carries `conductor_id` or `machine_id`, or no conductor.
   * @throws \Symfony\Component\HttpKernel\Exception\NotFoundHttpException
   *   When no conductor registration is found for the current user.
   */
  private function resolveConductor(Request $request): BbConductorInterface {
    if (!$this->currentUser->hasPermission('claim bakers tickets')) {
      throw new AccessDeniedHttpException('The current user may not claim bakers.build tickets.');
    }
    $attributes = $this->requestAttributes($request);
    foreach (['conductor_id', 'machine_id'] as $stale) {
      if (array_key_exists($stale, $attributes)) {
        throw new UnprocessableEntityHttpException(sprintf('%s is no longer accepted; update bakers and run `bakers init`.', $stale));
      }
    }
    $uuid = $attributes['conductor'] ?? NULL;
    if (!is_string($uuid) || $uuid === '') {
      throw new UnprocessableEntityHttpException('conductor (the conductor UUID) is required.');
    }
    $conductors = $this->entityTypeManager->getStorage('bb_conductor')->loadByProperties([
      'uuid' => $uuid,
      'owner_user_id' => $this->currentUser->id(),
    ]);
    $conductor = reset($conductors);
    if (!$conductor instanceof BbConductorInterface) {
      throw new NotFoundHttpException('No bakers.build conductor registration found for the current user.');
    }
    return $conductor;
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
