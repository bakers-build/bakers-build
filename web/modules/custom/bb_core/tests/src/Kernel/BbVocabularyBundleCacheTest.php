<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * A bb_vocabulary invalidates the cached bundle list of bb_term.
 *
 * `bb_vocabulary` is the bundle config entity of `bb_term`, and
 * `EntityTypeBundleInfo::getAllBundleInfo()` computes and CACHES the bundles of
 * every entity type in ONE pass. So whatever asks for any entity type's bundles
 * first freezes `bb_term`'s bundle list for the rest of the request, and a
 * bundle created afterwards is invisible to every later reader — including
 * `EntityDisplayBase::preSave()` → `init()` and ui_patterns'
 * `SampleEntityGenerator`, which is how BB-413 and BB-421 both saw
 * `Missing entity bundle. The "bb_labels" bundle does not exist` abort a
 * recipe application.
 *
 * Core's own mechanism for this is `ConfigEntityBundleBase`, whose `postSave()`
 * and `postDelete()` reach `EntityBundleListener`, which clears the cache
 * first thing. This class pins that the vocabulary participates in it, because
 * the alternative — declaring `dependencies.enforced.config` on every display
 * that might read the cache — is a workaround that also makes those displays
 * unusable on the plain module-install path (see `ModuleConfigInstallTest`).
 */
#[Group('bb_core')]
final class BbVocabularyBundleCacheTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'field',
    'og',
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
  }

  /**
   * Saving a vocabulary makes its bundle visible to an already-primed cache.
   */
  public function testCreatingVocabularyInvalidatesTheBundleCache(): void {
    $bundle_info = $this->container->get('entity_type.bundle.info');

    // Prime the cache the way a config save does, BEFORE the bundle exists.
    self::assertArrayNotHasKey('bb_labels', $bundle_info->getBundleInfo('bb_term'));

    BbVocabulary::create(['id' => 'bb_labels', 'label' => 'bakers.build labels'])->save();

    self::assertArrayHasKey(
      'bb_labels',
      $bundle_info->getBundleInfo('bb_term'),
      'A vocabulary created after the bundle cache was primed is still visible.',
    );
  }

  /**
   * A vocabulary saved before the cache is primed is visible too.
   *
   * The companion of the case above: the fix must not make the ordinary order
   * of events worse.
   */
  public function testVocabularySavedFirstIsVisible(): void {
    BbVocabulary::create(['id' => 'bb_labels', 'label' => 'bakers.build labels'])->save();

    self::assertArrayHasKey(
      'bb_labels',
      $this->container->get('entity_type.bundle.info')->getBundleInfo('bb_term'),
    );
  }

  /**
   * Deleting a vocabulary removes its bundle from a primed cache.
   */
  public function testDeletingVocabularyInvalidatesTheBundleCache(): void {
    $bundle_info = $this->container->get('entity_type.bundle.info');
    $vocabulary = BbVocabulary::create(['id' => 'bb_labels', 'label' => 'bakers.build labels']);
    $vocabulary->save();
    self::assertArrayHasKey('bb_labels', $bundle_info->getBundleInfo('bb_term'));

    $vocabulary->delete();

    self::assertArrayNotHasKey(
      'bb_labels',
      $bundle_info->getBundleInfo('bb_term'),
      'A deleted vocabulary leaves no bundle behind in the cache.',
    );
  }

}
