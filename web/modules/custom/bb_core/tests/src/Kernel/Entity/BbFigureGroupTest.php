<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Entity;

use Drupal\Core\Config\Entity\ImportableEntityStorageInterface;
use Drupal\bb_core\Entity\BbFigureGroup;
use Drupal\bb_core\BbFigureGroupInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers titled, ordered figure groups.
 */
#[Group('bb_core')]
final class BbFigureGroupTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['file', 'image', 'system', 'user', 'bb_core'];

  /**
   * A group retains figure order and declares every reference as a dependency.
   */
  public function testGroupPreservesOrderedFigureReferences(): void {
    $group = BbFigureGroup::create([
      'id' => 'overview',
      'label' => 'Overview',
      'weight' => -10,
      'figures' => ['project_overview', 'user_overview'],
    ]);

    self::assertInstanceOf(BbFigureGroupInterface::class, $group);
    self::assertSame(['project_overview', 'user_overview'], $group->getFigures());
    self::assertSame(-10, $group->getWeight());
    self::assertSame([
      'bb_core.bb_figure.project_overview',
      'bb_core.bb_figure.user_overview',
    ], $group->calculateDependencies()->getDependencies()['config']);
  }

  /**
   * Figure groups cannot save references to missing figures.
   */
  public function testGroupRejectsUnknownFigureReference(): void {
    $group = BbFigureGroup::create([
      'id' => 'invalid_group',
      'label' => 'Invalid group',
      'weight' => 0,
      'figures' => ['missing'],
    ]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('bakers.build figure group "invalid_group" references unknown figure "missing".');
    $group->save();
  }

  /**
   * Configuration imports run the same reference validation as form saves.
   */
  public function testImportRejectsUnknownFigureReference(): void {
    $name = 'bb_core.bb_figure_group.imported_invalid_group';
    $new = $this->container->get('config.factory')->getEditable($name);
    $old = clone $new;
    $new->setData([
      'id' => 'imported_invalid_group',
      'label' => 'Imported invalid group',
      'weight' => 0,
      'figures' => ['missing'],
    ]);

    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('bakers.build figure group "imported_invalid_group" references unknown figure "missing".');
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_figure_group');
    self::assertInstanceOf(ImportableEntityStorageInterface::class, $storage);
    $storage->importCreate($name, $new, $old);
  }

}
