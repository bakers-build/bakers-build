<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A measurement written through its tool replaces only its own namespace.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MetricWriteToolTest extends BakersToolTestBase {

  /**
   * Replaces the namespace, keeps foreign rows and labels, unions the label.
   */
  public function testWriteReplacesNamespaceOnly(): void {
    $ui = $this->term('label', 'ui');
    $retro = $this->term('label', 'retro');
    $ticket = $this->ticket('TM-1', [
      'labels' => [$ui->id()],
      'metrics' => [
        ['name' => 'review_quality.score', 'value' => '1'],
        ['name' => 'review_quality.stale', 'value' => '9'],
        ['name' => 'job_rating.stars', 'value' => '4'],
      ],
    ]);
    $out = $this->outputs($this->runTool('bakers_metric_write', [
      'ticket' => $ticket->getIdentifier(),
      'name' => 'review_quality',
      'rows' => [
        ['name' => 'review_quality.score', 'value' => 0.75, 'unit' => 'ratio'],
        ['name' => 'review_quality.findings', 'value' => 3],
      ],
      'label' => 'retro',
    ]));
    $expected = [
      ['name' => 'job_rating.stars', 'value' => 4.0, 'unit' => NULL],
      ['name' => 'review_quality.score', 'value' => 0.75, 'unit' => 'ratio'],
      ['name' => 'review_quality.findings', 'value' => 3.0, 'unit' => NULL],
    ];
    self::assertEquals($expected, array_map(static fn (array $row): array => $row + ['unit' => NULL], $out['metrics']));
    $stored = $this->reload($ticket);
    self::assertSame(
      ['job_rating.stars', 'review_quality.score', 'review_quality.findings'],
      array_column($stored->get('metrics')->getValue(), 'name'),
    );
    self::assertEqualsCanonicalizing([$ui->id(), $retro->id()], array_column($stored->get('labels')->getValue(), 'target_id'));
  }

  /**
   * A missing label term is created in the ticket's workspace.
   */
  public function testMissingLabelIsCreated(): void {
    $ticket = $this->ticket('TM-2');
    $this->outputs($this->runTool('bakers_metric_write', [
      'ticket' => $ticket->getIdentifier(),
      'name' => 'job_rating',
      'rows' => [['name' => 'job_rating.stars', 'value' => 5]],
      'label' => 'retro',
    ]));
    $stored = $this->reload($ticket);
    $label = $stored->get('labels')->entity;
    self::assertInstanceOf(ContentEntityInterface::class, $label);
    self::assertSame('retro', $label->label());
    self::assertSame($this->workspace->id(), $label->get('workspace_id')->target_id);
  }

  /**
   * A row outside the namespace is an input error naming it; nothing is saved.
   */
  public function testForeignRowIsRejected(): void {
    $ticket = $this->ticket('TM-3', ['metrics' => [['name' => 'review_quality.score', 'value' => '1']]]);
    $this->assertFailure($this->runTool('bakers_metric_write', [
      'ticket' => $ticket->getIdentifier(),
      'name' => 'review_quality',
      'rows' => [['name' => 'job_rating.stars', 'value' => 5]],
    ]), 'job_rating.stars');
    $stored = $this->reload($ticket);
    $rows = array_map(static fn (array $row): array => [$row['name'], (float) $row['value']], $stored->get('metrics')->getValue());
    self::assertSame([['review_quality.score', 1.0]], $rows);
  }

}
