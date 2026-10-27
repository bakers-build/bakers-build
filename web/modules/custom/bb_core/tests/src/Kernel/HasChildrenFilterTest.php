<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Drupal\bb_core\EventSubscriber\HasChildrenFilterSubscriber;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * Verifies filter[has_children] is rewritten into a stock id IN/NOT IN filter.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class HasChildrenFilterTest extends KernelTestBase {

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
   * One parent with a child, one childless ticket; assert the rewrite.
   */
  public function testRewriteInjectsParentIds(): void {
    $etm = $this->container->get('entity_type.manager');
    $project = $etm->getStorage('bb_project')->create(['name' => 'p']);
    $project->save();
    $storage = $etm->getStorage('bb_ticket');
    $parent = $storage->create([
      'workflow' => 'bb_work',
      'title' => 'Parent',
      'state' => 'todo',
      'project_id' => $project->id(),
    ]);
    $parent->save();
    $childless = $storage->create([
      'workflow' => 'bb_work',
      'title' => 'Childless',
      'state' => 'todo',
      'project_id' => $project->id(),
    ]);
    $childless->save();
    $child = $storage->create([
      'workflow' => 'bb_work',
      'title' => 'Child',
      'state' => 'todo',
      'project_id' => $project->id(),
      'parent_id' => $parent->id(),
    ]);
    $child->save();

    $request = $this->requestWith(['has_children' => '1']);
    $this->dispatch($request);
    $filter = $request->query->all('filter');
    self::assertArrayNotHasKey('has_children', $filter);
    self::assertSame('IN', $filter['drupal_internal__id']['operator']);
    // The injected values are ints (array_map intval); the entity id is a
    // string, and assertContains compares strictly.
    self::assertContains((int) $parent->id(), $filter['drupal_internal__id']['value']);
    self::assertNotContains((int) $childless->id(), $filter['drupal_internal__id']['value']);
    self::assertNotContains((int) $child->id(), $filter['drupal_internal__id']['value']);
  }

  /**
   * Has_children=0 injects NOT IN over the same parent set.
   */
  public function testRewriteNotInForZero(): void {
    $request = $this->requestWith(['has_children' => '0']);
    $this->dispatch($request);
    $filter = $request->query->all('filter');
    self::assertSame('NOT IN', $filter['drupal_internal__id']['operator']);
    self::assertSame([0], array_values($filter['drupal_internal__id']['value']));
  }

  /**
   * No parents at all: value 1 injects IN (0) — an honest empty page.
   */
  public function testEmptyParentSet(): void {
    $request = $this->requestWith(['has_children' => '1']);
    $this->dispatch($request);
    $filter = $request->query->all('filter');
    self::assertSame([0], array_values($filter['drupal_internal__id']['value']));
  }

  /**
   * An invalid value 400s like stock validation would.
   */
  public function testInvalidValueThrows(): void {
    $this->expectException(BadRequestHttpException::class);
    $this->dispatch($this->requestWith(['has_children' => 'yes']));
  }

  /**
   * Other routes and param-free requests are untouched.
   */
  public function testUnrelatedRequestUntouched(): void {
    $request = Request::create('/jsonapi/bb_ticket/bb_ticket', 'GET', [
      'filter' => ['identifier' => 'bakers.build'],
    ]);
    $request->attributes->set('_route', 'jsonapi.bb_ticket--bb_ticket.collection');
    $this->dispatch($request);
    self::assertSame(['identifier' => 'bakers.build'], $request->query->all('filter'));
  }

  /**
   * Builds a request on the JSON:API collection route carrying $extra filters.
   *
   * @param array<string, string> $extra
   *   The custom filter parameters.
   */
  private function requestWith(array $extra): Request {
    $request = Request::create('/jsonapi/bb_ticket/bb_ticket', 'GET', [
      'filter' => $extra,
    ]);
    $request->attributes->set('_route', 'jsonapi.bb_ticket--bb_ticket.collection');
    return $request;
  }

  /**
   * Runs the subscriber over $request as the REQUEST event would.
   */
  private function dispatch(Request $request): void {
    $subscriber = new HasChildrenFilterSubscriber($this->container->get('database'));
    $kernel = $this->createMock(HttpKernelInterface::class);
    $event = new RequestEvent($kernel, $request, HttpKernelInterface::MAIN_REQUEST);
    $subscriber->onRequest($event);
  }

}
