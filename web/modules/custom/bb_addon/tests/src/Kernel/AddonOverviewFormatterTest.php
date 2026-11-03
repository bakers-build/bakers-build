<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_addon\Kernel;

use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_inbox\Kernel\InboxWorldTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\InputBag;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Routing\Route;

/**
 * The formatters behind the addon overview's rows.
 */
#[Group('bb_addon')]
#[RunTestsInSeparateProcesses]
final class AddonOverviewFormatterTest extends KernelTestBase {

  use AddonFixtureTrait;
  use InboxWorldTrait;

  private const string ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'og', 'file', 'image',
    'serialization', 'jsonapi', 'jsonapi_resources',
    'island', 'ui_patterns',
    'bb_core', 'bb_inbox', 'bb_addon',
  ];

  /**
   * A conductor on a workspace-b project.
   */
  private BbConductorInterface $elsewhere;

  /**
   * Owns $elsewhere and is a contributor of workspace a as well.
   */
  private UserInterface $elsewhereOwner;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->buildInboxWorld();
    $this->installEntitySchema('bb_addon');
    $this->elsewhereOwner = $this->createAccount('elsewhere-owner', ['register bakers conductor']);
    $this->workspaceMember('a', $this->elsewhereOwner, 'contributor');
    $elsewhere = $this->createEntity('bb_conductor', [
      'label' => 'node-elsewhere',
      'project_id' => $this->fixture('b', 'bb_project')->id(),
      'owner_user_id' => $this->elsewhereOwner->id(),
      'status' => 'offline',
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $elsewhere);
    $this->elsewhere = $elsewhere;
  }

  /**
   * The label part shows the definition's label, else the capitalised name.
   */
  public function testLabel(): void {
    $ports = $this->storeAddon(self::portsDefinition(), [], (int) $this->fixture('a', 'bb_workspace')->id());
    self::assertSame('Ports', $this->definitionPart($ports, 'label')['#plain_text']);
    $bare = $this->storeAddon(['name' => 'bare', 'version' => '1.0.0', 'contract' => 1], [], (int) $this->fixture('a', 'bb_workspace')->id());
    self::assertSame('Bare', $this->definitionPart($bare, 'label')['#plain_text']);
  }

  /**
   * The versions part lists every version of the name once, newest first.
   */
  public function testVersions(): void {
    $time = $this->container->get('datetime.time')->getRequestTime();
    $old = $this->storeAddon(self::portsDefinition('1.0.0'), [], (int) $this->fixture('a', 'bb_workspace')->id());
    $old->set('created', $time - 60)->save();
    // A second definition of 1.0.0, as another tenant may register it: a
    // different workspace, since BB-660/661 makes (workspace, name,
    // version) the row's identity.
    $twin = $this->storeAddon(['label' => 'Ports twin'] + self::portsDefinition('1.0.0'), [], (int) $this->fixture('b', 'bb_workspace')->id());
    $twin->set('created', $time - 30)->save();
    $new = $this->storeAddon(self::portsDefinition('1.1.0'), [], (int) $this->fixture('a', 'bb_workspace')->id());
    $this->storeAddon(['name' => 'bare', 'version' => '9.0.0', 'contract' => 1], [], (int) $this->fixture('a', 'bb_workspace')->id());

    $versions = $this->definitionPart($new, 'versions');
    self::assertSame('1.1.0, 1.0.0', $versions['#plain_text']);
    // A sibling version changes the row.
    self::assertContains('bb_addon_list', $versions['#cache']['tags']);
    self::assertSame('1.1.0, 1.0.0', $this->definitionPart($old, 'versions')['#plain_text']);
  }

  /**
   * The icon is an image of the SVG, never markup; initials stand in for it.
   */
  public function testIcon(): void {
    $ports = $this->storeAddon(['icon' => self::ICON] + self::portsDefinition(), [], (int) $this->fixture('a', 'bb_workspace')->id());
    $icon = $this->definitionPart($ports, 'icon');
    self::assertSame('bb_theme:person', $icon['#component']);
    self::assertSame('P', $icon['#props']['initials']);
    self::assertStringStartsWith('data:image/svg+xml;base64,', $icon['#props']['picture']);
    self::assertSame(self::ICON, base64_decode(substr($icon['#props']['picture'], strlen('data:image/svg+xml;base64,'))));

    $bare = $this->storeAddon(['name' => 'bare', 'version' => '1.0.0', 'contract' => 1], [], (int) $this->fixture('a', 'bb_workspace')->id());
    $icon = $this->definitionPart($bare, 'icon');
    self::assertArrayNotHasKey('picture', $icon['#props']);
    self::assertSame('B', $icon['#props']['initials']);
  }

  /**
   * A member sees the conductors of the route workspace running the addon.
   */
  public function testMemberSeesWorkspaceConductors(): void {
    $ports = $this->storeAddon(self::portsDefinition(), [$this->conductor, $this->elsewhere]);
    self::assertSame(['node-inbox 1.2.3'], $this->conductorBadges($ports, $this->contributor, 'a'));
  }

  /**
   * The cell covers every version of the name, each badge naming its version.
   *
   * BB-660/661: a row's conductors can no longer span workspaces, so both
   * versions here are registered within workspace a; cross-workspace
   * isolation itself is `testOwnConductorElsewhereIsHidden`.
   */
  public function testConductorsOfEveryVersion(): void {
    $time = $this->container->get('datetime.time')->getRequestTime();
    $old = $this->storeAddon(self::portsDefinition('1.0.0'), [$this->conductor]);
    $old->set('created', $time - 60)->save();
    $second = $this->createConductor('node-second', $this->createAccount('second-a-owner', ['register bakers conductor']));
    $new = $this->storeAddon(self::portsDefinition('1.1.0'), [$second]);
    self::assertSame(['node-second 1.1.0', 'node-inbox 1.0.0'], $this->conductorBadges($new, $this->contributor, 'a'));

    $new->addConductor($this->conductor)->save();
    self::assertSame(
      ['node-inbox 1.1.0', 'node-second 1.1.0', 'node-inbox 1.0.0'],
      $this->conductorBadges($new, $this->contributor, 'a'),
    );
  }

  /**
   * A conductor its viewer owns in another workspace stays off this page.
   *
   * BB-660/661: each workspace's registration of the name is its own row
   * (a row can no longer carry conductors from two workspaces), so this
   * exercises two separate rows rather than one row with mixed conductors.
   */
  public function testOwnConductorElsewhereIsHidden(): void {
    $a = $this->storeAddon(self::portsDefinition(), [$this->conductor]);
    $b = $this->storeAddon(self::portsDefinition(), [$this->elsewhere]);
    self::assertSame(['node-inbox 1.2.3'], $this->conductorBadges($a, $this->elsewhereOwner, 'a'));
    self::assertSame(['node-elsewhere 1.2.3'], $this->conductorBadges($b, $this->elsewhereOwner, 'b'));
  }

  /**
   * A member of another workspace never sees the first workspace's conductor.
   */
  public function testOutsiderDoesNotSeeConductors(): void {
    $ports = $this->storeAddon(self::portsDefinition(), [$this->conductor]);
    self::assertSame('No conductor in this workspace', $this->conductorBadges($ports, $this->outsider, 'b'));
    self::assertSame('No conductor in this workspace', $this->conductorBadges($ports, $this->outsider, 'a'));
  }

  /**
   * Without a conductor in the workspace, or a workspace, the cell says so.
   */
  public function testNoConductorInWorkspace(): void {
    $ports = $this->storeAddon(self::portsDefinition(), [$this->elsewhere]);
    self::assertSame('No conductor in this workspace', $this->conductorBadges($ports, $this->contributor, 'a'));
    $both = $this->storeAddon(self::portsDefinition('2.0.0'), [$this->conductor]);
    self::assertSame('No conductor in this workspace', $this->conductorBadges($both, $this->contributor, NULL));
  }

  /**
   * Online and offline conductors carry their tone; the cell varies by user.
   */
  public function testBadgeToneAndCache(): void {
    $ports = $this->storeAddon(self::portsDefinition(), [$this->conductor]);
    $build = $this->conductorCell($ports, $this->contributor, 'a');
    self::assertSame(['label' => 'node-inbox 1.2.3', 'tone' => 'running', 'dot' => TRUE], $build[0]['#props']);
    self::assertContains('user', $build[0]['#cache']['contexts']);
    self::assertContains('route', $build[0]['#cache']['contexts']);
    self::assertContains('bb_conductor_list', $build[0]['#cache']['tags']);
    // Visibility follows memberships and where the project sits.
    self::assertContains('og_membership_list', $build[0]['#cache']['tags']);
    self::assertContains('bb_project_list', $build[0]['#cache']['tags']);
    self::assertContains('bb_group_list', $build[0]['#cache']['tags']);
    // A newly registered version of the name changes the cell.
    self::assertContains('bb_addon_list', $build[0]['#cache']['tags']);

    $this->conductor->set('status', 'offline')->save();
    $build = $this->conductorCell($ports, $this->contributor, 'a');
    self::assertSame('offline', $build[0]['#props']['tone']);
  }

  /**
   * The badge labels of the conductor cell, or its text when there is none.
   *
   * @return array<string>|string
   *   The labels, or the cell's text.
   */
  private function conductorBadges(BbAddonInterface $addon, AccountInterface $viewer, ?string $side): array|string {
    $build = $this->conductorCell($addon, $viewer, $side);
    if (isset($build[0]['#plain_text'])) {
      return (string) $build[0]['#plain_text'];
    }
    $labels = [];
    foreach ($build as $delta => $element) {
      if (is_int($delta)) {
        $labels[] = $element['#props']['label'];
      }
    }
    return $labels;
  }

  /**
   * Renders the conductor cell as the viewer on a route of the workspace.
   *
   * @return array<int|string, mixed>
   *   The field render array.
   */
  private function conductorCell(BbAddonInterface $addon, AccountInterface $viewer, ?string $side): array {
    $request = Request::create('/addons');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add([
      RouteObjectInterface::ROUTE_NAME => 'test.addons',
      RouteObjectInterface::ROUTE_OBJECT => new Route('/{bb_workspace}/addons'),
    ]);
    if ($side !== NULL) {
      $workspace = $this->fixture($side, 'bb_workspace');
      $request->attributes->set('bb_workspace', $workspace);
      $request->attributes->set('_raw_variables', new InputBag(['bb_workspace' => $workspace->id()]));
    }
    $this->container->get('request_stack')->push($request);
    $this->container->get('current_user')->setAccount($viewer);
    return $addon->get('conductors')->view(['type' => 'bb_addon_conductors', 'label' => 'hidden']);
  }

  /**
   * Renders one part of the addon's definition through the formatter.
   *
   * @return array<string, mixed>
   *   The single element.
   */
  private function definitionPart(BbAddonInterface $addon, string $part): array {
    $build = $addon->get('definition')->view([
      'type' => 'bb_addon_definition',
      'settings' => ['part' => $part],
      'label' => 'hidden',
    ]);
    self::assertArrayHasKey(0, $build);
    return $build[0];
  }

}
