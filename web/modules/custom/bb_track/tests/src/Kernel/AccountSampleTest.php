<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Entity\ContentEntityTypeInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\bb_track\Entity\Account;
use PHPUnit\Framework\Attributes\Group;

/**
 * A non-bb_core type's display preview expands no references.
 *
 * Saving an account display during a CLI config import builds this sample as
 * anonymous; core's recursive reference samples exhausted the deploy memory.
 */
#[Group('bb_track')]
final class AccountSampleTest extends WorkTimeTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'file', 'image', 'system', 'user', 'field', 'options', 'text', 'link',
    'filter', 'datetime', 'entity', 'state_machine', 'og', 'serialization',
    'jsonapi', 'island', 'ui_patterns', 'bb_core', 'bb_track',
  ];

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
    $schema = $this->container->get('database')->schema();
    foreach ($this->container->get('entity_type.manager')->getDefinitions() as $id => $definition) {
      if ($definition instanceof ContentEntityTypeInterface && !$schema->tableExists($definition->getBaseTable())) {
        $this->installEntitySchema($id);
      }
    }
  }

  /**
   * An anonymous import builds a flat account sample without warnings.
   */
  public function testAnonymousAccountSampleIsFlat(): void {
    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    $previous_limit = ini_set('memory_limit', '384M');
    set_error_handler(static function (int $level, string $message, string $file, int $line): never {
      throw new \ErrorException($message, 0, $level, $file, $line);
    }, E_WARNING);
    try {
      $sample = $this->container->get('ui_patterns.sample_entity_generator')->get('bb_track_account', 'bb_track_account');
    }
    finally {
      restore_error_handler();
      ini_set('memory_limit', $previous_limit);
    }

    self::assertInstanceOf(Account::class, $sample);
    self::assertTrue($sample->isNew());
    self::assertTrue($sample->get('project_id')->isEmpty());
    self::assertTrue($sample->get('tickets')->isEmpty());
    self::assertSame(0, (int) $this->container->get('database')->select('file_managed')->countQuery()->execute()->fetchField());
  }

}
