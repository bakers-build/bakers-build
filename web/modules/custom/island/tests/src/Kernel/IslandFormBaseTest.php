<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Drupal\Core\Form\EnforcedResponseException;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\KernelTests\KernelTestBase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests IslandFormBase.
 *
 * Fragment response, validation re-render, consumed POST input.
 */
#[Group('island')]
final class IslandFormBaseTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['system', 'island', 'island_test'];

  /**
   * Submits the fixture form programmatically with the given values.
   */
  private function submitForm(array $values): FormStateInterface {
    $form_state = new FormState();
    $form_state->setValues($values);
    $args = ['island_id' => 'task_list', 'host_id' => 'tasks'];
    $this->container->get('form_builder')->submitForm(
      'Drupal\island_test\Form\TestTaskAddForm',
      $form_state,
      $args,
    );
    return $form_state;
  }

  /**
   * A form cannot name a discovered plugin that its host does not own.
   */
  public function testFormRejectsForeignPlacement(): void {
    $state = (new FormState())->addBuildInfo('args', [['island_id' => 'test_island', 'host_id' => 'tasks']]);
    $this->expectException(\LogicException::class);
    $this->container->get('form_builder')->buildForm('Drupal\island_test\Form\TestTaskAddForm', $state);
  }

  /**
   * Placement view access is checked before a hosted form is built.
   */
  public function testFormRejectsDeniedPlacement(): void {
    $state = (new FormState())->addBuildInfo('args', [['island_id' => 'quiet', 'host_id' => 'tasks']]);
    $this->expectException(AccessDeniedHttpException::class);
    $this->container->get('form_builder')->buildForm('Drupal\island_test\Form\TestTaskAddForm', $state);
  }

  /**
   * {@inheritdoc}
   */
  public function testValidSubmitSetsFragmentResponse(): void {
    $form_state = $this->submitForm(['title' => 'Write docs']);
    $this->assertEmpty($form_state->getErrors());
    $response = $form_state->getResponse();
    $this->assertNotNull($response);
    $html = (string) $response->getContent();
    $this->assertStringContainsString('id="island-tasks-task_list"', $html);
    $this->assertStringContainsString('count:4', $html);
    // No redirect: the partial response wins over Form API redirects.
    // (FormState::getRedirect() is FALSE when no redirect was set.)
    $this->assertFalse($form_state->getRedirect());
  }

  /**
   * {@inheritdoc}
   */
  public function testInvalidInputReRendersWithErrors(): void {
    $args = ['island_id' => 'task_list', 'host_id' => 'tasks'];
    $form_state = (new FormState())->addBuildInfo('args', [$args]);
    $form = $this->container->get('form_builder')->buildForm(
      'Drupal\island_test\Form\TestTaskAddForm',
      $form_state,
    );
    // HTMX wiring: the form targets the island wrapper and negotiates
    // fragments. Core's Htmx helper writes data-hx-* attribute keys.
    $this->assertSame('#island-tasks-task_list', $form['#attributes']['data-hx-target']);
    $this->assertArrayHasKey('data-hx-drupal-only-main-content', $form['#attributes']);

    $form_state = $this->submitForm(['title' => '']);
    $this->assertNotEmpty($form_state->getErrors());
    // Validation failure: no IslandResponse, Form API re-renders the form.
    $this->assertNull($form_state->getResponse());
  }

  /**
   * {@inheritdoc}
   */
  public function testSubmitConsumesPostInput(): void {
    // The real HTTP flow: the current request carries this form's POST input.
    $request = Request::create('/island-test', 'POST', [
      'title' => 'Via request',
      'form_id' => 'island_test_task_add_form',
      'op' => 'Add task',
    ]);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);

    $args = ['island_id' => 'task_list', 'host_id' => 'tasks'];
    $form_state = (new FormState())->addBuildInfo('args', [$args]);
    // buildForm() processes the POST input: validate, submit, fragment
    // response. The responder re-renders the island including this form —
    // without the consumed-input guard this loops forever. In a real request
    // the kernel turns the enforced response into the HTTP response.
    try {
      $this->container->get('form_builder')->buildForm(
        'Drupal\island_test\Form\TestTaskAddForm',
        $form_state,
      );
      $this->fail('Expected the fragment response to short-circuit the build.');
    }
    catch (EnforcedResponseException $e) {
      $this->assertNotNull($e->getResponse());
    }
    $this->assertEmpty($form_state->getErrors());
    $this->assertSame([], $request->request->all());
  }

}
