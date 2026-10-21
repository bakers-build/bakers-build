<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The bb_track module brings and takes its own account menu entries.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class AccountMenuLinksTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine', 'file', 'image',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og', 'views',
    'ui_patterns', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // Uninstalling purges bb_track's user base field and user data.
    $this->installEntitySchema('user');
    $this->installSchema('user', ['users_data']);
  }

  /**
   * Installing bb_track adds Time and Schedule; uninstalling removes them.
   */
  public function testInstallAndUninstallControlTheEntries(): void {
    $ids = ['bb_track.account.time', 'bb_track.account.schedule'];
    $present = fn (): array => array_values(array_intersect($ids, $this->accountMenuLinkIds()));
    self::assertSame([], $present());

    $this->container->get('module_installer')->install(['bb_track']);
    self::assertSame($ids, $present());

    $this->container->get('module_installer')->uninstall(['bb_track']);
    self::assertSame([], $present());
  }

  /**
   * The plugin ids in the `bakers-account` menu.
   *
   * @return string[]
   *   Menu link plugin ids.
   */
  private function accountMenuLinkIds(): array {
    $manager = $this->container->get('plugin.manager.menu.link');
    return array_keys(array_filter(
      $manager->getDefinitions(),
      static fn (array $definition): bool => ($definition['menu_name'] ?? NULL) === 'bakers-account',
    ));
  }

}
