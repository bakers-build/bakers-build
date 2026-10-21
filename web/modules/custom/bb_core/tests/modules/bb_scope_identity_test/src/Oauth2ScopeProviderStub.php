<?php

declare(strict_types=1);

namespace Drupal\bb_scope_identity_test;

use Drupal\Core\State\StateInterface;
use Drupal\simple_oauth\Oauth2ScopeInterface;
use Drupal\simple_oauth\Oauth2ScopeProviderInterface;

/**
 * A minimal, state-driven Oauth2ScopeProviderInterface.
 *
 * Modelled on ScopeCeilingAccessPolicy. Backs
 * `BbRankCapability::hasSiteWidePermission()`'s machine-identity
 * branch (BB-462 D9) in a Kernel test, without simple_oauth installed: the
 * branch asks the REAL injected service for `scopeHasPermission()`, and that
 * has to resolve to something at container-compile time — a runtime
 * `$container->set()` cannot retrofit an optional `@?` reference once the
 * consuming service has already been compiled with NULL baked in.
 *
 * Only `scopeHasPermission()` is exercised by bakers.build's own code. Every other
 * method of the two interfaces this class satisfies is unreachable from that
 * path and returns the cheapest empty/NULL answer its return type allows.
 *
 * @see \Drupal\bb_scope_identity_test\Access\ScopeCeilingAccessPolicy
 * @see \Drupal\bb_core\Access\BbRankCapability
 */
final class Oauth2ScopeProviderStub implements Oauth2ScopeProviderInterface {

  /**
   * State key holding the permission list the simulated scope grants.
   *
   * The same key `ScopeCeilingAccessPolicy` uses: one state write configures
   * both the Layer A overwrite and this Layer B answer, because a real
   * client_credentials token's scope decides both from the same set.
   */
  public const STATE_PERMISSIONS = 'bb_scope_identity_test.permissions';

  public function __construct(private readonly StateInterface $state) {}

  /**
   * {@inheritdoc}
   */
  public function scopeHasPermission(string $permission, Oauth2ScopeInterface $scope): bool {
    /** @var array<string> $granted */
    $granted = $this->state->get(self::STATE_PERMISSIONS, []);
    return in_array($permission, $granted, TRUE);
  }

  /**
   * {@inheritdoc}
   */
  public function getRoles(Oauth2ScopeInterface $scope, bool $exclude_locked_roles = FALSE): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function getPermissions(Oauth2ScopeInterface $scope): array {
    /** @var array<string> $granted */
    $granted = $this->state->get(self::STATE_PERMISSIONS, []);
    return $granted;
  }

  /**
   * {@inheritdoc}
   */
  public function load(string $id) {
    return NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function loadMultiple(?array $ids = NULL): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function loadByName(string $name): ?Oauth2ScopeInterface {
    return NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function loadMultipleByNames(array $names): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function loadChildren(string $parent_id): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function loadByGrantType(string $grant_type): array {
    return [];
  }

}
