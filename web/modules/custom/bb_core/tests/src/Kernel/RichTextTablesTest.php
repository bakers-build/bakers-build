<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies GFM tables, with column alignment, survive the bb_rich format.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RichTextTablesTest extends KernelTestBase {

  /**
   * An aligned table: left, center, right and one column without alignment.
   */
  private const ALIGNED_TABLE = "| A | B | C | D |\n|:---|:---:|---:|---|\n| 1 | 2 | 3 | 4 |\n";

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'markdown_easy', 'og', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    foreach (['bb_comment', 'bb_ticket', 'bb_project', 'bb_group', 'bb_workspace'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'filter', 'markdown_easy', 'bb_core']);
  }

  /**
   * A description-style text renders a table that keeps its alignment.
   */
  public function testAlignedTableKeepsAlignment(): void {
    $this->assertAlignedTable($this->process(self::ALIGNED_TABLE));
  }

  /**
   * A comment body, which uses the same format, renders the same table.
   */
  public function testCommentBodyKeepsAlignment(): void {
    $author = $this->container->get('entity_type.manager')->getStorage('user')->create(['name' => 'author']);
    $author->save();
    $comment = $this->container->get('entity_type.manager')->getStorage('bb_comment')->create([
      'ticket_id' => 1,
      'author' => $author->id(),
      'body' => ['value' => self::ALIGNED_TABLE, 'format' => 'bb_rich'],
    ]);
    $comment->save();
    $this->assertInstanceOf(ContentEntityInterface::class, $comment);

    $this->assertAlignedTable((string) $comment->get('body')->processed);
  }

  /**
   * Pipes in prose and code spans stay text.
   */
  #[DataProvider('pipesProvider')]
  public function testPipesOutsideTablesStayText(string $markdown): void {
    $this->assertStringNotContainsString('<table', $this->process($markdown));
  }

  /**
   * Pipe shapes that are not a table.
   *
   * @return array<string, array{string}>
   *   Markdown inputs keyed by shape.
   */
  public static function pipesProvider(): array {
    return [
      'code span' => ["Sizes are `auto|none|sm|md|lg`.\n"],
      'prose' => ["Pick one of bug|feature|chore.\n"],
      'line of its own' => ["foo | bar\n"],
    ];
  }

  /**
   * Runs text through the bb_rich format.
   */
  private function process(string $markdown): string {
    $build = ['#type' => 'processed_text', '#text' => $markdown, '#format' => 'bb_rich'];
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Asserts the table structure and its per-column alignment.
   */
  private function assertAlignedTable(string $html): void {
    $this->assertStringContainsString('<table>', $html);
    $this->assertStringContainsString('<thead>', $html);
    $this->assertStringContainsString('<tbody>', $html);
    foreach ([['A', '1', 'left'], ['B', '2', 'center'], ['C', '3', 'right']] as [$head, $cell, $align]) {
      $this->assertStringContainsString("<th class=\"markdown-align-$align\">$head</th>", $html);
      $this->assertStringContainsString("<td class=\"markdown-align-$align\">$cell</td>", $html);
    }
    $this->assertStringContainsString('<th>D</th>', $html);
    $this->assertStringContainsString('<td>4</td>', $html);
  }

}
