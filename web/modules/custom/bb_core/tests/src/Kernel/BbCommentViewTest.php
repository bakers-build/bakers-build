<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies bb_comment renders body + type label via its view builder.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbCommentViewTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * `og` carries the config schema for the og.og_role.* entities bb_core
   * ships in config/install (BB-316); without it installConfig() aborts on
   * "No schema for og.og_role.bb_workspace-…". A kernel test enables exactly
   * the modules it lists — it never resolves bb_core.info.yml's dependencies.
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
    $this->installEntitySchema('bb_comment');
    // Rendering a comment builds its canonical URL, and since BB-350 that
    // URL carries a workspace segment, so WorkspaceResolver walks
    // ticket_id → project_id → group_id → workspace_id. Every table on that
    // chain has to exist or the render dies on a missing table rather than on
    // anything this test is about.
    foreach (['bb_ticket', 'bb_project', 'bb_group', 'bb_workspace'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'bb_core']);
  }

  /**
   * Rendering a comment surfaces its body and its type.
   *
   * The type prints as the raw machine name: `type` is free text (BB-227), so
   * the `string` formatter replaced `list_default` and there is no humanised
   * label to print — the machine name IS the label. A machine-name-to-label map
   * would re-introduce exactly the maintained vocabulary that change removed,
   * one release behind the values it labels.
   */
  public function testCommentRendersBodyAndType(): void {
    $etm = $this->container->get('entity_type.manager');
    $author = $etm->getStorage('user')->create(['name' => 'author']);
    $author->save();
    $comment = $etm->getStorage('bb_comment')->create([
      'ticket_id' => 1,
      'author' => $author->id(),
      'body' => ['value' => 'rendered body text', 'format' => 'bb_rich'],
      'type' => 'spec',
    ]);
    $comment->save();

    $build = $etm->getViewBuilder('bb_comment')->view($comment);
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);

    $this->assertStringContainsString('rendered body text', $html);
    // Match label + value as rendered text rather than searching the raw markup
    // for 'spec' — a bare needle would also be satisfied by a CSS class.
    $text = trim((string) preg_replace('/\s+/', ' ', strip_tags($html)));
    $this->assertStringContainsString('Type spec', $text);
    $this->assertStringNotContainsString('Type Spec', $text,
      'The raw machine name is the label now; nothing humanises it.');
  }

}
