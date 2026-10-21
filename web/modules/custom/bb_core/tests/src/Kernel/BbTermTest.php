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
    BbVocabulary::create(['id' => 'bb_labels', 'label' => 'bakers.build labels'])->save();
  }

  /**
   * A term is created in a vocabulary bundle and reloads with its name.
   */
  public function testTermCreateInBundle(): void {
    $term = BbTerm::create(['vid' => 'bb_labels', 'name' => 'customer-visible']);
    $term->save();

    $loaded = BbTerm::load($term->id());
    $this->assertInstanceOf(BbTerm::class, $loaded);
    $this->assertSame('bb_labels', $loaded->bundle());
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
