<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\bb_core\EventSubscriber\EntityFormSurfaceSubscriber;
use Drupal\bb_core\Form\BbCreateDialogFormBase;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\ViewEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * Gate and home forms stay unframed; settings forms get the canvas wrap.
 */
#[Group('bb_core')]
final class EntityFormSurfaceSubscriberTest extends UnitTestCase {

  /**
   * Workspace create is a gate form and must not gain a second submit row.
   */
  public function testWorkspaceCreateIsNotWrapped(): void {
    $result = $this->dispatch(['#type' => 'form', '#form_id' => 'bb_workspace_create_form']);
    self::assertSame('form', $result['#type'] ?? NULL);
  }

  /**
   * Workspace join is a gate form.
   */
  public function testWorkspaceJoinIsNotWrapped(): void {
    $result = $this->dispatch(['#type' => 'form', '#form_id' => 'bb_workspace_join_form']);
    self::assertSame('form', $result['#type'] ?? NULL);
  }

  /**
   * Login already listed among the gate ids stays unframed.
   */
  public function testLoginIsNotWrapped(): void {
    $result = $this->dispatch(['#type' => 'form', '#form_id' => 'bb_login_form']);
    self::assertSame('form', $result['#type'] ?? NULL);
  }

  /**
   * The check-mail code form is a gate surface.
   */
  public function testCodeFormIsNotWrapped(): void {
    $result = $this->dispatch(['#type' => 'form', '#form_id' => 'bb_login_code_form']);
    self::assertSame('form', $result['#type'] ?? NULL);
  }

  /**
   * A create dialog is skipped by form object, not by form id.
   */
  public function testCreateDialogIsNotWrapped(): void {
    $dialog = $this->createMock(BbCreateDialogFormBase::class);
    $request = Request::create('/bakers/tickets');
    $request->attributes->set('form_object', $dialog);
    $result = $this->dispatch(
      ['#type' => 'form', '#form_id' => 'bb_ticket_create_form'],
      $request,
    );
    self::assertSame('form', $result['#type'] ?? NULL);
  }

  /**
   * A workspace settings form is an application screen and is framed.
   */
  public function testWorkspaceSettingsIsWrapped(): void {
    $result = $this->dispatch(['#type' => 'form', '#form_id' => 'bb_workspace_settings_form', '#title' => 'Settings']);
    self::assertSame('component', $result['#type'] ?? NULL);
    self::assertSame('bb_theme:canvas', $result['#component'] ?? NULL);
  }

  /**
   * Dispatches the subscriber against one controller result.
   *
   * @param array<string, mixed> $result
   *   The controller result.
   * @param \Symfony\Component\HttpFoundation\Request|null $request
   *   The request, or a generic main request.
   *
   * @return array<string, mixed>
   *   The controller result after the subscriber.
   */
  private function dispatch(array $result, ?Request $request = NULL): array {
    $kernel = $this->createMock(HttpKernelInterface::class);
    $event = new ViewEvent(
      $kernel,
      $request ?? Request::create('/settings'),
      HttpKernelInterface::MAIN_REQUEST,
      $result,
    );
    (new EntityFormSurfaceSubscriber())->onView($event);
    $after = $event->getControllerResult();
    self::assertIsArray($after);
    return $after;
  }

}
