<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityForm;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Template\Attribute;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Access\BbMachineOwnerAccessCheck;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Routing\BbConductorRouteProvider;
use Drupal\bb_core\Routing\BbMachineRouteProvider;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\island\Form\WrappedDialogFormTrait;

/**
 * Confirms Restart runs on a machine, one conductor or one ticket.
 *
 * A machine or conductor lists its covered tickets, all checked; OK cancels
 * the runs of the checked ones through
 * TicketInterventions::cancelSelectedRuns(), and each ticket gets one fresh
 * run. A ticket confirms its own runs. The posted tickets must still be the
 * covered set, else the dialog re-renders. Only the machine's owner reaches
 * a machine or conductor; a ticket's editor reaches the ticket.
 */
final class BbRestartRunsForm extends EntityForm {

  use WrappedDialogFormTrait;

  /**
   * The machine, conductor or ticket.
   *
   * @var \Drupal\bb_core\Entity\BbMachineInterface|\Drupal\bb_core\Entity\BbConductorInterface|\Drupal\bb_core\Entity\BbTicketInterface
   */
  protected $entity;

  /**
   * Route access: the machine's owner, else the owner-mismatch 404.
   */
  public static function access(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $target = $route_match->getParameter('bb_machine') ?? $route_match->getParameter('bb_conductor');
    $allowed = ($target instanceof BbMachineInterface || $target instanceof BbConductorInterface)
      && TicketInterventions::mayRestartRuns($target, $account);
    $result = $allowed ? AccessResult::allowed() : AccessResult::forbidden(BbMachineOwnerAccessCheck::OWNER_MISMATCH_REASON);
    return $result->addCacheableDependency($target)->cachePerUser();
  }

  /**
   * The confirmation, as a dialog or as a plain page.
   */
  public static function confirmationUrl(BbMachineInterface|BbConductorInterface|BbTicketInterface $target, bool $dialog, ?string $destination = NULL): Url {
    $query = ['destination' => $destination ?? $target->toUrl()->toString()];
    if ($dialog) {
      $query['_wrapper_format'] = 'island_dialog';
    }
    return Url::fromRoute('entity.' . $target->getEntityTypeId() . '.restart_form', $target->toUrl()->getRouteParameters(), ['query' => $query]);
  }

  /**
   * The htmx attributes that open the confirmation in the overlay.
   */
  public static function dialogAttributes(BbMachineInterface|BbConductorInterface|BbTicketInterface $target, ?string $destination = NULL): Attribute {
    // The create-trigger contract: the overlay is the target, and only the
    // answer's `dialog` element is swapped in.
    return (new Htmx())->get(self::confirmationUrl($target, TRUE, $destination))
      ->target('#bakers-overlay')->select('dialog')->swap('innerHTML')->getAttributes();
  }

  /**
   * The Restart runs button that opens the dialog over the overlay.
   *
   * @return array<string, mixed>
   *   The button render array.
   */
  public static function button(BbMachineInterface|BbConductorInterface|BbTicketInterface $target): array {
    $attributes = self::dialogAttributes($target);
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      // The dialog's own libraries arrive too late for the first click.
      '#attached' => ['library' => ['core/drupal.htmx']],
      '#props' => [
        'label' => (string) new TranslatableMarkup('Restart runs'),
        'href' => self::confirmationUrl($target, FALSE)->toString(),
        'variant' => 'neutral',
        'attributes' => $attributes,
      ],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $target = $this->entity;
    $form['#cache']['max-age'] = 0;
    $this->attachDialogHtmx($form);

    $available = $this->available($target);
    $groups = $available ? TicketInterventions::byTicket($this->covered($target)) : [];
    $form['question'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:message',
      '#props' => ['status' => $groups === [] ? 'status' : 'warning'],
      '#slots' => ['body' => ['#plain_text' => $this->question($available, $groups)]],
      '#weight' => -10,
    ];
    if ($groups !== [] && !$target instanceof BbTicketInterface) {
      $options = array_map(fn (array $runs): string => $this->ticketLine($runs), $groups);
      $form['tickets'] = [
        '#type' => 'checkboxes',
        '#title' => $this->t('Tickets'),
        '#title_display' => 'invisible',
        '#options' => $options,
        '#default_value' => array_keys($options),
        '#weight' => -5,
      ];
    }
    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['keep'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => [
        'label' => (string) $this->t('Cancel'),
        'href' => ($this->getRequest()->query->has('destination') ? $this->returnUrl() : $target->toUrl())->toString(),
        'variant' => 'ghost',
        // island.dialog.js closes on Esc and the close control through this.
        'attributes' => new Attribute(['data-dialog-cancel' => 'data-dialog-cancel']),
      ],
      '#weight' => 0,
    ];
    if ($groups === []) {
      return $form;
    }
    // The tickets the person saw; a different set at submit is stale.
    $form['bb_covered'] = ['#type' => 'hidden', '#value' => implode(',', array_keys($groups))];
    $form['actions']['bb_confirm'] = [
      '#type' => 'submit',
      '#name' => 'bb_confirm',
      '#value' => $this->t('OK'),
      '#bb_variant' => 'danger',
      '#theme_wrappers' => ['input__submit__bb_button'],
      '#limit_validation_errors' => [],
      '#submit' => ['::submitRestart'],
      '#weight' => 10,
    ];
    return $form;
  }

  /**
   * The question the dialog asks.
   *
   * @param bool $available
   *   Whether the current account may restart the target.
   * @param array<int, array<int|string, \Drupal\bb_core\Entity\BbRunInterface>> $groups
   *   The covered runs by ticket.
   */
  private function question(bool $available, array $groups): string {
    $target = $this->entity;
    if (!$available) {
      return (string) ($target instanceof BbTicketInterface ? $this->t('There is no run to restart.') : $this->t('This action is not available.'));
    }
    if ($groups === []) {
      return (string) $this->t('@target has no runs to restart.', ['@target' => $this->name()]);
    }
    if ($target instanceof BbTicketInterface) {
      return (string) $this->t('Restart @target? @runs is cancelled, and the ticket gets one fresh run.', [
        '@target' => $this->name(),
        '@runs' => $this->runList(reset($groups)),
      ]);
    }
    $question = (string) $this->t('Restart runs on @target? The runs of each checked ticket are cancelled, and the ticket gets one fresh run.', ['@target' => $this->name()]);
    return $this->isOnline() ? $question : $question . ' ' . $this->t('It is offline: tab and runtime cleanup and the fresh runs follow its next start.');
  }

    /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  protected function copyFormValuesToEntity(EntityInterface $entity, array $form, FormStateInterface $form_state): void {
    // The target itself is never written.
  }

  /**
   * Cancels the runs of the checked tickets, when the list is still current.
   *
   * Form API submit handler; the form array is part of its signature.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function submitRestart(array &$form, FormStateInterface $form_state): void {
    $trigger = $form_state->getTriggeringElement();
    $input = $form_state->getUserInput() + $form_state->getValues();
    $target = $this->entityTypeManager->getStorage($this->entity->getEntityTypeId())->loadUnchanged($this->entity->id());
    if (($trigger['#name'] ?? '') !== 'bb_confirm'
      || !($target instanceof BbMachineInterface || $target instanceof BbConductorInterface || $target instanceof BbTicketInterface)
      || !$this->available($target)) {
      $this->messenger()->addError($this->t('This action is not available.'));
      return;
    }
    $groups = TicketInterventions::byTicket($this->covered($target));
    if ((string) ($input['bb_covered'] ?? '') !== implode(',', array_keys($groups))) {
      $this->messenger()->addError($this->t('The runs changed since the dialog opened. Check the list again.'));
      $form_state->setRebuild();
      return;
    }
    $checked = $target instanceof BbTicketInterface ? $groups : array_intersect_key($groups, array_filter((array) ($input['tickets'] ?? [])));
    $runs = $checked === [] ? [] : array_replace(...array_values($checked));
    try {
      TicketInterventions::cancelSelectedRuns($runs, $this->currentUser(), TicketInterventions::restartReason($target));
    }
    catch (\InvalidArgumentException) {
      $this->messenger()->addError($this->t('This action is not available.'));
      $form_state->setRebuild();
      return;
    }
    $this->messenger()->addStatus($this->formatPlural(count($runs), 'Restarted 1 run.', 'Restarted @count runs.'));
    $this->respondAtReturnUrl($form_state);
  }

  /**
   * Whether the current account may restart the target.
   */
  private function available(BbMachineInterface|BbConductorInterface|BbTicketInterface $target): bool {
    return $target instanceof BbTicketInterface
      ? TicketInterventions::mayRestartTicket($target)
      : TicketInterventions::mayRestartRuns($target, $this->currentUser());
  }

  /**
   * The runs the target's Restart runs covers.
   *
   * @return array<int|string, \Drupal\bb_core\Entity\BbRunInterface>
   *   The runs keyed by id.
   */
  private function covered(BbMachineInterface|BbConductorInterface|BbTicketInterface $target): array {
    return $target instanceof BbTicketInterface
      ? TicketInterventions::ticketRestartRuns($target)
      : TicketInterventions::restartCoveredRuns($target);
  }

  /**
   * One ticket's line: identifier, title and its runs.
   *
   * @param array<int|string, \Drupal\bb_core\Entity\BbRunInterface> $runs
   *   The ticket's covered runs.
   */
  private function ticketLine(array $runs): string {
    $ticket = reset($runs)->getTicket();
    $label = $ticket instanceof BbTicketInterface ? $ticket->getIdentifier() . ' · ' . $ticket->getTitle() : '?';
    return $label . ' · ' . $this->runList($runs);
  }

  /**
   * The runs as `run #12 (running), run #9 (failed)`.
   *
   * @param array<int|string, \Drupal\bb_core\Entity\BbRunInterface> $runs
   *   The runs.
   */
  private function runList(array $runs): string {
    return implode(', ', array_map(static fn (BbRunInterface $run): string => sprintf('run #%s (%s)', $run->id(), $run->getRunState()), $runs));
  }

  /**
   * Whether the conductor, or any conductor of the machine, is online.
   */
  private function isOnline(): bool {
    if ($this->entity instanceof BbConductorInterface) {
      return $this->entity->getStatus() === 'online';
    }
    return (bool) $this->entityTypeManager->getStorage('bb_conductor')->getQuery()->accessCheck(FALSE)
      ->condition('machine', $this->entity->id())
      ->condition('status', 'online')
      ->count()
      ->execute();
  }

  /**
   * The target's visible name.
   */
  private function name(): string {
    return match (TRUE) {
      $this->entity instanceof BbMachineInterface => BbMachineRouteProvider::title($this->entity),
      $this->entity instanceof BbConductorInterface => BbConductorRouteProvider::title($this->entity),
      default => $this->entity->getIdentifier() !== '' ? $this->entity->getIdentifier() : (string) $this->entity->label(),
    };
  }

}
