<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Entity\BbInvite;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A pending invitation's page: what it grants, and Revoke.
 *
 * The roster's invitation rows are each one link to it.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class InviteDetailTest extends KernelTestBase {

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
   * The workspace lead, who may change the crew.
   */
  private UserInterface $lead;

  /**
   * A guest of the workspace.
   */
  private UserInterface $guest;

  /**
   * The pending invitation.
   */
  private BbInvite $invite;

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
    foreach (['lead' => 'lead', 'guest' => 'guest'] as $name => $role) {
      $account = $this->createUser([], $name);
      self::assertInstanceOf(UserInterface::class, $account);
      $this->addMembership($workspace, $account, [$role]);
      $this->{$name} = $account;
    }
    $invite = BbInvite::create([
      'workspace_id' => $workspace->id(),
      'email' => 'newcomer@example.com',
      'owner_user_id' => $this->lead->id(),
    ]);
    $invite->save();
    $this->invite = $invite;
  }

  /**
   * The invitation's canonical page is its detail, under its workspace.
   */
  public function testCanonicalRouteIsTheDetail(): void {
    self::assertSame('entity.bb_invite.canonical', $this->invite->toUrl()->getRouteName());
    self::assertStringEndsWith('/invite/' . $this->invite->id(), $this->invite->toUrl()->toString());
  }

  /**
   * The detail names the address, role, inviter and expiry, and offers Revoke.
   */
  public function testDetailShowsTheInvitationAndOffersRevoke(): void {
    $this->setCurrentUser($this->lead);
    $html = $this->renderFace('bb_invite_inspector');
    foreach (['newcomer@example.com', 'Role', 'Invited by', 'lead', 'Expires', 'Invited'] as $text) {
      self::assertStringContainsString($text, $html);
    }
    $actions = $this->renderFace('bb_invite_actions');
    self::assertStringContainsString('Revoke invitation', $actions);
    self::assertStringContainsString($this->invite->toUrl('delete-form')->toString(), $actions, 'Revoke opens its confirmation.');
  }

  /**
   * A guest gets neither the page nor Revoke.
   */
  public function testGuestGetsNoRouteAndNoAction(): void {
    $access = $this->container->get('access_manager');
    $parameters = ['bb_workspace' => 'acme', 'bb_invite' => $this->invite->id()];
    self::assertTrue($access->checkNamedRoute('entity.bb_invite.canonical', $parameters, $this->lead));
    self::assertFalse($access->checkNamedRoute('entity.bb_invite.canonical', $parameters, $this->guest));

    $this->setCurrentUser($this->guest);
    self::assertStringNotContainsString('Revoke', $this->renderFace('bb_invite_actions'));
  }

  /**
   * Renders one detail source for the invitation.
   */
  private function renderFace(string $source_id): string {
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance($source_id, SourcePluginBase::buildConfiguration('slot', ['type' => 'slot'], ['source' => []], []));
    self::assertInstanceOf(SourcePluginBase::class, $source);
    $source->setContextValue('entity', $this->invite);
    $build = $source->getPropValue();
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

}
