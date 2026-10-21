<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The display preview sample of an activity expands no references.
 *
 * Core fills every reference with a further sample, recursively; an activity
 * reaches a ticket, a run and a comment that each reach tickets again, which
 * outgrew the database packet limit during the recipe install.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ActivitySampleEntityTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'ui_patterns', 'bb_core', 'bb_activity',
  ];

  /**
   * The sample is lean, small and kept for the next preview.
   */
  public function testActivitySampleExpandsNoReferences(): void {
    $this->installEntitySchema('user');
    $this->installEntitySchema('bb_activity');
    $generator = $this->container->get('ui_patterns.sample_entity_generator');

    $sample = $generator->get('bb_activity', 'bb_activity');
    self::assertInstanceOf(FieldableEntityInterface::class, $sample);

    foreach (['ticket_id', 'run_id', 'comment_id', 'conductor_id', 'actor', 'accounts'] as $field) {
      self::assertTrue($sample->get($field)->isEmpty(), "$field holds no sample entity.");
    }
    self::assertLessThan(100000, strlen(serialize($sample)));
    self::assertSame($sample->uuid(), $generator->get('bb_activity', 'bb_activity')->uuid());
  }

}
