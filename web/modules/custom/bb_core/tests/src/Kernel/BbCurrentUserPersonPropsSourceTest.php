<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\bb_core\Entity\BbWorkspace;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Route;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Plugin\UiPatterns\Source\BbCurrentUserPersonPropsSource;
use Drupal\ui_patterns\SourcePluginBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The signed-in account's `person` props, and the anonymous branch.
 *
 * `BbCurrentUserPersonPropsSource` is wired into the shell's rail footer so
 * it can show whoever is signed in, with no `entity:user` context to bind to.
 * This class settles two things: `initials` is `person.component.yml`'s only
 * `required` prop, and ui_patterns strips an empty prop value before SDC ever
 * sees it — so an anonymous account, which this source is not expected to be
 * asked about in production but is not proven never to be, must not return
 * `''` for it.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbCurrentUserPersonPropsSourceTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'field', 'file', 'image', 'options', 'text', 'link',
    'markdown_easy', 'state_machine', 'og', 'ui_patterns', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('file');
    $this->installConfig(['system', 'user', 'field']);
  }

  /**
   * The signed-in account's display name, initials and colour resolve.
   */
  public function testSignedInAccountProps(): void {
    $account = $this->createUser([], 'Ada Lovelace');
    self::assertNotFalse($account, 'The test account was created.');
    $this->setCurrentUserId((int) $account->id());

    self::assertSame('Ada Lovelace', $this->propValue('display_name'));
    self::assertSame('AL', $this->propValue('initials'));
    self::assertNotSame('', $this->propValue('color'));
    self::assertSame('', $this->propValue('picture'), 'No picture was ever set on this account.');
    self::assertSame($account->toUrl()->toString(), $this->propValue('url'));
  }

  /**
   * A shell profile link carries the route workspace's stable UUID.
   */
  public function testProfileLinkCarriesWorkspaceOrigin(): void {
    $account = $this->createUser([], 'member');
    self::assertNotFalse($account);
    $this->setCurrentUserId((int) $account->id());
    $workspace = BbWorkspace::create(['name' => 'Origin', 'slug' => 'origin']);
    $request = Request::create('/origin/tickets');
    $request->setSession($this->container->get('request_stack')->getSession());
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, 'view.tickets.my_work');
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, new Route('/{bb_workspace}/tickets'));
    $request->attributes->set('bb_workspace', $workspace);
    $this->container->get('request_stack')->push($request);
    $this->container->get('current_route_match')->resetRouteMatch();
    self::assertSame($account->toUrl()->setOption('query', ['workspace' => $workspace->uuid()])->toString(), $this->propValue('url'));
  }

  /**
   * The anonymous branch never returns an empty value for a required prop.
   *
   * `initials` is `person.component.yml`'s only `required` prop; an empty
   * value there is stripped by ui_patterns and SDC then throws on a missing
   * required prop, turning a rendering edge case into a fatal. The other
   * props stay empty: `display_name`/`color`/`picture` are not `required`, so
   * an empty value degrades gracefully instead.
   */
  public function testAnonymousAccountNeverReturnsAnEmptyRequiredProp(): void {
    self::assertSame(0, (int) $this->container->get('current_user')->id());

    self::assertNotSame('', $this->propValue('initials'));
    self::assertSame('', $this->propValue('display_name'));
    self::assertSame('', $this->propValue('color'));
    self::assertSame('', $this->propValue('url'));
    self::assertSame('', $this->propValue('picture'));
  }

  /**
   * Sets the container's current user to a given account id.
   */
  private function setCurrentUserId(int $uid): void {
    $account = $this->container->get('entity_type.manager')->getStorage('user')->load($uid);
    self::assertNotNull($account);
    $this->container->get('account_switcher')->switchTo($account);
    self::assertInstanceOf(AccountProxyInterface::class, $this->container->get('current_user'));
  }

  /**
   * The source's value for a given `person` prop id, on the current user.
   */
  private function propValue(string $prop_id): mixed {
    $configuration = SourcePluginBase::buildConfiguration(
      $prop_id,
      ['type' => 'string'],
      ['source' => []],
      [],
    );
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance('bb_current_user_person_props', $configuration);
    self::assertInstanceOf(BbCurrentUserPersonPropsSource::class, $source);
    return $source->getPropValue();
  }

}
