<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\block\Entity\Block;
use Drupal\Core\Config\Schema\SchemaIncompleteException;
use Drupal\KernelTests\KernelTestBase;
use Drupal\system\Entity\Menu;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Routing\Exception\RouteNotFoundException;

/**
 * A placed Drupal block is not a way to declare an island (BB-489).
 *
 * WHY THIS IS A TEST AND NOT A DELETION NOTE. The mechanism this pins the
 * absence of was real, shipped and documented: an "Island" fieldset on every
 * block configuration form wrote `island.enabled`, `island.boost` and
 * `island.swap_target` as third-party settings, `hook_block_view_alter` wrapped
 * the opted-in block, and `island.block` re-rendered it on its own. It was
 * withdrawn because no block placement in the product ever opted in — measured
 * across `config/sync`, `recipes/`, every custom module, and the develop and
 * prod environments — while it was the sole reason the boosted GET path could
 * not simply root-render, which is the defect BB-489 exists to fix.
 *
 * A removal like that comes back by accident. Someone re-reads the old README,
 * or a `hook_form_alter` that "just adds a checkbox" looks harmless, and the
 * wrapper collision the fix eliminated is reachable again. So the absence is
 * asserted at the two places the feature was observable: the form a site
 * builder would have used, and the route a client would have called.
 *
 * The third case below was a surprise worth keeping. Removing the settings'
 * SCHEMA is what makes them unwritable: with strict schema checking on — every
 * Kernel and Functional test, and any development site with
 * `twig.config.debug` — a save carrying `third_party_settings.island` now
 * throws. So the mechanism is not merely unread, it is unstorable, and the
 * assertion is stated as the exception rather than as a rendering.
 */
#[Group('island')]
final class BlockIslandificationRemovedTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['system', 'user', 'path_alias', 'block', 'island', 'island_test'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('path_alias');
    $this->installConfig(['system']);
    $this->container->get('theme_installer')->install(['stark']);
    $this->container->get('config.factory')->getEditable('system.theme')->set('default', 'stark')->save();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * The block configuration form offers no "Island" fieldset.
   *
   * The form is BUILT rather than inspected for a hook implementation: what a
   * site builder can do is what the built form contains, and an implementation
   * could be reintroduced under any name.
   */
  public function testTheBlockFormOffersNoIslandFieldset(): void {
    $form = $this->container->get('entity_type.manager')
      ->getFormObject('block', 'default')
      ->setEntity($this->createBlock());
    $built = $this->container->get('form_builder')->getForm($form);

    self::assertArrayNotHasKey('island', $built, 'the block form declares no island fieldset');
    self::assertArrayNotHasKey('island_enabled', $built, 'and no stray checkbox outside one');
  }

  /**
   * The island.block route is gone, so no client can call it.
   */
  public function testTheIslandBlockRouteDoesNotExist(): void {
    $this->expectException(RouteNotFoundException::class);
    $this->container->get('router.route_provider')->getRouteByName('island.block');
  }

  /**
   * A block renders as an ordinary block, with no island wrapper.
   *
   * This is the assertion that fails if `hook_block_view_alter` comes back: the
   * hook ran inside the block's lazy builder, so rendering is what would show
   * it. No opt-in is written, because there is no longer any way to write one
   * — which the next test is about.
   */
  public function testBlockRendersWithoutAnIslandWrapper(): void {
    $block = $this->createBlock();
    $block->save();

    $build = $this->container->get('entity_type.manager')->getViewBuilder('block')->view($block);
    // Block builds are lazy; rendering is what would run the view alter.
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);

    self::assertStringNotContainsString('island-block-', $html, 'no island wrapper is added');
    self::assertStringNotContainsString('data-hx-boost', $html, 'and no declaration either');
    self::assertStringContainsString('<nav', $html, 'the block itself still renders');
  }

  /**
   * The old third-party settings can no longer be STORED, not merely read.
   *
   * `config/schema/island.schema.yml` declared
   * `block.block.*.third_party.island` and no longer does, so the key has no
   * schema of its own any more. Under strict schema checking
   * — every Kernel and Functional test, and any site with `twig.config.debug`
   * — saving it is an error rather than a silently unread key. Asserting the
   * exception is what makes the schema deletion part of the contract instead of
   * a tidy-up someone could reverse without noticing.
   */
  public function testTheOldThirdPartySettingsCannotBeSaved(): void {
    $block = $this->createBlock();
    $block->setThirdPartySetting('island', 'enabled', TRUE);

    $this->expectException(SchemaIncompleteException::class);
    $this->expectExceptionMessage('third_party_settings.island.enabled missing schema');
    $block->save();
  }

  /**
   * A block wrapper id resolves to nothing, so it cannot be named in a header.
   *
   * The resolver no longer consults block storage at all, so a saved, ordinary
   * block is the right fixture: what used to make this id resolve was the
   * opt-in, and the opt-in is what is gone.
   */
  public function testBlockWrapperIdResolvesToNoIsland(): void {
    $this->createBlock()->save();

    self::assertNull(
      $this->container->get('island.host_resolver')->resolveHtmlId('island-block-removed_menu'),
    );
  }

  /**
   * Creates a plain menu block in the default theme.
   */
  private function createBlock(): Block {
    if (Menu::load('account') === NULL) {
      Menu::create(['id' => 'account', 'label' => 'Account menu'])->save();
    }

    return Block::create([
      'id' => 'removed_menu',
      'theme' => 'stark',
      'region' => 'content',
      'plugin' => 'system_menu_block:account',
      'settings' => ['label' => 'Account menu', 'label_display' => 'visible'],
    ]);
  }

}
