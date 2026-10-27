<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTerm;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests the node-free bb_term content entity and its config bundle.
 */
#[Group('bb_core')]
final class BbTermTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'field', 'og',
    'bb_core',
    'bb_connector',
    'options',
    'link',
    'text',
    'user',
    'state_machine',
    'entity',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_term');
    $this->installEntitySchema('og_membership');
    foreach (['type', 'recipe', 'label'] as $vid) {
      BbVocabulary::create(['id' => $vid, 'label' => $vid])->save();
    }
  }

  /**
   * The three term bundles exist.
   */
  public function testTypeRecipeAndLabelBundles(): void {
    $bundles = array_keys($this->container->get('entity_type.bundle.info')->getBundleInfo('bb_term'));
    sort($bundles);
    $this->assertSame(['label', 'recipe', 'type'], $bundles);
  }

  /**
   * Terms have add and edit forms in their workspace, and no page of their own.
   */
  public function testTermRoutesAreAddAndEditOnly(): void {
    $routes = $this->container->get('router.route_provider');
    $this->assertSame('/_workspace/{bb_workspace}/term/{bb_vocabulary}/add', $routes->getRouteByName('entity.bb_term.add_form')->getPath());
    $this->assertSame('/_workspace/{bb_workspace}/term/{bb_term}/edit', $routes->getRouteByName('entity.bb_term.edit_form')->getPath());
    foreach (['canonical', 'delete_form', 'collection'] as $link) {
      $this->assertEmpty($routes->getRoutesByNames(["entity.bb_term.$link"]), "entity.bb_term.$link must not exist");
    }
  }

  /**
   * A term is created in a vocabulary bundle and reloads with its name.
   */
  public function testTermCreateInBundle(): void {
    $term = BbTerm::create(['vid' => 'label', 'name' => 'customer-visible']);
    $term->save();

    $loaded = BbTerm::load($term->id());
    $this->assertInstanceOf(BbTerm::class, $loaded);
    $this->assertSame('label', $loaded->bundle());
    $this->assertSame('customer-visible', $loaded->label());
  }

  /**
   * The taxonomy module (and thus node) is NOT required.
   */
  public function testNoTaxonomyDependency(): void {
    $this->assertFalse(
      \Drupal::moduleHandler()->moduleExists('taxonomy'),
      'bb_term must not pull in the taxonomy module.',
    );
  }

}
