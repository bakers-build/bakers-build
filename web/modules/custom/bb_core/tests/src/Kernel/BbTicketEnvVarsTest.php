<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the stored `env_vars` field on bb_ticket (BB-99).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbTicketEnvVarsTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_group', 'bb_project', 'bb_ticket'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
  }

  /**
   * The env_vars value survives a write/reload round-trip verbatim.
   */
  public function testEnvVarsRoundTrip(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $ticket = $storage->create([
      'workflow' => 'bb_feature',
      'state' => 'todo',
      'title' => 'With env',
      'env_vars' => "A=1\nB=2",
    ]);
    assert($ticket instanceof ContentEntityInterface);
    $ticket->save();

    $storage->resetCache();
    $reloaded = $storage->load($ticket->id());
    assert($reloaded instanceof ContentEntityInterface);
    self::assertSame("A=1\nB=2", $reloaded->get('env_vars')->value);
  }

}
