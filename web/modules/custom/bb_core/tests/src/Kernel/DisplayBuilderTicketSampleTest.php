<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityTypeInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\bb_core\Entity\BbTicket;
use PHPUnit\Framework\Attributes\Group;

/**
 * Preview generation must fit the deploy budget without a reference graph.
 */
#[Group('bb_core')]
final class DisplayBuilderTicketSampleTest extends BbEntityKernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected function setUpFilesystem(): void {
    parent::setUpFilesystem();
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('file');
    $this->installSchema('file', ['file_usage']);
    foreach ($this->container->get('entity_type.manager')->getDefinitions() as $id => $definition) {
      if ($definition instanceof ContentEntityTypeInterface && $definition->getProvider() === 'bb_core' && !$this->container->get('database')->schema()->tableExists($definition->getBaseTable())) {
        $this->installEntitySchema($id);
      }
    }
  }

  /**
   * A CLI import can generate an anonymous ticket preview without recursion.
   */
  public function testAnonymousTicketPreviewFitsDeployMemoryLimit(): void {
    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    $generator = $this->container->get('ui_patterns.sample_entity_generator');
    $generator->delete('bb_ticket', 'bb_ticket');
    $previous_limit = ini_set('memory_limit', '384M');
    // The old state sample generator also warns while traversing the graph.
    // Keep this regression focused on the deploy's fatal memory exhaustion.
    set_error_handler(static fn(int $level, string $message): bool => $level === E_WARNING && str_contains($message, 'Undefined array key "value"'));
    try {
      $sample = $generator->get('bb_ticket', 'bb_ticket');
    }
    finally {
      restore_error_handler();
      ini_set('memory_limit', $previous_limit);
    }

    self::assertInstanceOf(BbTicket::class, $sample);
    self::assertTrue($sample->isNew());
    self::assertNotEmpty($sample->label());
    self::assertLessThan(65536, strlen(serialize($sample)));
    foreach (['parent_id', 'blocked_by', 'referenced_tickets', 'comments', 'handoff_comments', 'runs'] as $field) {
      self::assertTrue($sample->get($field)->isEmpty(), "$field must not generate or load a referenced entity graph.");
    }
    self::assertSame($sample->uuid(), $generator->get('bb_ticket', 'bb_ticket')->uuid());
    self::assertTrue($sample->getState()->isValid());
    self::assertSame(0, (int) $this->container->get('database')->select('file_managed')->countQuery()->execute()->fetchField());
    $generator->delete('bb_ticket', 'bb_ticket');
    self::assertNotSame($sample->uuid(), $generator->get('bb_ticket', 'bb_ticket')->uuid());
  }

}
