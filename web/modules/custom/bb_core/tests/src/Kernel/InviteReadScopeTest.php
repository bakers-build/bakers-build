<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Invitations are listed and counted only inside a workspace that grants it.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class InviteReadScopeTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'bb_core',
  ];

  /**
   * An invitation of workspace A.
   */
  private ContentEntityInterface $inviteA;

  /**
   * An invitation of workspace B.
   */
  private ContentEntityInterface $inviteB;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    $this->inviteA = $this->fixture('a', 'bb_invite');
    $this->inviteB = $this->fixture('b', 'bb_invite');
  }

  /**
   * A lead lists their own workspace's invitations and no others.
   */
  public function testLeadListsOnlyTheirWorkspacesInvitations(): void {
    $lead_a = $this->member('lead-a', ['a' => 'lead']);
    $lead_b = $this->member('lead-b', ['b' => 'lead']);
    self::assertSame([(int) $this->inviteA->id()], $this->queryIdsAs('bb_invite', $lead_a));
    self::assertSame([(int) $this->inviteB->id()], $this->queryIdsAs('bb_invite', $lead_b));
  }

  /**
   * A lead of B who is a guest of A cannot count or filter A's invitations.
   */
  public function testGuestSeatGrantsNoInvitations(): void {
    $lead_b = $this->member('lead-b-guest-a', ['b' => 'lead', 'a' => 'guest']);
    self::assertSame([(int) $this->inviteB->id()], $this->queryIdsAs('bb_invite', $lead_b));

    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($lead_b);
    try {
      $count = (int) $this->container->get('entity_type.manager')->getStorage('bb_invite')->getQuery()
        ->accessCheck(TRUE)
        ->condition('email', 'recruit-a@example.com')
        ->count()
        ->execute();
    }
    finally {
      $switcher->switchBack();
    }
    self::assertSame(0, $count);
  }

  /**
   * Creates an account holding the given rank per workspace side.
   *
   * @param string $name
   *   The account name.
   * @param array<string, string> $ranks
   *   Ranks keyed by side, 'a' or 'b'.
   */
  private function member(string $name, array $ranks): UserInterface {
    $account = $this->createAccount($name);
    foreach ($ranks as $side => $rank) {
      $this->addMembership($this->fixture($side, 'bb_workspace'), $account, [$rank]);
    }
    return $account;
  }

}
