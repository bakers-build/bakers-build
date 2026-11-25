<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Form\GroupMembersForm;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DomCrawler\Crawler;
use Symfony\Component\HttpFoundation\InputBag;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * A member's page: the role, Remove and Transfer the roster rows used to hold.
 *
 * The roster's rows are each one link to it; the page answers only to who
 * may read the roster, and its actions only to who may change the crew.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class GroupMemberDetailTest extends KernelTestBase {

  /**
   * The workspace host's members island.
   */
  private const array ISLAND = ['island_id' => 'members', 'host_id' => 'workspace'];

  use OgScopeFixtureTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine', 'link', 'text',
    'field', 'filter', 'markdown_easy', 'og', 'views', 'ui_patterns', 'island',
    'bb_core',
  ];

  /**
   * The workspace.
   */
  private ContentEntityInterface $workspace;

  /**
   * The workspace lead, who may change the crew.
   */
  private UserInterface $lead;

  /**
   * A guest of the workspace.
   */
  private UserInterface $guest;

  /**
   * A contributor, the member whose page is read.
   */
  private UserInterface $rosa;

  /**
   * {@inheritdoc}
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $container->setParameter('twig.config', ['debug' => TRUE, 'auto_reload' => NULL, 'cache' => TRUE]);
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_project', 'bb_team', 'bb_invite'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    // Uid 1 bypasses every access check, so it is created and left unused.
    $this->createUser([], 'root');

    $owner = $this->createUser([], 'owner');
    self::assertInstanceOf(UserInterface::class, $owner);
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => 'Acme', 'slug' => 'acme', 'owner_user_id' => $owner->id()]);
    self::assertInstanceOf(ContentEntityInterface::class, $workspace);
    $workspace->save();
    $this->workspace = $workspace;
    foreach (['lead' => 'lead', 'guest' => 'guest', 'rosa' => 'contributor'] as $name => $role) {
      $account = $this->createUser([], $name);
      self::assertInstanceOf(UserInterface::class, $account);
      $this->addMembership($workspace, $account, [$role]);
      $this->{$name} = $account;
    }
  }

  /**
   * Every roster row is one link to its member's page, with no control.
   */
  public function testRosterRowsAreOneLinkEach(): void {
    $this->setCurrentUser($this->lead);
    $page = new Crawler($this->renderFace());

    $rows = $page->filter('li[data-list-item]');
    self::assertGreaterThan(0, $rows->count());
    foreach ($rows as $row) {
      $row = new Crawler($row);
      self::assertCount(1, $row->filter('a[href]'), 'One link per row.');
      self::assertCount(0, $row->filter('button, input[type="submit"]'), 'No control in a row.');
    }
    $rosa = $page->filter('li[data-list-item]')->reduce(static fn (Crawler $row): bool => str_contains($row->text(), 'rosa'));
    self::assertStringEndsWith('/members/' . $this->rosa->id(), (string) $rosa->filter('a')->attr('href'));
  }

  /**
   * The member page offers the role pick and Remove; the owner adds Transfer.
   */
  public function testMemberPageOffersTheActions(): void {
    $uid = (int) $this->rosa->id();
    $this->setCurrentUser($this->lead);
    $html = $this->renderFace($this->rosa);
    self::assertStringContainsString('name="member_role_' . $uid . '"', $html);
    self::assertStringContainsString('name="remove_member_' . $uid . '"', $html);
    self::assertStringNotContainsString('name="transfer_owner_', $html, 'Only the owner transfers.');
    self::assertStringNotContainsString('member_role_' . $this->lead->id(), $html, 'Only this member.');

    $owner = $this->workspace->get('owner_user_id')->entity;
    self::assertInstanceOf(UserInterface::class, $owner);
    $this->setCurrentUser($owner);
    self::assertStringContainsString('name="transfer_owner_' . $uid . '"', $this->renderFace($this->rosa));
  }

  /**
   * A confirmed Remove returns to the roster; a role pick stays on the page.
   */
  public function testRemoveReturnsToTheRosterAndRoleStays(): void {
    $uid = (int) $this->rosa->id();
    $this->setCurrentUser($this->lead);

    $role = $this->submit($this->rosa, ['member_role_' . $uid => 'guest'])->getResponse();
    self::assertNotNull($role);
    self::assertFalse($role->headers->has('HX-Location') || $role->headers->has('HX-Redirect'), 'A role pick rebuilds the page.');

    $removed = $this->submit($this->rosa, ['confirm_remove_' . $uid => (string) $uid])->getResponse();
    self::assertNotNull($removed);
    $location = (string) ($removed->headers->get('HX-Location') ?? $removed->headers->get('HX-Redirect'));
    self::assertStringEndsWith('/settings/members', $location, 'Remove returns to the roster.');
    self::assertNull($this->container->get('bb_core.membership_writer')->membershipOf($this->workspace, $uid));
  }

  /**
   * A guest does not reach a member's page, so gets none of its actions.
   */
  public function testGuestGetsNoRouteAndNoAction(): void {
    $access = $this->container->get('access_manager');
    $parameters = ['bb_workspace' => 'acme', 'user' => $this->rosa->id()];
    self::assertTrue($access->checkNamedRoute('bb_core.bb_workspace.member', $parameters, $this->lead));
    self::assertFalse($access->checkNamedRoute('bb_core.bb_workspace.member', $parameters, $this->guest));
  }

  /**
   * The member page of someone outside the workspace is not found.
   */
  public function testNonMemberPageIsNotFound(): void {
    $stranger = $this->createUser([], 'stranger');
    self::assertInstanceOf(UserInterface::class, $stranger);
    $this->setCurrentUser($this->lead);
    $this->expectException(NotFoundHttpException::class);
    $this->container->get('controller_resolver')
      ->getControllerFromDefinition('\Drupal\bb_core\Controller\BbWorkspaceMembersController::member')($this->workspace, $stranger);
  }

  /**
   * Renders the members face, on the roster or on one member's page.
   *
   * @param \Drupal\user\UserInterface|null $member
   *   The member whose page renders, or NULL for the roster.
   */
  private function renderFace(?UserInterface $member = NULL): string {
    $this->enterRoute($member);
    $form = $this->container->get('form_builder')->getForm(GroupMembersForm::class, self::ISLAND);
    return (string) $this->container->get('renderer')->renderInIsolation($form);
  }

  /**
   * Submits raw keys to a member's page, as a pressed control does.
   *
   * @param \Drupal\user\UserInterface $member
   *   The member whose page posts.
   * @param array<string, string> $values
   *   The posted keys.
   */
  private function submit(UserInterface $member, array $values): FormStateInterface {
    $this->enterRoute($member);
    $form_state = new FormState();
    $form_state->setValues($values);
    $this->container->get('form_builder')->submitForm(GroupMembersForm::class, $form_state, self::ISLAND);
    self::assertSame([], array_map('strval', $form_state->getErrors()));
    return $form_state;
  }

  /**
   * Makes the roster or a member's page the current route.
   *
   * @param \Drupal\user\UserInterface|null $member
   *   The member whose page is entered, or NULL for the roster.
   */
  private function enterRoute(?UserInterface $member): void {
    $route_name = $member === NULL ? 'bb_core.bb_workspace.members' : 'bb_core.bb_workspace.member';
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $request = Request::create('/group-member-detail-test');
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set('bb_workspace', $this->workspace);
    $raw = ['bb_workspace' => 'acme'];
    if ($member !== NULL) {
      $request->attributes->set('user', $member);
      $raw['user'] = (string) $member->id();
    }
    $request->attributes->set('_raw_variables', new InputBag($raw));
    $this->container->get('request_stack')->push($request);
  }

}
