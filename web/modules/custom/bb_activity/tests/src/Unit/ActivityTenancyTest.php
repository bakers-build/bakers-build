<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Unit;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Access\WorkspaceResolver;
use Drupal\bb_core\EventSubscriber\WorkspaceReadScopeSubscriber;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Activities declare their tenancy on their entity type, not in bb_core.
 */
#[Group('bb_activity')]
final class ActivityTenancyTest extends UnitTestCase {

  /**
   * An activity walks to its workspace through its ticket, like a comment.
   */
  public function testActivityDeclaresTheTicketPath(): void {
    $additional = $this->additional();
    $chains = (new \ReflectionClass(WorkspaceResolver::class))->getConstant('CHAINS');
    self::assertIsArray($chains);
    self::assertSame($chains['bb_comment'], $additional['bb_workspace_path'] ?? NULL);
    self::assertArrayNotHasKey('bb_activity', $chains);
  }

  /**
   * The JSON:API filter set covers it; the read-scope subscriber has no rule.
   *
   * Its query handler materializes readable ticket ids, so the subscriber must
   * not grow a `ticket_id.entity.project_id` rule for this type.
   */
  public function testActivityJoinsTheFilterScopeWithoutDottedRule(): void {
    self::assertTrue($this->additional()['bb_jsonapi_filter_scope'] ?? FALSE);
    $method = (new \ReflectionClass(WorkspaceReadScopeSubscriber::class))->getMethod('rules');
    self::assertArrayNotHasKey('bb_activity', $method->invoke(NULL));
  }

  /**
   * The `additional` properties of the activity entity type attribute.
   *
   * @return array<string, mixed>
   *   The properties.
   */
  private function additional(): array {
    $attributes = (new \ReflectionClass(BbActivity::class))->getAttributes(ContentEntityType::class);
    self::assertCount(1, $attributes);
    $arguments = $attributes[0]->getArguments();
    return $arguments['additional'] ?? [];
  }

}
