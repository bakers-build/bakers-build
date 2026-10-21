<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\Form\FormState;
use Drupal\Core\Render\HtmlResponse;
use Drupal\Core\Routing\RouteMatch;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Form\BbTicketCreateForm;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The two things the dialog SAYS, asserted on the markup that says them.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketCreateDialogRenderTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * The sentence the dialog shows while `project_id` holds no value (D15).
   *
   * BB-420 Task 34 moved `project_id` out of the dialog's head into the
   * pill row beside `team` — the sentence changed WORDING to match (it can
   * no longer point "above"), not SUBJECT: {@see
   * \Drupal\bb_core\Form\BbTicketCreateForm::IDENTIFIER_ANCHOR_FIELD}'s
   * own docblock is where that distinction is argued.
   */
  private const GUIDANCE = 'Pick a project below';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_workspace',
      'bb_conductor', 'bb_ticket', 'bb_run', 'bb_term', 'bb_team',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'filter', 'bb_core']);
    // The dialog is composed by the THEME's components, so the theme has to be
    // installed and active for any of this to render at all.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    // Uid 1 bypasses every access check, so it must not be an actor.
    $this->newAccount([], 'uid1-dummy-render');
    $this->setCurrentUser($this->newAccount(
      ['administer bakers', 'create bb_ticket'],
      'dialog-render',
    ));

    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create(['name' => 'Render-test project']);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
  }

  /**
   * D15: an unresolved head explains itself, in the dialog's message slot.
   *
   * The sentence is the one piece of prose the template owns outright, and
   * before this case nothing asserted it anywhere: the browser suite watches
   * the disabled submit that accompanies it, which is a different promise —
   * a dialog that refuses to submit and says nothing about why is exactly the
   * "silent refusal" D15 exists to forbid.
   */
  public function testOpeningAnEmptyFormDoesNotReportValidationErrors(): void {
    $markup = $this->renderDialog($this->buildForm(new Request()));

    self::assertStringNotContainsString(self::GUIDANCE, $markup);
    self::assertStringNotContainsString(
      'data-option-picker-message-for="project_id"',
      $markup,
      'The guidance names the field whose pick retires it (R24).',
    );
  }

  /**
   * SPEC D7: a title refusal is shown, and the retired guidance never joins it.
   *
   * `project_id` is resolved server-side since BB-664 and carries no widget
   * on this display, so a POST missing both a title and a project shows only
   * the title refusal — there is no element left for the project violation to
   * attach to, which is the point: the operator is never shown a control for
   * a field they cannot edit.
   */
  public function testRefusalOutranksTheUnresolvedHeadGuidance(): void {
    $form = $this->postForm(['title' => [['value' => '']]]);

    $markup = $this->renderDialog($form);

    self::assertStringContainsString('Title field is required.', $markup);
    self::assertStringNotContainsString(
      self::GUIDANCE,
      $markup,
      'A refusal replaces the guidance rather than joining it (D7, level 1).',
    );
  }

  /**
   * Renders a built form the way the wrapper format answers it.
   *
   * @param array<string, mixed> $form
   *   The built form.
   */
  private function renderDialog(array $form): string {
    $request = $this->container->get('request_stack')->getCurrentRequest();
    $route_name = 'entity.bb_ticket.create_form';
    $response = $this->container->get('main_content_renderer.island_dialog')->renderResponse(
      $form,
      $request,
      new RouteMatch($route_name, $this->container->get('router.route_provider')->getRouteByName($route_name)),
    );
    $processed = $this->container->get('html_response.attachments_processor')->processAttachments($response);
    self::assertInstanceOf(HtmlResponse::class, $processed);
    $markup = (string) $processed->getContent();
    // A render that produced no dialog at all would make every
    // `assertStringNotContainsString()` above pass vacuously.
    self::assertStringContainsString('bb_theme:dialog', $markup, 'The dialog rendered.');
    return $markup;
  }

  /**
   * Builds the dialog for one request.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The request the dialog is opened by.
   *
   * @return array<string, mixed>
   *   The built form.
   */
  private function buildForm(Request $request): array {
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    return $this->container->get('form_builder')->getForm(BbTicketCreateForm::class);
  }

  /**
   * Posts the dialog the way a browser does, and returns what it answers with.
   *
   * `buildForm()` and not `submitForm()`: only the build path produces the
   * array the visitor is actually rendered, which is Finding 1's whole point —
   * `FormBuilder::processForm()` builds before it validates and never rebuilds
   * a form that ends the call with an error.
   *
   * @param array<string, mixed> $values
   *   The submitted values.
   *
   * @return array<string, mixed>
   *   The built form, carrying the refusal.
   */
  private function postForm(array $values): array {
    $form_id = BbTicketCreateForm::FORM_ID;
    $request = Request::create('/', 'POST', $values + ['form_id' => $form_id]);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $request->request->set(
      'form_token',
      $this->container->get('csrf_token')->get('form_token_placeholder_' . Crypt::hashBase64($form_id)),
    );
    // Held in a variable rather than passed inline: `FormBuilder::buildForm()`
    // takes the form state BY REFERENCE.
    $form_state = new FormState();
    return $this->container->get('form_builder')->buildForm(BbTicketCreateForm::class, $form_state);
  }

  /**
   * Creates a saved account holding exactly the given permissions.
   *
   * @param array<string> $permissions
   *   Permission machine names to grant.
   * @param string $name
   *   The account name.
   */
  private function newAccount(array $permissions, string $name): UserInterface {
    $account = $this->createUser($permissions, $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

}
