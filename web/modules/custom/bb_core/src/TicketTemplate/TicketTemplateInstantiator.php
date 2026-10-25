<?php

declare(strict_types=1);

namespace Drupal\bb_core\TicketTemplate;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AccountSwitcherInterface;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbTicket;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\Workflow\TypeWorkflows;

/**
 * Creates a bb_ticket from a bb_ticket_template.
 *
 * A template is a set of defaults: every call creates a new ticket, and any
 * overridable field passed in $overrides replaces the template's value.
 *
 * Everything the ticket is built from is checked as the actor: the template
 * must be viewable by them (else it does not exist for them), and the ticket
 * is validated under their account, so the tenancy, label and conductor
 * constraints of a normal ticket create apply unchanged.
 *
 * Scheduled triggers call instantiate() per occurrence; their replay
 * protection is the trigger's own occurrence key.
 */
final class TicketTemplateInstantiator {

  /**
   * The ticket fields a caller may override.
   *
   * @var array<string>
   */
  public const OVERRIDABLE = [
    'title', 'description', 'workflow', 'ticket_type', 'recipe', 'labels', 'project_id', 'conductor_id', 'target_state',
  ];

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly EntityRepositoryInterface $entityRepository,
    private readonly Connection $database,
    private readonly TimeInterface $time,
    private readonly AccountSwitcherInterface $accountSwitcher,
    private readonly WorkspaceResolverInterface $workspaceResolver,
  ) {}

  /**
   * Instantiates the template into a new ticket.
   *
   * @param string $templateUuid
   *   The template's UUID.
   * @param \Drupal\Core\Session\AccountInterface $actor
   *   The account on whose behalf to instantiate.
   * @param array<string, mixed> $overrides
   *   Values replacing the template defaults, keyed by an OVERRIDABLE field:
   *   `title`, `description`, `workflow` and `target_state` as strings,
   *   `project_id` and `conductor_id` as an entity id or NULL, `labels` as a
   *   list of term ids. A present key wins even when empty.
   *
   * @return array{ticket_uuid: string, identifier: string, created: true}
   *   The new ticket, as scalars only: callers load the ticket through normal
   *   access-controlled reads.
   *
   * @throws \Drupal\bb_core\TicketTemplate\TemplateNotFoundException
   *   The template is missing, disabled, or not viewable by the actor.
   * @throws \Drupal\bb_core\TicketTemplate\TicketTemplateAccessDeniedException
   *   The actor may not use templates or create tickets.
   * @throws \Drupal\bb_core\TicketTemplate\TicketTemplateValidationException
   *   An override or the template yields an invalid ticket.
   */
  public function instantiate(string $templateUuid, AccountInterface $actor, array $overrides = []): array {
    $template = $this->loadTemplate($templateUuid);
    $this->checkTemplate($template, $actor);
    [$values, $target] = $this->resolve($template, $overrides);

    // Create and transition are one unit: a failed transition leaves no ticket.
    $transaction = $this->database->startTransaction();
    try {
      $this->accountSwitcher->switchTo($actor);
      try {
        $ticket = BbTicket::create($values + [
          'template_id' => $template->id(),
          // The assignee is left to ticket preSave, which derives it from the
          // conductor as on any ticket.
          'owner_user_id' => $actor->id(),
        ]);
        assert($ticket instanceof BbTicketInterface);
        $this->assertValid($ticket);
        $ticket->save();
        $this->applyTargetState($ticket, $target);
      }
      finally {
        $this->accountSwitcher->switchBack();
      }
      return [
        'ticket_uuid' => (string) $ticket->uuid(),
        'identifier' => $ticket->getIdentifier(),
        'created' => TRUE,
      ];
    }
    catch (\Throwable $e) {
      $transaction->rollBack();
      throw $e;
    }
  }

  /**
   * Checks, without writing, that $actor could instantiate $template now.
   *
   * The same checks instantiate() runs without overrides, plus validation of
   * the ticket it would build, so a trigger is never activated for an actor
   * whose runs would all fail. A workspace template fails here: it needs a
   * project, and a trigger passes none.
   *
   * @throws \Drupal\bb_core\TicketTemplate\TemplateNotFoundException
   * @throws \Drupal\bb_core\TicketTemplate\TicketTemplateAccessDeniedException
   * @throws \Drupal\bb_core\TicketTemplate\TicketTemplateValidationException
   */
  public function preflight(BbTicketTemplateInterface $template, AccountInterface $actor): void {
    $this->checkTemplate($template, $actor);
    [$values] = $this->resolve($template, []);
    $this->accountSwitcher->switchTo($actor);
    try {
      $this->assertValid(BbTicket::create($values + [
        'template_id' => $template->id(),
        'owner_user_id' => $actor->id(),
      ]));
    }
    finally {
      $this->accountSwitcher->switchBack();
    }
  }

  /**
   * Checks the template's visibility and state and the actor's access.
   */
  private function checkTemplate(BbTicketTemplateInterface $template, AccountInterface $actor): void {
    // A template the actor cannot view does not exist for them: no 403, so its
    // existence is not disclosed. This precedes the disabled check for the
    // same reason.
    if (!$template->access('view', $actor)) {
      throw new TemplateNotFoundException(sprintf('No ticket template with UUID %s.', $template->uuid()));
    }
    $this->checkAccess($actor);
    if (!$template->isEnabled()) {
      throw new TemplateNotFoundException(sprintf('Template %s is disabled.', $template->uuid()));
    }
  }

  /**
   * Validates the overrides and returns the ticket values and target state.
   *
   * @param \Drupal\bb_core\Entity\BbTicketTemplateInterface $template
   *   The template.
   * @param array<string, mixed> $overrides
   *   The caller's overrides.
   *
   * @return array{0: array<string, mixed>, 1: string}
   *   The field values for BbTicket::create() and the target state.
   */
  private function resolve(BbTicketTemplateInterface $template, array $overrides): array {
    $unknown = array_diff(array_keys($overrides), self::OVERRIDABLE);
    if ($unknown !== []) {
      throw new TicketTemplateValidationException(sprintf('Field %s cannot be set from a template.', implode(', ', $unknown)));
    }
    $this->checkProject($template, $overrides);
    $values = $this->values($template, $overrides);
    $target = array_key_exists('target_state', $overrides) ? (string) $overrides['target_state'] : $template->getTargetState();
    if ($target !== '' && !array_key_exists($target, TypeWorkflows::templateTargetStateOptions((string) $values['workflow']))) {
      throw new TicketTemplateValidationException(sprintf('Target state "%s" is not reachable in workflow "%s".', $target, (string) $values['workflow']));
    }
    return [$values, $target];
  }

  /**
   * An unsaved ticket carrying the template's rendered defaults.
   *
   * For a form to prefill; it is neither validated nor saved.
   */
  public function prefill(BbTicketTemplateInterface $template): BbTicketInterface {
    $ticket = BbTicket::create($this->values($template, []));
    assert($ticket instanceof BbTicketInterface);
    return $ticket;
  }

  /**
   * The ticket field values: template defaults with the overrides applied.
   *
   * @param \Drupal\bb_core\Entity\BbTicketTemplateInterface $template
   *   The template.
   * @param array<string, mixed> $overrides
   *   The validated overrides.
   *
   * @return array<string, mixed>
   *   Field values for BbTicket::create().
   */
  private function values(BbTicketTemplateInterface $template, array $overrides): array {
    $defaults = [
      'title' => $template->getTitlePattern(),
      'description' => $template->getDescriptionPattern(),
      'workflow' => $template->getWorkflow(),
      'ticket_type' => $template->get('ticket_type')->target_id,
      'recipe' => $template->get('recipe')->target_id,
      'labels' => array_column($template->get('labels')->getValue(), 'target_id'),
      'project_id' => $template->get('project_id')->target_id,
      'conductor_id' => $template->get('conductor_id')->target_id,
    ];
    $values = array_intersect_key($overrides, $defaults) + $defaults;

    return [
      'title' => $this->renderPattern((string) $values['title']),
      'description' => ['value' => $this->renderPattern((string) $values['description']), 'format' => 'bb_rich'],
      'workflow' => $values['workflow'],
      'ticket_type' => $values['ticket_type'],
      'recipe' => $values['recipe'],
      'labels' => array_map(static fn ($id): array => ['target_id' => $id], array_values((array) $values['labels'])),
      'project_id' => $values['project_id'],
      'conductor_id' => $values['conductor_id'],
    ];
  }

  /**
   * Enforces the template scope on the project override.
   *
   * A project template creates tickets only in its own project; a workspace
   * template needs a project of its own workspace.
   *
   * @param \Drupal\bb_core\Entity\BbTicketTemplateInterface $template
   *   The template.
   * @param array<string, mixed> $overrides
   *   The overrides.
   */
  private function checkProject(BbTicketTemplateInterface $template, array $overrides): void {
    $project_id = $overrides['project_id'] ?? NULL;
    if (!$template->isWorkspaceScoped()) {
      if (array_key_exists('project_id', $overrides) && (int) $project_id !== (int) $template->get('project_id')->target_id) {
        throw new TicketTemplateValidationException('A project template creates tickets only in its own project.');
      }
      return;
    }
    if ($project_id === NULL || $project_id === '') {
      throw new TicketTemplateValidationException('A project is required for a workspace template.');
    }
    $project = $this->entityTypeManager->getStorage('bb_project')->load($project_id);
    $workspace = $project === NULL ? NULL : $this->workspaceResolver->resolve($project);
    if ($workspace === NULL || (int) $workspace->id() !== $template->getScopeWorkspaceId()) {
      throw new TicketTemplateValidationException('The project does not belong to the workspace of this template.');
    }
  }

  /**
   * Loads the template by UUID, or throws.
   */
  private function loadTemplate(string $templateUuid): BbTicketTemplateInterface {
    $template = $this->entityRepository->loadEntityByUuid('bb_ticket_template', $templateUuid);
    if (!$template instanceof BbTicketTemplateInterface) {
      throw new TemplateNotFoundException(sprintf('No ticket template with UUID %s.', $templateUuid));
    }
    return $template;
  }

  /**
   * Checks the "use ticket template" permission and ticket create access.
   */
  private function checkAccess(AccountInterface $actor): void {
    if (!$actor->hasPermission('use bb_ticket_template')) {
      throw new TicketTemplateAccessDeniedException('Missing the "use bb_ticket_template" permission.');
    }
    $create_access = $this->entityTypeManager->getAccessControlHandler('bb_ticket')
      ->createAccess(NULL, $actor, [], TRUE);
    if (!$create_access->isAllowed()) {
      throw new TicketTemplateAccessDeniedException('Not permitted to create bb_ticket.');
    }
  }

  /**
   * Throws when the ticket fails entity validation.
   */
  private function assertValid(BbTicketInterface $ticket): void {
    $violations = $ticket->validate();
    if ($violations->count() > 0) {
      throw new TicketTemplateValidationException((string) $violations->get(0)->getMessage());
    }
  }

  /**
   * Substitutes `{{date}}`/`{{month}}` (UTC) and rejects any other token.
   */
  private function renderPattern(string $pattern): string {
    $now = new \DateTimeImmutable('@' . $this->time->getCurrentTime());
    $now = $now->setTimezone(new \DateTimeZone('UTC'));
    $replacements = [
      '{{date}}' => $now->format('Y-m-d'),
      '{{month}}' => $now->format('Y-m'),
    ];
    $rendered = strtr($pattern, $replacements);
    if (preg_match('/\{\{[^}]*\}\}/', $rendered, $matches) === 1) {
      throw new TicketTemplateValidationException(sprintf('Unknown placeholder %s in template pattern.', $matches[0]));
    }
    return $rendered;
  }

  /**
   * Transitions the freshly created ticket to the effective target state.
   *
   * No-op when the ticket already landed on target_state. Otherwise finds the
   * single legal transition from the ticket's current state to target_state
   * among the allowed transitions reported by the state field itself; zero or
   * more than one match is a template definition error.
   */
  private function applyTargetState(BbTicketInterface $ticket, string $target): void {
    $state = $ticket->getState();
    if ($target === '' || (string) $state->getId() === $target) {
      return;
    }
    $matching_id = NULL;
    foreach ($state->getTransitions() as $transition_id => $transition) {
      if ((string) $transition->getToState()->getId() === $target) {
        if ($matching_id !== NULL) {
          throw new TicketTemplateValidationException(sprintf('More than one legal transition to target_state "%s".', $target));
        }
        $matching_id = (string) $transition_id;
      }
    }
    if ($matching_id === NULL || !$state->isTransitionAllowed($matching_id)) {
      throw new TicketTemplateValidationException(sprintf('No legal transition from "%s" to target_state "%s".', (string) $state->getId(), $target));
    }
    $state->applyTransitionById($matching_id);
    $this->assertValid($ticket);
    $ticket->save();
  }

}
