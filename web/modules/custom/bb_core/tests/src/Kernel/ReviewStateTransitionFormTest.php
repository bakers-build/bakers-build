<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Form\ReviewStateTransitionForm;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The review state widget applies only the transition its viewer clicked.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ReviewStateTransitionFormTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use ReviewStateTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'filter', 'island',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_comment', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->createUser();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Accept from the widget publishes the review and returns to the ticket.
   */
  public function testAssigneeAcceptsAndReturnsToTheTicket(): void {
    [$actors, $review] = $this->submitted();
    $this->setCurrentUser($actors['assignee']);
    $form_state = $this->post($review, ['review_from' => 'submitted', 'accept' => 'Accept']);
    self::assertSame([], $form_state->getErrors());
    $stored = $this->reload($review);
    self::assertSame('accepted', (string) $stored->get('review_state')->value);
    self::assertTrue($stored->isPublished());
    // A programmed submission reports no redirect; read the one it set.
    self::assertInstanceOf(FormState::class, $form_state);
    $redirect = (fn() => $this->redirect)->call($form_state);
    self::assertSame($actors['ticket']->toUrl()->toString(), $redirect->toString());
  }

  /**
   * A boosted htmx submit, whose redirects core disables, navigates by header.
   */
  public function testHtmxSubmitNavigatesToTheTicketByHeader(): void {
    [$actors, $review] = $this->submitted();
    $this->setCurrentUser($actors['assignee']);
    $request = Request::create('/transition', 'POST');
    $request->headers->set('HX-Request', 'true');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $form_state = $this->post($review, ['review_from' => 'submitted', 'reject' => 'Reject']);
    $this->container->get('request_stack')->pop();
    self::assertSame('rejected', (string) $this->reload($review)->get('review_state')->value);
    $response = $form_state->getResponse();
    self::assertInstanceOf(Response::class, $response);
    self::assertStringContainsString($actors['ticket']->toUrl()->toString(), (string) $response->headers->get('HX-Location'));
  }

  /**
   * A widget built from a state the review has since left is refused.
   */
  public function testStaleWidgetIsRefused(): void {
    [$actors, $review] = $this->submitted();
    $this->setCurrentUser($actors['assignee']);
    $form_state = $this->post($review, ['review_from' => 'draft', 'reject' => 'Reject']);
    self::assertSame('submitted', (string) $this->reload($review)->get('review_state')->value);
    $this->assertRefusedBackToTheTicket($form_state, $actors['ticket']);
  }

  /**
   * A POST that names no rendered transition never falls back to the first.
   */
  public function testPostWithoutItsTransitionIsRefused(): void {
    [$actors, $review] = $this->submitted();
    $this->setCurrentUser($actors['assignee']);
    $form_state = $this->post($review, ['review_from' => 'submitted', 'op' => 'Reject']);
    $this->assertRefusedBackToTheTicket($form_state, $actors['ticket']);
    $stored = $this->reload($review);
    self::assertSame('submitted', (string) $stored->get('review_state')->value);
    self::assertFalse($stored->isPublished());
  }

  /**
   * The author cannot accept their own review through a forged widget POST.
   */
  public function testAuthorCannotForgeAnAccept(): void {
    [$actors, $review] = $this->submitted();
    $this->setCurrentUser($actors['reviewer']);
    $form = $this->widget($review);
    self::assertArrayNotHasKey('accept', $form['actions']);
    $form_state = $this->post($review, ['review_from' => 'submitted', 'accept' => 'Accept']);
    $this->assertRefusedBackToTheTicket($form_state, $actors['ticket']);
    self::assertSame('submitted', (string) $this->reload($review)->get('review_state')->value);
  }

  /**
   * A refused widget POST reports its error and still returns to the ticket.
   */
  private function assertRefusedBackToTheTicket(FormStateInterface $form_state, BbTicketInterface $ticket): void {
    self::assertInstanceOf(FormState::class, $form_state);
    $redirect = (fn() => $this->redirect)->call($form_state);
    self::assertNotNull($redirect, 'A refused transition stays on the bare widget page.');
    self::assertSame($ticket->toUrl()->toString(), $redirect->toString());
    $errors = $this->container->get('messenger')->messagesByType('error');
    self::assertNotSame([], $errors);
    $this->container->get('messenger')->deleteAll();
  }

  /**
   * The actors and one submitted review.
   *
   * @return array{0: array<string, mixed>, 1: \Drupal\bb_core\Entity\BbCommentInterface}
   *   The actors and the submitted review.
   */
  private function submitted(): array {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    return [$actors, $this->reload($review)];
  }

  /**
   * The state widget of one review, built for the current user.
   *
   * @return array<string, mixed>
   *   The form render array.
   */
  private function widget(BbCommentInterface $review): array {
    return $this->container->get('form_builder')->getForm(ReviewStateTransitionForm::forReview($this->reload($review)));
  }

  /**
   * Submits the state widget with the given input, as a request would.
   *
   * @param \Drupal\bb_core\Entity\BbCommentInterface $review
   *   The review.
   * @param array<string, string> $values
   *   The posted values.
   */
  private function post(BbCommentInterface $review, array $values): FormStateInterface {
    $form_state = new FormState();
    $form_state->setValues($values);
    $this->container->get('form_builder')->submitForm(ReviewStateTransitionForm::forReview($this->reload($review)), $form_state);
    return $form_state;
  }

  /**
   * Builds a workspace ticket with owner, assignee, reviewer and spare.
   *
   * @return array<string, mixed>
   *   Named accounts and the ticket.
   */
  private function actors(): array {
    $owner = $this->account('owner', ['update any bb_ticket']);
    $assignee = $this->account('assignee', ['update own bb_comment']);
    $reviewer = $this->account('reviewer', [
      'create bb_comment',
      'update own bb_comment',
      'delete own bb_comment',
    ]);
    $other = $this->account('other');
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'ws', 'slug' => 'ws-widget']);
    $workspace->save();
    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create(['name' => 'g', 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 't', 'workspace_id' => $workspace->id()]);
    $team->save();
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create([
        'name' => 'p',
        'group_id' => $group->id(),
        'teams' => [$team->id()],
      ]);
    $project->save();
    foreach ([$owner, $assignee, $other] as $account) {
      $this->addMembership($workspace, $account, ['contributor']);
      $this->addMembership($team, $account, ['member']);
    }
    $this->addMembership($workspace, $reviewer, ['guest']);
    $this->addMembership($team, $reviewer, ['member']);
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'title' => 'review-widget',
        'workflow' => 'bb_work',
        'state' => 'todo',
        'project_id' => $project->id(),
        'owner_user_id' => $owner->id(),
        'assignee_user_id' => $assignee->id(),
        'reviewers' => [$reviewer->id()],
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return [
      'owner' => $owner,
      'assignee' => $assignee,
      'reviewer' => $reviewer,
      'other' => $other,
      'ticket' => $ticket,
    ];
  }

  /**
   * Creates a saved user with ticket and comment view.
   *
   * @param string $name
   *   Account name.
   * @param list<string> $extra
   *   Additional permissions.
   */
  private function account(string $name, array $extra = []): UserInterface {
    $account = $this->createUser([
      'view bb_ticket',
      'view bb_comment',
      ...$extra,
    ], $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

  /**
   * Creates a saved review draft.
   */
  private function createReview(BbTicketInterface $ticket, UserInterface $author): BbCommentInterface {
    $comment = $this->container->get('entity_type.manager')
      ->getStorage('bb_comment')
      ->create([
        'bundle' => 'review',
        'ticket_id' => $ticket->id(),
        'author' => $author->id(),
        'body' => ['value' => 'draft body', 'format' => 'plain_text'],
        'type' => 'comment',
      ]);
    self::assertInstanceOf(BbCommentInterface::class, $comment);
    $comment->save();
    return $comment;
  }

  /**
   * Reloads a comment from storage.
   */
  private function reload(BbCommentInterface $comment): BbCommentInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_comment');
    $storage->resetCache([(string) $comment->id()]);
    $reloaded = $storage->load($comment->id());
    self::assertInstanceOf(BbCommentInterface::class, $reloaded);
    return $reloaded;
  }

}
