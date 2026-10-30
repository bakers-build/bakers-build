<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel\Tool;

use Drupal\Tests\bb_track\Kernel\WorkTimeTestBase;
use Drupal\tool\FormattedToolResultInterface;

/**
 * Runs time tools through the runner the MCP bridge uses.
 */
abstract class TimeToolTestBase extends WorkTimeTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'system', 'user', 'field', 'options', 'text', 'link',
    'filter', 'datetime', 'entity', 'state_machine', 'og', 'serialization',
    'jsonapi', 'island', 'bb_core', 'bb_track', 'tool',
  ];

  /**
   * Runs a tool as the current user.
   *
   * @param string $id
   *   The tool plugin id.
   * @param array<string, mixed> $values
   *   Input values.
   */
  protected function runTool(string $id, array $values): FormattedToolResultInterface {
    return $this->container->get('tool.runner')->run($id, $values)->getFormattedResult();
  }

  /**
   * The successful result's outputs.
   *
   * @return array<string, mixed>
   *   Outputs keyed by name.
   */
  protected function outputs(FormattedToolResultInterface $result): array {
    self::assertTrue($result->isSuccess(), (string) $result->getMessage());
    return $result->getContextValues();
  }

  /**
   * Asserts a failed result whose message contains the given text.
   */
  protected function assertFailure(FormattedToolResultInterface $result, string $text): void {
    self::assertFalse($result->isSuccess());
    self::assertStringContainsString($text, (string) $result->getMessage());
  }

}
