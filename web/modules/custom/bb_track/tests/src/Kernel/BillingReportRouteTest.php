<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Access\AccessResultReasonInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\Url;
use Drupal\Tests\bb_core\Kernel\Statistics\InsightsFixtureTrait;
use Drupal\bb_core\Access\BbWorkspaceAccessCheck;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the lead-only Insights › Billing report route and tab.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class BillingReportRouteTest extends WorkTimeTestBase {

  use InsightsFixtureTrait;

  private const ROUTE = 'bb_track.workspace.insights_billing';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['bb_conductor', 'bb_comment', 'bb_run', 'bb_term'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->container->get('router.builder')->rebuild();
    $this->installInsightsFigures();
  }

  /**
   * The public path is the workspace slug, insights, billing.
   */
  public function testRouteLivesUnderTheWorkspaceSlug(): void {
    self::assertSame('/week/insights/billing', Url::fromRoute(self::ROUTE, ['bb_workspace' => 'week'])->toString());
  }

  /**
   * A lead of the workspace may open the report, titled Insights.
   */
  public function testLeadGetsBillingReport(): void {
    self::assertTrue($this->access($this->employee)->isAllowed());
    $route = $this->container->get('router.route_provider')->getRouteByName(self::ROUTE);
    self::assertSame('Insights', $route->getDefault('_title'));
  }

  /**
   * Contributors, members and guests of the workspace get 403.
   */
  public function testNonLeadMemberGets403(): void {
    foreach (['contributor', 'member', 'guest'] as $rank) {
      $account = $this->createUser([], 'week-' . $rank);
      assert($account instanceof UserInterface);
      $this->addMembership($this->fixtureWorkspace(), $account, [$rank]);
      $result = $this->access($account);
      self::assertFalse($result->isAllowed(), "A $rank is refused.");
      self::assertNotSame(BbWorkspaceAccessCheck::WORKSPACE_MISMATCH_REASON, $this->reason($result), "A $rank gets 403, not 404.");
    }
  }

  /**
   * A lead of another workspace meets the workspace boundary (404).
   */
  public function testForeignLeadIsRefused(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_workspace');
    $south = $storage->create(['name' => 'South', 'slug' => 'south']);
    $south->save();
    assert($south instanceof BbWorkspaceInterface);
    $lead = $this->createUser([], 'south-lead');
    assert($lead instanceof UserInterface);
    $this->addMembership($south, $lead, ['lead']);
    $result = $this->access($lead);
    self::assertTrue($result->isForbidden());
    self::assertSame(BbWorkspaceAccessCheck::WORKSPACE_MISMATCH_REASON, $this->reason($result));
  }

  /**
   * An anonymous visitor is refused; the login redirect handles the rest.
   */
  public function testAnonymousIsRefused(): void {
    self::assertFalse($this->access(new AnonymousUserSession())->isAllowed());
  }

  /**
   * The Insights tabs read Overview, then Billing report.
   */
  public function testTabSitsAfterOverview(): void {
    $tasks = $this->container->get('plugin.manager.menu.local_task')->getLocalTasksForRoute(self::ROUTE)[0];
    uasort($tasks, static fn($left, $right): int => $left->getWeight() <=> $right->getWeight());
    self::assertSame(['Overview', 'Billing report'], array_values(array_map(static fn($task): string => (string) $task->getTitle(), $tasks)));
  }

  /**
   * There is no export or any other route below the report.
   */
  public function testNoExportRoute(): void {
    $below = array_filter(
      array_map(static fn($route): string => $route->getPath(), iterator_to_array($this->container->get('router.route_provider')->getAllRoutes())),
      static fn(string $path): bool => str_starts_with($path, '/_workspace/{bb_workspace}/insights/billing/'),
    );
    self::assertSame([], $below);
  }

  /**
   * The access result for the fixture workspace's report.
   */
  private function access(mixed $account): mixed {
    return $this->container->get('access_manager')->checkNamedRoute(self::ROUTE, ['bb_workspace' => 'week'], $account, TRUE);
  }

  /**
   * The reason of a forbidden result, or ''.
   */
  private function reason(mixed $result): string {
    return $result instanceof AccessResultReasonInterface ? (string) $result->getReason() : '';
  }

}
