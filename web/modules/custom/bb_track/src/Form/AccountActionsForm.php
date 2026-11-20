<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Form\TicketNavigation;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\WorkAssignments;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A billing account detail's actions: Edit, Make default and Archive.
 *
 * Offered to whoever may update the account, which an archived account
 * refuses to all, so its detail is read-only. The default offers no Archive,
 * a linked account no Make default. Every action returns to the detail.
 *
 * @SuppressWarnings("PHPMD.UnusedFormalParameter")
 */
final class AccountActionsForm extends FormBase {

  /**
   * Constructs the form with serializable application services.
   */
  public function __construct(
    protected WorkAssignments $assignments,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_track.assignments'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_track_account_actions';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?Account $billing_account = NULL): array {
    $form['#cache']['max-age'] = 0;
    $form_state->set('account', $billing_account);
    $project = $billing_account?->get('project_id')->entity;
    if (!$project instanceof BbProjectInterface || !$billing_account->access('update')) {
      return $form;
    }
    $default = (bool) $billing_account->get('is_default')->value;
    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['edit'] = AccountEditForm::trigger($project, $billing_account, (string) $this->t('Edit'), 'neutral', FALSE);
    if (!$default && WorkAssignments::linkedTickets($billing_account) === []) {
      $form['actions']['make_default'] = $this->submit('make_default', $this->t('Make default'), 'neutral', '::makeDefault');
    }
    if (!$default) {
      $form['actions']['archive'] = $this->submit('archive', $this->t('Archive'), 'danger', '::archive');
    }
    return $form;
  }

  /**
   * One action's submit.
   *
   * @return array<string, mixed>
   *   A Form API submit.
   */
  private function submit(string $name, TranslatableMarkup $label, string $variant, string $handler): array {
    return [
      '#type' => 'submit',
      '#name' => $name,
      '#value' => $label,
      '#bb_variant' => $variant,
      '#theme_wrappers' => ['input__submit__bb_button'],
      '#limit_validation_errors' => [],
      '#submit' => [$handler],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    // Unreachable: every action declares its own #submit callback.
  }

  /**
   * Makes the account the project default.
   */
  public function makeDefault(array &$form, FormStateInterface $form_state): void {
    $billing_account = $this->pressedAccount($form_state);
    if ($billing_account === NULL) {
      return;
    }
    $this->persist($form_state, fn () => $this->assignments->makeDefault($this->projectId($billing_account), (int) $billing_account->id()), $this->t('Default billing account changed. Existing bookings keep their account.'));
  }

  /**
   * Archives the account; old bookings keep its id.
   */
  public function archive(array &$form, FormStateInterface $form_state): void {
    $billing_account = $this->pressedAccount($form_state);
    if ($billing_account === NULL) {
      return;
    }
    $this->persist($form_state, fn () => $this->assignments->saveAccount($this->projectId($billing_account), [
      'name' => (string) $billing_account->label(),
      'external_id' => (string) $billing_account->get('external_id')->value,
      'active' => FALSE,
    ], (int) $billing_account->id()), $this->t('Billing account archived. Existing bookings keep their account; its tickets use the inherited account.'));
  }

  /**
   * The account, or NULL when the pressed control was not posted.
   *
   * A control gone since the page loaded matches nothing, and Form API then
   * takes the first remaining button: another action.
   */
  private function pressedAccount(FormStateInterface $form_state): ?Account {
    $trigger = $form_state->getTriggeringElement();
    $billing_account = $form_state->get('account');
    if (!array_key_exists($trigger['#name'] ?? '', $form_state->getUserInput()) || !$billing_account instanceof Account) {
      $this->messenger()->addError($this->t('This billing account changed elsewhere. Reload the page and try again.'));
      return NULL;
    }
    return $billing_account;
  }

  /**
   * Runs a billing-account write, mapping its domain errors to a message.
   */
  private function persist(FormStateInterface $form_state, callable $write, TranslatableMarkup $success): void {
    try {
      $write();
      $this->messenger()->addStatus($success);
    }
    catch (\InvalidArgumentException | \DomainException $error) {
      $this->messenger()->addError($error->getMessage());
    }
    catch (\Throwable $error) {
      $this->logger('bb_track')->error('Billing account write failed: @message', ['@message' => $error->getMessage()]);
      $this->messenger()->addError($this->t('The billing account could not be saved. Refresh and retry.'));
    }
    $billing_account = $form_state->get('account');
    assert($billing_account instanceof Account);
    // Core drops form redirects on htmx requests; a rebuilt page here would
    // still show the account as it was before the write.
    TicketNavigation::finishAt($billing_account->toUrl(), $form_state, $this->getRequest());
  }

  /**
   * The account's project id.
   */
  private function projectId(Account $billing_account): int {
    return (int) $billing_account->get('project_id')->target_id;
  }

}
