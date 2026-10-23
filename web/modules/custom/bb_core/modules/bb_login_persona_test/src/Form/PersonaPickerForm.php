<?php

declare(strict_types=1);

namespace Drupal\bb_login_persona_test\Form;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_login\Controller\BbOneTimeLoginController;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * One-click sign-in as a test persona.
 *
 * Only `bb_e2e` installs this module. Even if it is enabled elsewhere by
 * mistake, it lists and signs in nothing but active, human `@example.test`
 * accounts — a reserved domain no real customer can own — and checks that
 * again on submit, so a forged or stale click is refused.
 */
final class PersonaPickerForm extends FormBase {

  /**
   * The `#name` prefix of a persona button; the uid follows.
   */
  public const BUTTON_PREFIX = 'persona_';

  /**
   * The reserved domain every test account lives on.
   */
  private const DOMAIN = '@example.test';

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('entity_type.manager'));
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_login_persona_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $form['test_personas'] = [
      '#type' => 'details',
      '#title' => $this->t('Test personas'),
      '#open' => TRUE,
      '#attributes' => ['data-test' => 'test-personas'],
      'personas' => ['#type' => 'fieldset', '#title' => $this->t('Personas')],
      'fixtures' => ['#type' => 'fieldset', '#title' => $this->t('Fixture accounts')],
    ];
    $form['#cache']['tags'][] = 'user_list';
    foreach ($this->eligibleAccounts() as $account) {
      $group = str_starts_with($account->getAccountName(), 'fixture-') ? 'fixtures' : 'personas';
      $form['test_personas'][$group][self::BUTTON_PREFIX . $account->id()] = [
        '#type' => 'submit',
        '#name' => self::BUTTON_PREFIX . $account->id(),
        '#value' => $account->getAccountName(),
        '#persona_uid' => (int) $account->id(),
      ];
    }
    return $form;
  }

  /**
   * Refuses a click for an account that is not, or no longer, eligible.
   *
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    if ($this->clickedAccount($form_state) === NULL) {
      $form_state->setErrorByName('', $this->t('This account cannot be used as a test persona.'));
    }
  }

  /**
   * Signs in as the clicked persona and lands like every other sign-in.
   *
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $account = $this->clickedAccount($form_state);
    if ($account === NULL) {
      return;
    }
    user_login_finalize($account);

    // The same landing tail `BbCodeForm` runs: a parked deep link is handed
    // to core's redirect subscriber, which validates it, else the home route.
    $request = $this->getRequest();
    $session = $request->getSession();
    $destination = (string) $session->get(BbOneTimeLoginController::DESTINATION_KEY, '');
    if ($destination !== '') {
      $session->remove(BbOneTimeLoginController::DESTINATION_KEY);
      $request->query->set('destination', $destination);
    }
    $form_state->setRedirect('bb_core.home');
  }

  /**
   * The eligible account the triggering button names, re-loaded and re-checked.
   */
  private function clickedAccount(FormStateInterface $form_state): ?UserInterface {
    $uid = (int) ($form_state->getTriggeringElement()['#persona_uid'] ?? 0);
    $account = $uid > 0 ? $this->entityTypeManager->getStorage('user')->load($uid) : NULL;
    return $account instanceof UserInterface && $this->isEligible($account) ? $account : NULL;
  }

  /**
   * Active human `@example.test` accounts, by name.
   *
   * @return array<\Drupal\user\UserInterface>
   *   The accounts the picker lists.
   */
  private function eligibleAccounts(): array {
    $storage = $this->entityTypeManager->getStorage('user');
    $uids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('status', 1)
      ->condition('mail', self::DOMAIN, 'ENDS_WITH')
      ->sort('name')
      ->execute();
    return array_filter($storage->loadMultiple($uids), fn ($account): bool => $account instanceof UserInterface && $this->isEligible($account));
  }

  /**
   * Whether an account may be signed in through the picker.
   *
   * Service accounts are excluded: `user_login_finalize()` refuses them.
   */
  private function isEligible(UserInterface $account): bool {
    $isService = $account->hasField('bb_service_workspace') && !$account->get('bb_service_workspace')->isEmpty();
    return $account->isActive()
      && !$isService
      && str_ends_with(mb_strtolower((string) $account->getEmail()), self::DOMAIN);
  }

}
