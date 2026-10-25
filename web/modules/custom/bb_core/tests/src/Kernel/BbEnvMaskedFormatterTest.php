<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the bb_env_masked field formatter (BB-99).
 *
 * The formatter renders effective_env_vars as masked rows — key + origin only,
 * never a value — so nothing sensitive reaches the render array or the markup.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbEnvMaskedFormatterTest extends KernelTestBase {

  use UserCreationTrait;

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
    // Renders as an admin so that field access can never be what a failure
    // here is about — masking is what's under test. This used to be
    // load-bearing: BB-99 gated effective_env_vars on exactly this
    // permission. BB-454 round 4 retired that gate, so the privileged
    // account is now insurance rather than a precondition.
    $this->setUpCurrentUser([], ['administer bakers']);
  }

  /**
   * Creates and saves a bb_ticket with the given field values.
   *
   * @param array<string, mixed> $values
   *   Field values to set on the ticket.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved ticket.
   */
  private function ticket(array $values): ContentEntityInterface {
    $t = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['workflow' => 'bb_work', 'state' => 'todo'] + $values);
    assert($t instanceof ContentEntityInterface);
    $t->save();
    return $t;
  }

  /**
   * The formatter emits a `list` of masked items, with origins and no values.
   *
   * Asserts the component id AND the cell structure. The id alone would pass
   * for a formatter that addressed `list` while handing it the shape the
   * deleted component took, and `list` drops what it cannot key: a `rows` prop
   * on a container that declares `items` renders an empty list, which looks
   * exactly like a ticket that sets no variables.
   */
  public function testMaskedItemsWithOriginNoValue(): void {
    $parent = $this->ticket(['title' => 'Parent', 'env_vars' => 'OWNED=secretval']);
    $child = $this->ticket([
      'title' => 'Child',
      'parent_id' => $parent->id(),
      'env_vars' => 'MINE=alsosecret',
    ]);

    $build = $child->get('effective_env_vars')->view(['type' => 'bb_env_masked', 'label' => 'hidden']);
    $props = $build[0]['#props'];

    self::assertSame('bb_theme:list', $build[0]['#component']);
    self::assertSame('lines', $props['layout']);
    self::assertArrayNotHasKey('rows', $props, 'A `list` owns `items`; `rows` is `table`\'s prop.');

    $byName = [];
    foreach ($props['items'] as $item) {
      $cells = $item['cells'];
      // The variable name is a machine name, so it is a `mono` cell.
      self::assertSame('mono', $cells['name']['kind']);
      // The value is a `masked` cell that carries NO value to unmask.
      self::assertSame(['kind' => 'masked'], $cells['value']);
      // Provenance is a quiet badge whose LABEL names it, never colour alone.
      self::assertSame('badge', $cells['origin']['kind']);
      self::assertSame('neutral', $cells['origin']['tone']);
      $byName[$cells['name']['value']] = $cells['origin']['label'];
    }
    self::assertSame('own', $byName['MINE']);
    self::assertSame('inherited', $byName['OWNED']);

    // No value — secret or otherwise — appears anywhere in the render array.
    $json = (string) json_encode($props);
    self::assertStringNotContainsString('secretval', $json);
    self::assertStringNotContainsString('alsosecret', $json);
  }

  /**
   * An empty effective set renders nothing (no wrapper).
   */
  public function testEmptyRendersNothing(): void {
    $t = $this->ticket(['title' => 'Empty']);
    $build = $t->get('effective_env_vars')->view(['type' => 'bb_env_masked', 'label' => 'hidden']);
    self::assertArrayNotHasKey(0, $build);
  }

}
