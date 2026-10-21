<?php

declare(strict_types=1);

namespace Drupal\bb_scope_identity_test;

use Drupal\simple_oauth\Oauth2ScopeInterface;
use Drupal\simple_oauth\Plugin\ScopeGranularityInterface;

/**
 * A single scope object a fake token can name in its `scopes` field.
 *
 * `Oauth2ScopeProviderStub::scopeHasPermission()` never inspects it — the
 * answer comes entirely from state — so every method here is a placeholder
 * that satisfies the interface without carrying meaning.
 *
 * @see \Drupal\bb_scope_identity_test\Oauth2ScopeProviderStub
 */
final class FakeScope implements Oauth2ScopeInterface {

  /**
   * {@inheritdoc}
   */
  public function id() {
    return 'bb:session';
  }

  /**
   * {@inheritdoc}
   */
  public function getName(): string {
    return 'bb:session';
  }

  /**
   * {@inheritdoc}
   */
  public function getDescription(): string {
    return '';
  }

  /**
   * {@inheritdoc}
   */
  public function getGrantTypes(): array {
    return ['client_credentials'];
  }

  /**
   * {@inheritdoc}
   */
  public function getGrantTypeDescription(string $grant_type): ?string {
    return NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function isGrantTypeEnabled(string $grant_type): bool {
    return $grant_type === 'client_credentials';
  }

  /**
   * {@inheritdoc}
   */
  public function isUmbrella(): bool {
    return TRUE;
  }

  /**
   * {@inheritdoc}
   */
  public function getParent(): ?string {
    return NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getGranularity(): ?ScopeGranularityInterface {
    return NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getPermissions(): array {
    return [];
  }

}
