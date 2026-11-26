<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A Catalog row is one link, to its term's or environment's edit form.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CatalogRowLinkTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;
  use ProjectsViewTestTrait;
  use ListRowLinkTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'views', 'better_exposed_filters',
    'ui_patterns', 'ui_patterns_views', 'block', 'ui_patterns_field', 'display_builder', 'display_builder_entity_view', 'display_builder_views', 'island',
    'bb_core',
  ];

  /**
   * The label term of workspace a.
   */
  private ContentEntityInterface $term;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    foreach (['a', 'b'] as $side) {
      $this->fixture($side, 'bb_workspace')->set('slug', "space-$side")->save();
    }
    $this->installConfig(['views']);
    $this->installShippedView('views.view.bb_terms');
    $this->installShippedView('views.view.bb_environments');
    $this->container->get('router.builder')->rebuild();
    $this->term = $this->fixture('a', 'bb_term');
    $this->container->get('current_user')->setAccount($this->createAccount('catalog-admin', ['administer bakers']));
  }

  /**
   * A term row opens the term's edit form.
   */
  public function testTermRowOpensTheEditForm(): void {
    $html = $this->renderListDisplay('bb_terms', 'labels', ['space-a']);

    $this->assertRowsLinkOnlyToTheirDetail($html, ['/space-a/term/' . $this->term->id() . '/edit']);
  }

  /**
   * An environment row opens the environment's edit form.
   */
  public function testEnvironmentRowOpensTheEditForm(): void {
    $environment = $this->fixture('a', 'bb_environment');

    $html = $this->renderListDisplay('bb_environments', 'catalog', ['space-a']);

    self::assertStringContainsString('href="/space-a/environment/' . $environment->id() . '/edit"', $html);
    self::assertStringNotContainsString('href="/space-a/environment/' . $environment->id() . '"', $html);
  }

  /**
   * A guest may follow no row: the edit and delete forms stay denied.
   */
  public function testGuestIsDeniedTheEditForm(): void {
    $guest = $this->createAccount('north-guest', []);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $guest, ['guest']);

    self::assertFalse($this->term->toUrl('edit-form')->access($guest));
    self::assertFalse($this->term->toUrl('delete-form')->access($guest));
  }

}
