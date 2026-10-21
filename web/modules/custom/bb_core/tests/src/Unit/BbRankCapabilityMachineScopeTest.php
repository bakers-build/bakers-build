<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Tests\UnitTestCase;
use Drupal\bb_core\Access\BbRankCapability;
use Drupal\bb_core\Access\MembershipResolutionGuard;
use Drupal\simple_oauth\Authentication\TokenAuthUserInterface;
use Drupal\simple_oauth\Entity\Oauth2TokenInterface;
use Drupal\simple_oauth\Oauth2ScopeInterface;
use Drupal\simple_oauth\Oauth2ScopeProviderInterface;
use Drupal\simple_oauth\Plugin\Field\FieldType\Oauth2ScopeReferenceItemListInterface;
use PHPUnit\Framework\Attributes\Group;
use Psr\Log\LoggerInterface;

/**
 * A pure machine identity's site-wide answer comes from its token's scopes.
 *
 * BB-462 D9: removing the workspace `app` rank means a client_credentials
 * identity no longer holds any OG rank at all, so `BbGroupScopedAccount`'s
 * fallback to `hasGroupPermission()` would find nothing and every conductor
 * write measured by `MachineIdentityWriteSufficiencyTest` would become
 * unreachable again. `BbRankCapability::hasSiteWidePermission()` closes
 * that gap by reading a `TokenAuthUserInterface` account's scopes directly,
 * for exactly the `auth_user_id`-empty case `Oauth2AccessPolicy` treats as a
 * wholesale permission overwrite.
 *
 * A Unit test with mocked collaborators rather than a Kernel test with a real
 * `simple_oauth` token, because the property under test is entirely in the
 * branching logic of one method — the real integration (does a live token
 * really produce a `TokenAuthUserInterface` decorator that behaves this way)
 * is `simple_oauth`'s own contract, not this module's.
 *
 * @see \Drupal\bb_core\Access\BbRankCapability
 * @see \Drupal\bb_core\Access\BbGroupScopedAccount
 */
#[Group('bb_core')]
final class BbRankCapabilityMachineScopeTest extends UnitTestCase {

  /**
   * A token account whose scope grants the permission answers TRUE.
   */
  public function testTokenAccountWithGrantingScopeAnswersTrue(): void {
    $scope = $this->createMock(Oauth2ScopeInterface::class);
    $account = $this->tokenAccount([$scope]);

    $scope_provider = $this->createMock(Oauth2ScopeProviderInterface::class);
    $scope_provider->method('scopeHasPermission')
      ->with('register bakers conductor', $scope)
      ->willReturn(TRUE);

    $capability = $this->capability($scope_provider);

    self::assertTrue($capability->hasSiteWidePermission($account, 'register bakers conductor'));
  }

  /**
   * A token account whose scopes do not grant the permission answers FALSE.
   *
   * Deliberately NOT falling through to a role check: the whole point of the
   * `auth_user_id`-empty branch is that `Oauth2AccessPolicy` OVERWRITES the
   * calculated set rather than adding to it, so a role the account happens to
   * carry (there should be none in production) must not rescue the answer.
   */
  public function testTokenAccountWithoutGrantingScopeAnswersFalse(): void {
    $scope = $this->createMock(Oauth2ScopeInterface::class);
    $account = $this->tokenAccount([$scope]);
    $account->method('getRoles')->willReturn(['administrator']);

    $scope_provider = $this->createMock(Oauth2ScopeProviderInterface::class);
    $scope_provider->method('scopeHasPermission')->willReturn(FALSE);

    $capability = $this->capability($scope_provider);

    self::assertFalse($capability->hasSiteWidePermission($account, 'register bakers conductor'));
  }

  /**
   * A delegated token (auth_user_id present) is not treated as a pure machine.
   *
   * `Oauth2AccessPolicy` INTERSECTS rather than overwrites for this case, so
   * this method's machine branch must not claim it — the ordinary role path
   * below decides it instead, exactly as for a human account.
   */
  public function testDelegatedTokenFallsThroughToTheRoleCheck(): void {
    $scope = $this->createMock(Oauth2ScopeInterface::class);
    $account = $this->tokenAccount([$scope], auth_user_id_empty: FALSE);
    $account->method('getRoles')->willReturn([]);

    $scope_provider = $this->createMock(Oauth2ScopeProviderInterface::class);
    $scope_provider->expects(self::never())->method('scopeHasPermission');

    $capability = $this->capability($scope_provider, with_role_lookup: TRUE);

    self::assertFalse($capability->hasSiteWidePermission($account, 'register bakers conductor'));
  }

  /**
   * With no scope provider service, a token account falls through safely.
   *
   * Simulates simple_oauth being absent: the account still falls through to
   * the ordinary role check rather than fataling.
   */
  public function testMissingScopeProviderFallsThroughSafely(): void {
    $scope = $this->createMock(Oauth2ScopeInterface::class);
    $account = $this->tokenAccount([$scope]);
    $account->method('getRoles')->willReturn([]);

    $capability = $this->capability(NULL, with_role_lookup: TRUE);

    self::assertFalse($capability->hasSiteWidePermission($account, 'register bakers conductor'));
  }

  /**
   * Builds a mocked TokenAuthUserInterface account.
   *
   * @param array<\Drupal\simple_oauth\Oauth2ScopeInterface> $scopes
   *   The scopes the token's `scopes` field returns.
   * @param bool $auth_user_id_empty
   *   Whether the token's `auth_user_id` field is empty (a pure
   *   client_credentials machine identity).
   *
   * @return \Drupal\simple_oauth\Authentication\TokenAuthUserInterface&\PHPUnit\Framework\MockObject\MockObject
   *   The mocked account.
   */
  private function tokenAccount(array $scopes, bool $auth_user_id_empty = TRUE): TokenAuthUserInterface {
    $auth_user_id_item = $this->createMock(FieldItemListInterface::class);
    $auth_user_id_item->method('isEmpty')->willReturn($auth_user_id_empty);

    // The real field type is Oauth2ScopeReferenceItemListInterface, which adds
    // getScopes() beyond FieldItemListInterface — mocked directly so the
    // token's get('scopes') return value satisfies its own contract.
    $scopes_item = $this->createMock(Oauth2ScopeReferenceItemListInterface::class);
    $scopes_item->method('getScopes')->willReturn($scopes);

    $token = $this->createMock(Oauth2TokenInterface::class);
    $token->method('get')->willReturnMap([
      ['auth_user_id', $auth_user_id_item],
      ['scopes', $scopes_item],
    ]);

    $account = $this->createMock(TokenAuthUserInterface::class);
    $account->method('getToken')->willReturn($token);

    return $account;
  }

  /**
   * Builds a BbRankCapability with mocked/absent collaborators.
   *
   * @param \Drupal\simple_oauth\Oauth2ScopeProviderInterface|null $scope_provider
   *   The scope provider to inject, or NULL to simulate the module's absence.
   * @param bool $with_role_lookup
   *   Whether the entity type manager must answer a `user_role` storage
   *   lookup — only the role-check branch needs this.
   *
   * @return \Drupal\bb_core\Access\BbRankCapability
   *   The capability resolver under test.
   */
  private function capability(?Oauth2ScopeProviderInterface $scope_provider, bool $with_role_lookup = FALSE): BbRankCapability {
    $entity_type_manager = $this->createMock(EntityTypeManagerInterface::class);
    if ($with_role_lookup) {
      $storage = $this->createMock(EntityStorageInterface::class);
      $storage->method('loadMultiple')->willReturn([]);
      $entity_type_manager->method('getStorage')->with('user_role')->willReturn($storage);
    }

    return new BbRankCapability(
      NULL,
      NULL,
      $entity_type_manager,
      $this->createMock(LoggerInterface::class),
      new MembershipResolutionGuard(),
      $scope_provider,
      FALSE,
    );
  }

}
