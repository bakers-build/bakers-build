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
 * Confirms Restart runs on a machine or one conductor.
 *
 * Lists the covered runs; the confirm cancels them through
 * TicketInterventions::restartRuns(), and each ticket gets one fresh run. The
 * posted list must still be the covered set, else the dialog re-renders.
 * Only the machine's owner reaches it.
 */
final class BbRestartRunsForm extends EntityForm {

  use WrappedDialogFormTrait;

  /**
   * The machine or conductor.
   *
   * @var \Drupal\bb_core\Entity\BbMachineInterface|\Drupal\bb_core\Entity\BbConductorInterface
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
  public static function confirmationUrl(BbMachineInterface|BbConductorInterface $target, bool $dialog, ?string $destination = NULL): Url {
    $query = ['destination' => $destination ?? $target->toUrl()->toString()];
    if ($dialog) {
      $query['_wrapper_format'] = 'island_dialog';
    }
    return Url::fromRoute('entity.' . $target->getEntityTypeId() . '.restart_form', $target->toUrl()->getRouteParameters(), ['query' => $query]);
  }

  /**
   * The htmx attributes that open the confirmation in the overlay.
   */
  public static function dialogAttributes(BbMachineInterface|BbConductorInterface $target, ?string $destination = NULL): Attribute {
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
  public static function button(BbMachineInterface|BbConductorInterface $target): array {
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

    $available = TicketInterventions::mayRestartRuns($target, $this->currentUser());
    $runs = $available ? TicketInterventions::restartCoveredRuns($target) : [];
    $question = match (TRUE) {
      !$available => $this->t('This action is not available.'),
      $runs === [] => $this->t('@target has no runs to restart.', ['@target' => $this->name()]),
      default => $this->t('Restart runs on @target? Each run below is cancelled, and its ticket gets one fresh run.', ['@target' => $this->name()]),
    };
    if ($runs !== [] && !$this->isOnline()) {
      $question .= ' ' . $this->t('It is offline: tab and runtime cleanup and the fresh runs follow its next start.');
    }
    $form['question'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:message',
      '#props' => ['status' => $runs === [] ? 'status' : 'warning'],
      '#slots' => ['body' => ['#plain_text' => (string) $question]],
      '#weight' => -10,
    ];
    $form['runs'] = [
      '#theme' => 'item_list',
      '#items' => array_values(array_map(fn (BbRunInterface $run): string => $this->runLine($run), $runs)),
      '#weight' => -5,
    ];
    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['keep'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => [
        'label' => (string) $this->t('Keep runs'),
        'href' => ($this->getRequest()->query->has('destination') ? $this->returnUrl() : $target->toUrl())->toString(),
        'variant' => 'ghost',
        // island.dialog.js closes on Esc and the close control through this.
        'attributes' => new Attribute(['data-dialog-cancel' => 'data-dialog-cancel']),
      ],
      '#weight' => 0,
    ];
    if ($runs === []) {
      return $form;
    }
    // The set the person saw; a different set at submit is stale.
    $form['bb_covered'] = ['#type' => 'hidden', '#value' => implode(',', array_keys($runs))];
    $form['actions']['bb_confirm'] = [
      '#type' => 'submit',
      '#name' => 'bb_confirm',
      '#value' => $this->t('Restart runs'),
      '#bb_variant' => 'danger',
      '#theme_wrappers' => ['input__submit__bb_button'],
      '#limit_validation_errors' => [],
      '#submit' => ['::submitRestart'],
      '#weight' => 10,
    ];
    return $form;
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
   * Cancels the covered runs, when they are still the ones listed.
   *
   * Form API submit handler; the form array is part of its signature.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function submitRestart(array &$form, FormStateInterface $form_state): void {
    $trigger = $form_state->getTriggeringElement();
    $input = $form_state->getUserInput() + $form_state->getValues();
    $posted = (string) ($input['bb_covered'] ?? '');
    $target = $this->entityTypeManager->getStorage($this->entity->getEntityTypeId())->loadUnchanged($this->entity->id());
    if (($trigger['#name'] ?? '') !== 'bb_confirm'
      || !($target instanceof BbMachineInterface || $target instanceof BbConductorInterface)
      || !TicketInterventions::mayRestartRuns($target, $this->currentUser())) {
      $this->messenger()->addError($this->t('This action is not available.'));
      return;
    }
    if ($posted !== implode(',', array_keys(TicketInterventions::restartCoveredRuns($target)))) {
      $this->messenger()->addError($this->t('The runs changed since the dialog opened. Check the list again.'));
      $form_state->setRebuild();
      return;
    }
    $runs = TicketInterventions::restartRuns($target, $this->currentUser());
    $this->messenger()->addStatus($this->formatPlural(count($runs), 'Restarted 1 run.', 'Restarted @count runs.'));
    $this->respondAtReturnUrl($form_state);
  }

  /**
   * One run's line: ticket, run number, state, and a frozen ticket's wait.
   */
  private function runLine(BbRunInterface $run): string {
    $ticket = $run->getTicket();
    $identifier = $ticket instanceof BbTicketInterface ? $ticket->getIdentifier() : '?';
    $line = sprintf('%s · run #%s · %s', $identifier, $run->id(), $run->getRunState());
    return $ticket instanceof BbTicketInterface && $ticket->isFrozen()
      ? $line . ' · ' . $this->t('frozen: the fresh run follows unfreeze')
      : $line;
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
    return $this->entity instanceof BbMachineInterface
      ? BbMachineRouteProvider::title($this->entity)
      : BbConductorRouteProvider::title($this->entity);
  }

}
