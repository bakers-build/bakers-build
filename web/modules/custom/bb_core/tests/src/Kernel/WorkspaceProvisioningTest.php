<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\Core\Form\FormState;
use Drupal\KernelTests\KernelTestBase;
use Drupal\file\Entity\File;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbInvite;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\BbWorkspaceCreateForm;
use Drupal\bb_core\Plugin\Validation\Constraint\BbWorkspaceSlugConstraint;
use Drupal\bb_core\Workspace\InviteMatcher;
use Drupal\bb_core\Workspace\WorkspaceProvisioner;
use Drupal\bb_core\Workspace\WorkspaceSlugDeriver;
use Drupal\og\Entity\OgRole;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Sign-up's two halves that no browser can reach (BB-430 F2).
 *
 * THIS CLASS EXISTS FOR EXACTLY WHAT THE BROWSER CANNOT DO, and the test plan
 * says so: AC-6's *"or neither"* needs a fault no form input can provoke, and
 * D12's slug table is a dozen cases that would otherwise be a dozen browser
 * round-trips. Everything a person can observe — the page, the mail, the
 * address bar, the session — belongs to the Playwright suite instead.
 *
 * THE INJECTED FAULT IS A REAL ONE, not a mock that throws. It deletes the
 * `lead` rank and then provisions, which is precisely the state
 * `WorkspaceMembershipHooks::placeGroupOwnerInLead()` documents a deployed site
 * really passing through — *"between `updatedb` and `config:import`"* — and its
 * handling there is deliberately forgiving: *"every failure is logged and
 * skipped … saving a group must not fail there."* That forgiveness is right for
 * every other caller and is exactly what AC-6 cannot accept, so this is the
 * test that the provisioner turns it into a guarantee for its own act.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceProvisioningTest extends KernelTestBase {

  use UserCreationTrait;
  use OgScopeFixtureTrait;
  use ShippedImageConfigTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'crop', 'bb_image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'ui_patterns', 'bb_core',
    // `bb_login` owns the username derivation this class pins. Its only
    // dependencies are `bb_core` and `user`, so it costs this fixture
    // nothing — and testing the deriver from `bb_core`'s side would mean
    // reaching for a service the module under test does not provide.
    'bb_login',
  ];

  /**
   * The account every provisioning below is performed for.
   */
  private UserInterface $operator;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_invite'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    // Mail is collected rather than sent: `EmailLogin` calls
    // `_user_mail_notify()`, and a Kernel test must not hand a message to the
    // host's MTA.
    $this->config('system.mail')
      ->set('interface.default', 'test_mail_collector')
      ->save();

    // Uid 1 bypasses every access check, so it is never an actor here.
    $this->createUser([], 'uid1-dummy');
    $operator = $this->createUser([], 'operator');
    self::assertInstanceOf(UserInterface::class, $operator);
    $this->operator = $operator;
  }

  /**
   * A provisioning that cannot complete leaves no workspace, team or member.
   *
   * AC-6's "or neither", and the assertion is COUNTS BEFORE AND AFTER rather
   * than the absence of an exception: a half-provisioned workspace would also
   * throw, and only the counts tell the two apart.
   */
  public function testFailedProvisioningLeavesNothingBehind(): void {
    $before = $this->counts();

    // THE FAULT: the workspace `lead` rank is gone, so
    // `_bb_core_place_group_owner_in_lead()` logs and skips, the owner's
    // membership stays bare, and the provisioner's own verification refuses.
    $lead = OgRole::load(WorkspaceProvisioner::WORKSPACE_LEAD_ROLE);
    self::assertNotNull($lead, 'The fixture must ship the rank this test removes.');
    $lead->delete();

    try {
      $this->provisioner()->provision('Rollback GmbH', $this->operator);
      self::fail('Provisioning must not report success when the lead rank cannot be granted.');
    }
    catch (\RuntimeException $expected) {
      self::assertStringContainsString(
        WorkspaceProvisioner::WORKSPACE_LEAD_ROLE,
        $expected->getMessage(),
        'The failure must name the rank it could not verify.',
      );
    }

    self::assertSame(
      $before,
      $this->counts(),
      'A failed provisioning must leave no workspace, no team and no membership.',
    );
  }

  /**
   * A completed provisioning creates exactly one of each, with both ranks.
   *
   * The positive half, kept beside the negative one because the two share the
   * counting: a provisioner that created nothing at all would pass the test
   * above and fail this one.
   */
  public function testProvisioningCreatesExactlyOneOfEach(): void {
    $before = $this->counts();

    $workspace = $this->provisioner()->provision('Ärzte & Söhne GmbH', $this->operator);

    $after = $this->counts();
    self::assertSame($before['bb_workspace'] + 1, $after['bb_workspace']);
    self::assertSame($before['bb_team'] + 1, $after['bb_team']);
    self::assertSame($before['og_membership'] + 2, $after['og_membership']);

    // Read through the field rather than `getOwnerId()`:
    // `BbWorkspaceInterface` does not declare it — `EntityOwnerInterface`
    // does — and asserting through the interface the entity type's `owner` key
    // actually names is what keeps this independent of that.
    self::assertSame(
      (string) $this->operator->id(),
      (string) $workspace->get('owner_user_id')->target_id,
    );
    self::assertSame('aerzte-soehne-gmbh', $workspace->getSlug(), 'The slug is derived, never typed.');

    $manager = $this->container->get('og.membership_manager');
    $onWorkspace = $manager->getMembership($workspace, (int) $this->operator->id());
    self::assertNotNull($onWorkspace);
    self::assertContains(
      WorkspaceProvisioner::WORKSPACE_LEAD_ROLE,
      array_map(static fn ($role) => $role->id(), $onWorkspace->getRoles()),
      'Ownership is owner_user_id PLUS a lead membership; there is no owner rank.',
    );

    $teams = $this->container->get('entity_type.manager')->getStorage('bb_team')->loadByProperties([
      'workspace_id' => $workspace->id(),
    ]);
    self::assertCount(1, $teams, 'A workspace is provisioned with exactly one first team.');
    $team = reset($teams);
    $onTeam = $manager->getMembership($team, (int) $this->operator->id());
    self::assertNotNull($onTeam);
    self::assertContains(
      WorkspaceProvisioner::TEAM_LEAD_ROLE,
      array_map(static fn ($role) => $role->id(), $onTeam->getRoles()),
      "The owner's decision: creating the workspace also puts you in charge of its first team.",
    );
  }

  /**
   * The slug deriver hands the constraint a value it will accept.
   *
   * D12's table. Each row is a way the derivation could produce something the
   * entity would then refuse, and the deriver's job is that none of them
   * reaches the constraint.
   *
   * @param string $name
   *   The workspace name as a customer would type it.
   * @param string $expected
   *   The slug it must derive to on an empty site.
   */
  #[DataProvider('slugCases')]
  public function testTheSlugDerivationTable(string $name, string $expected): void {
    self::assertSame($expected, $this->deriver()->derive($name));
  }

  /**
   * The cases for ::testTheSlugDerivationTable().
   *
   * @return array<string, array{string, string}>
   *   Name and expected slug.
   */
  public static function slugCases(): array {
    return [
      'umlauts transliterate the German way' => ['Ärzte & Söhne', 'aerzte-soehne'],
      'runs of punctuation collapse to one hyphen' => ['Acme  &  Co', 'acme-co'],
      'trailing punctuation is trimmed' => ['Acme GmbH!!', 'acme-gmbh'],
      'a reserved derivation is avoided' => ['home', 'home-2'],
      'so is the other kind of reserved' => ['admin', 'admin-2'],
      'a derivation that empties falls back' => ['...', 'workspace'],
      'and so does one with no alphanumerics at all' => ['!!!', 'workspace'],
      'over-long names truncate to the pattern limit' => [str_repeat('a', 80), str_repeat('a', 64)],
      'case is folded' => ['ACME', 'acme'],
    ];
  }

  /**
   * Every derived slug satisfies all three of the constraint's rules.
   *
   * Asserted as a PROPERTY rather than row by row, because the table above
   * fixes the expected strings and this fixes what makes them acceptable — a
   * future change that made the deriver return `Home` would break both, and
   * only this one says why.
   */
  public function testEveryDerivedSlugWouldPassTheConstraint(): void {
    foreach (self::slugCases() as $label => [$name, $_expected]) {
      $slug = $this->deriver()->derive($name);
      self::assertMatchesRegularExpression(BbWorkspaceSlugConstraint::PATTERN, $slug, $label);
      self::assertNotContains($slug, BbWorkspaceSlugConstraint::RESERVED, $label);
      self::assertLessThanOrEqual(64, strlen($slug), $label);
    }
  }

  /**
   * A colliding name is uniquified rather than refused.
   */
  public function testCollidingNameGetsSuffix(): void {
    $this->provisioner()->provision('Acme', $this->operator);
    self::assertSame('acme-2', $this->deriver()->derive('Acme'));
  }

  /**
   * A username is derived from the address and uniquified against existing.
   *
   * AC-9's deferral: the customer is never asked for one.
   */
  public function testUsernameDerivation(): void {
    $entry = $this->container->get('bb_login.email_login');
    self::assertSame('operator-2', $entry->deriveUsername('operator@example.com'), 'A taken name gets a suffix.');
    self::assertSame('first.last', $entry->deriveUsername('First.Last@example.com'));
    self::assertSame('bakers', $entry->deriveUsername('...@example.com'), 'A local part with nothing usable falls back.');
    self::assertSame('a-b', $entry->deriveUsername('a+++b@example.com'));
  }

  /**
   * An invitation matches the account's address whatever the case.
   *
   * F2.5, and it is not a nicety: an address differing only in case is one
   * mailbox, and a customer who capitalises their own name would otherwise be
   * handed the no-workspace state while the workspace they belong to sits one
   * row away.
   */
  public function testInviteMatchingIsCaseInsensitive(): void {
    $workspace = $this->provisioner()->provision('Invited Co', $this->operator);
    $newcomer = $this->createUser([], 'newcomer');
    self::assertInstanceOf(UserInterface::class, $newcomer);
    $newcomer->setEmail('Pascal@Keytec.de')->save();

    $invite = BbInvite::create([
      'workspace_id' => $workspace->id(),
      'email' => 'pascal@keytec.de',
      'owner_user_id' => $this->operator->id(),
    ]);
    $invite->save();

    self::assertTrue($this->matcher()->matches($invite, $newcomer));
    self::assertCount(1, $this->matcher()->forAccount($newcomer));
  }

  /**
   * An invitation for another address never surfaces.
   *
   * F2.6. The row is the offer, so a matcher that widened would offer a
   * stranger a workspace — and the join route's access reads the same rule.
   */
  public function testAnInvitationForAnotherAddressNeverMatches(): void {
    $workspace = $this->provisioner()->provision('Somebody Else Co', $this->operator);
    $stranger = $this->createUser([], 'stranger');
    self::assertInstanceOf(UserInterface::class, $stranger);
    $stranger->setEmail('stranger@example.com')->save();

    $invite = BbInvite::create([
      'workspace_id' => $workspace->id(),
      'email' => 'someone.else@example.com',
      'owner_user_id' => $this->operator->id(),
    ]);
    $invite->save();

    self::assertFalse($this->matcher()->matches($invite, $stranger));
    self::assertSame([], $this->matcher()->forAccount($stranger));
  }

  /**
   * A wildcard in an address does not widen the match.
   *
   * `_` is legal in a local part and `LIKE` treats it as a wildcard, so the
   * matcher's query is deliberately broad and its PHP comparison is the actual
   * rule. Without that second step `first_last@` would match `firstXlast@`.
   */
  public function testUnderscoreIsNotTreatedAsWildcard(): void {
    $workspace = $this->provisioner()->provision('Wildcard Co', $this->operator);
    $account = $this->createUser([], 'wildcard');
    self::assertInstanceOf(UserInterface::class, $account);
    $account->setEmail('firstXlast@example.com')->save();

    $invite = BbInvite::create([
      'workspace_id' => $workspace->id(),
      'email' => 'first_last@example.com',
      'owner_user_id' => $this->operator->id(),
    ]);
    $invite->save();

    self::assertFalse(
      $this->matcher()->matches($invite, $account),
      'A `_` in the invited address must not match any character.',
    );
    self::assertSame([], $this->matcher()->forAccount($account));
  }

  /**
   * The create form provisions the description and image it was given.
   *
   * The form renders the shared settings display, so whatever that display
   * offers must reach the provisioned workspace rather than the discarded
   * draft entity.
   */
  public function testCreateFormKeepsDescriptionAndImage(): void {
    // The private stream wrapper registers only on a container built with
    // its path set.
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->container->get('kernel')->rebuildContainer();
    $this->container->get('stream_wrapper_manager')->register();
    foreach (['file', 'crop', 'bb_group', 'bb_project'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $path = $this->container->get('extension.list.module')->getPath('bb_core');
    $mode = (new FileStorage($path . '/config/install'))->read('core.entity_form_mode.bb_workspace.settings');
    self::assertIsArray($mode);
    $entity_type_manager = $this->container->get('entity_type.manager');
    $entity_type_manager->getStorage('entity_form_mode')->create($mode)->save();
    $this->installShippedFormDisplays('bb_workspace.bb_workspace.settings');
    $this->setCurrentUser($this->operator);

    // A fresh upload: private, temporary and owned by the person creating
    // the workspace, as the image widget leaves it before the form is saved.
    $directory = 'private://workspace-images';
    $this->container->get('file_system')->prepareDirectory($directory, 1);
    file_put_contents($directory . '/pixel.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
    $upload = File::create(['uri' => $directory . '/pixel.png', 'uid' => $this->operator->id()]);
    $upload->setTemporary();
    $upload->save();

    $form_state = (new FormState())->setValues([
      'name' => [['value' => 'Described Co']],
      'description' => [['value' => 'A workspace, described on creation.']],
      'image' => [['fids' => (string) $upload->id()]],
      'op' => 'Create workspace',
    ]);
    $this->container->get('form_builder')->submitForm(BbWorkspaceCreateForm::class, $form_state);
    self::assertSame([], array_map('strval', $form_state->getErrors()));

    $workspaces = $entity_type_manager->getStorage('bb_workspace')->loadByProperties(['name' => 'Described Co']);
    self::assertCount(1, $workspaces);
    $workspace = reset($workspaces);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    self::assertSame('A workspace, described on creation.', $workspace->get('description')->value);
    self::assertSame((int) $upload->id(), (int) $workspace->get('image')->target_id);
    $saved = File::load($upload->id());
    self::assertNotNull($saved);
    self::assertTrue($saved->isPermanent(), 'The attached upload must become a permanent file.');
  }

  /**
   * How many of each entity exist right now.
   *
   * @return array<string, int>
   *   Counts keyed by entity type id.
   */
  private function counts(): array {
    $counts = [];
    foreach (['user', 'bb_workspace', 'bb_team', 'og_membership'] as $type) {
      $counts[$type] = (int) $this->container->get('entity_type.manager')
        ->getStorage($type)->getQuery()->accessCheck(FALSE)->count()->execute();
    }
    return $counts;
  }

  /**
   * The provisioner under test.
   *
   * @return \Drupal\bb_core\Workspace\WorkspaceProvisioner
   *   The service.
   */
  private function provisioner(): WorkspaceProvisioner {
    return $this->container->get('bb_core.workspace_provisioner');
  }

  /**
   * The slug deriver under test.
   *
   * @return \Drupal\bb_core\Workspace\WorkspaceSlugDeriver
   *   The service.
   */
  private function deriver(): WorkspaceSlugDeriver {
    return $this->container->get('bb_core.workspace_slug_deriver');
  }

  /**
   * The invite matcher under test.
   *
   * @return \Drupal\bb_core\Workspace\InviteMatcher
   *   The service.
   */
  private function matcher(): InviteMatcher {
    return $this->container->get('bb_core.invite_matcher');
  }

}
