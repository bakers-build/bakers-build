<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * The `island_id` description states what it is AND when it applies (BB-396).
 *
 * `island_id` is the one field on this settings form a page-layout author
 * cannot infer from anything else: it is the container's own DOM id, the
 * exact string every OTHER container's `swap_target` has to spell correctly
 * to hit it. A description that only says WHEN the field matters and never
 * says WHAT the field is would send that author guessing the id's shape from
 * the placeholder alone.
 *
 * PHP array literals keep only the LAST value for a repeated key, silently —
 * no warning at the surface an editor sees, the array simply builds with half
 * its authored text gone. That is exactly what `IslandSource::settingsForm()`
 * did: it declared `#description` once for the WHAT (the DOM id, what targets
 * it) and once for the WHEN (only without a plugin, and what that costs), and
 * only the second survived PHP building the array.
 *
 * So the assertion is on the BUILT form, not on the source file: it has to
 * see both halves in the one string PHP actually keeps, or a future duplicate
 * key regresses this silently again, exactly as phpstan's `array.duplicateKey`
 * and phpmd's `DuplicatedArrayKey` would both stay quiet about a second
 * unrelated `#description` collision one field down.
 */
#[Group('island')]
final class IslandSourceSettingsFormTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['system', 'user', 'ui_patterns', 'island'];

  /**
   * {@inheritdoc}
   *
   * Constructing the source reaches the context repository, whose
   * current-user provider loads the account, so the user schema is load
   * bearing here too (see IslandSourcePluginModeTest).
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
  }

  /**
   * The built `island_id` description carries both the WHAT and the WHEN.
   */
  public function testIslandIdDescriptionStatesWhatAndWhen(): void {
    /** @var \Drupal\ui_patterns\SourcePluginManager $manager */
    $manager = $this->container->get('plugin.manager.ui_patterns_source');
    /** @var \Drupal\ui_patterns\SourceInterface $source */
    $source = $manager->createInstance('island', [
      'source_id' => 'island',
      'settings' => [],
    ]);

    $form = $source->settingsForm([], new FormState());
    $description = (string) $form['island_id']['#description'];

    $this->assertStringContainsString(
      'DOM id',
      $description,
      'The field still says WHAT island_id is: the container\'s own DOM id.',
    );
    $this->assertStringContainsString(
      'not addressable',
      $description,
      'The field still says WHEN it applies: only without a plugin, and that the container is then not addressable.',
    );
  }

}
