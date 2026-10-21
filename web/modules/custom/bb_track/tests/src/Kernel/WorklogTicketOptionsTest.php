<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\bb_track\Controller\WorklogOptionsController;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Server-side ticket search for the time form's ticket picker.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WorklogTicketOptionsTest extends WorkTimeTestBase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Typing finds a ticket that the first page of candidates does not hold.
   */
  public function testServerSearchFindsTicketsBeyondTheFirstPage(): void {
    for ($n = 1; $n <= 60; $n++) {
      $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
        'title' => sprintf('Search target %02d', $n),
        'project_id' => $this->project->id(),
        'workflow' => 'bb_feature',
      ])->save();
    }
    $first_page = $this->labels(['project' => (string) $this->project->id()]);
    self::assertCount(50, $first_page);
    self::assertNotContains('Search target 59', $first_page);
    self::assertSame(['Search target 59'], $this->labels([
      'project' => (string) $this->project->id(),
      'q' => 'target 59',
    ]));
  }

  /**
   * Only employees who may record on the project can search its tickets.
   */
  public function testSearchIsDeniedWithoutRecordingAccess(): void {
    $query = ['project' => (string) $this->project->id(), 'q' => 'a'];
    self::assertTrue($this->allowed($query, $this->employee));
    self::assertFalse($this->allowed($query, new AnonymousUserSession()));
    self::assertFalse($this->allowed(['project' => '999999', 'q' => 'a'], $this->employee));
    self::assertFalse($this->allowed(['q' => 'a'], $this->employee));
    $outsider = $this->createUser(['record own worklog', 'view bb_project', 'view bb_ticket'], 'outsider');
    self::assertInstanceOf(AccountInterface::class, $outsider);
    self::assertFalse($this->allowed($query, $outsider));
  }

  /**
   * Labels the endpoint returns for a query.
   *
   * @param array<string, string> $query
   *   Query parameters.
   *
   * @return list<string>
   *   Option labels.
   */
  private function labels(array $query): array {
    $this->push($query);
    $build = $this->container->get('class_resolver')
      ->getInstanceFromDefinition(WorklogOptionsController::class)
      ->ticketOptions($this->container->get('request_stack')->getCurrentRequest());
    return array_column($build['#props']['options'], 'label');
  }

  /**
   * Route access for a query and account.
   *
   * @param array<string, string> $query
   *   Query parameters.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to check access for.
   */
  private function allowed(array $query, AccountInterface $account): bool {
    $this->push($query);
    return $this->container->get('access_manager')->checkNamedRoute('bb_track.worklog.ticket_options', [], $account);
  }

  /**
   * Makes a GET request with the query current.
   *
   * @param array<string, string> $query
   *   Query parameters.
   */
  private function push(array $query): void {
    $request = Request::create('/time/options/ticket', 'GET', $query);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
  }

}
