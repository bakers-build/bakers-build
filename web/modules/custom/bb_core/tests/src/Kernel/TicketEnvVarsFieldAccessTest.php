<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * View field-access on the env_vars / effective_env_vars fields.
 *
 * RETIRED, BB-454 ROUND 4 (2026-09-16): env_vars used to carry a dedicated
 * `checkEnvVarsViewAccess()` gate restricting reads to the conductor session,
 * a project manager (`edit bb_project`) or an admin (BB-99). The operator
 * decided the field holds no secrets in this product, so
 * `BbTicketAccessControlHandler::checkFieldAccess()` no longer special-cases
 * it — viewing defers to `parent::checkFieldAccess()`, exactly as `title`
 * does. This class is kept, renamed in spirit rather than in file, to pin
 * exactly that: a plain ticket reader now sees env_vars, the same as any
 * other field.
 *
 * Note where the protection actually sits, because the coding handoff said
 * "follows entity view access" and that is imprecise: core allows `view` at
 * the FIELD boundary by default and never consults entity access there. What
 * keeps env_vars from a stranger is entity access on the way in — the same
 * thing that keeps `title` from them. See
 * testEnvVarsAnswersIdenticallyToAnUngatedField(), which measures it.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketEnvVarsFieldAccessTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_project', 'bb_conductor', 'bb_ticket', 'bb_run'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    // Uid 1 is a superuser; keep it out of the way of the assertions.
    $this->createUser('uid1-dummy', []);
  }

  /**
   * Creates a user with the given bakers.build permissions.
   *
   * @param string $name
   *   Username.
   * @param array<string> $perms
   *   Permission machine names to grant via a dedicated role.
   *
   * @return \Drupal\user\UserInterface
   *   The saved user.
   */
  private function createUser(string $name, array $perms): UserInterface {
    $role_id = 'r_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    if ($perms) {
      user_role_grant_permissions($role_id, $perms);
    }
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates a saved bb_ticket carrying env_vars.
   */
  private function createTicket(): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'identifier' => 'GL-EV-1',
        'workflow' => 'bb_feature',
        'title' => 'EV',
        'env_vars' => "DB_DSN=mysql://user:pass@h/db",
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Env_vars now follows ordinary field access, the same as any other field.
   *
   * Every account here holds `view bb_ticket`, so every one of them — the
   * plain reader included — sees env_vars / effective_env_vars, exactly as
   * they already see `title`. The dedicated conductor/PM/admin-only gate this
   * test used to pin is retired (BB-454 round 4): there is no longer a
   * privileged subset to distinguish, so this test asserts the single
   * uniform outcome instead of a matrix of them.
   */
  public function testEnvVarsFollowsOrdinaryFieldAccess(): void {
    $ticket = $this->createTicket();

    $reader = $this->createUser('plain-reader', ['view bb_ticket']);
    $editor = $this->createUser('plain-editor', ['view bb_ticket', 'update any bb_ticket']);
    $session = $this->createUser('conductor-session', ['view bb_ticket', 'write bakers via session scope']);
    $pm = $this->createUser('pm-viewer', ['view bb_ticket', 'edit bb_project']);
    $admin = $this->createUser('bakers-admin', ['administer bakers']);

    foreach (['env_vars', 'effective_env_vars'] as $field) {
      foreach (['reader' => $reader, 'editor' => $editor, 'session' => $session, 'pm' => $pm, 'admin' => $admin] as $label => $account) {
        $this->assertTrue(
          $ticket->get($field)->access('view', $account),
          "$field must be visible to $label, since it now follows ordinary ticket view access.",
        );
      }
    }

    // A never-sensitive field stays readable for the plain reader (control).
    $this->assertTrue(
      $ticket->get('title')->access('view', $reader),
      'title must stay readable for a plain ticket reader.',
    );
  }

  /**
   * The env_vars field answers EXACTLY as an ordinary one, account by account.
   *
   * The negative half, and without it the test above proves nothing about the
   * mechanism it names. Every account there holds `view bb_ticket`, so ten
   * assertTrue over five accounts stay green against a checkFieldAccess() that
   * returned AccessResult::allowed() unconditionally — which is the reading
   * this test exists to separate from the intended one.
   *
   * IT IS WRITTEN AS AN EQUALITY, NOT AS A DENIAL, and that is a measurement
   * rather than a preference. The obvious negative — "an account that cannot
   * view the ticket cannot view env_vars" — was written first and FAILED: at
   * the FIELD boundary core's EntityAccessControlHandler::checkFieldAccess()
   * allows `view` by default, and field access does not consult entity access.
   * So `$ticket->get('env_vars')->access('view', $outsider)` is TRUE even
   * though `$ticket->access('view', $outsider)` is FALSE. That is true of
   * `title` too, and of every ordinary field on every entity in Drupal: what
   * protects the value is entity access on the way in, not the field gate.
   * The coding handoff's phrasing — that env_vars now "follows entity view
   * access" — is therefore imprecise about where the protection sits, and an
   * assertion written from that phrasing would have pinned a falsehood.
   *
   * What IS true, and is the whole content of retiring the BB-99 gate, is
   * that env_vars stopped being special: it answers identically to a field
   * nobody ever gated. Asserting the equality fails the moment anyone gives
   * env_vars a gate of its own again, in either direction, which no count of
   * assertTrue can do.
   */
  public function testEnvVarsAnswersIdenticallyToAnUngatedField(): void {
    $ticket = $this->createTicket();

    $accounts = [
      'plain reader' => $this->createUser('eq-reader', ['view bb_ticket']),
      'ticket editor' => $this->createUser('eq-editor', ['view bb_ticket', 'update any bb_ticket']),
      'admin' => $this->createUser('eq-admin', ['administer bakers']),
      // Holds a bakers.build permission but not `view bb_ticket`, so the entity is
      // closed to it — the case that separates the field gate from entity
      // access, and the reason this test is an equality.
      'outsider' => $this->createUser('eq-outsider', ['view bb_run']),
    ];

    // The precondition that makes the outsider row meaningful: the entity
    // really is closed to it, so if env_vars were still gated at the field
    // level the equality below would break on that row.
    $this->assertFalse(
      $ticket->access('view', $accounts['outsider']),
      'precondition: the outsider cannot view the ticket entity.',
    );
    $this->assertTrue(
      $ticket->access('view', $accounts['plain reader']),
      'precondition: the plain reader can, so the two rows differ.',
    );

    foreach ($accounts as $label => $account) {
      $ordinary = $ticket->get('title')->access('view', $account);
      foreach (['env_vars', 'effective_env_vars'] as $field) {
        $this->assertSame(
          $ordinary,
          $ticket->get($field)->access('view', $account),
          "$field must answer exactly as an ungated field does for the $label.",
        );
      }
    }
  }

}
