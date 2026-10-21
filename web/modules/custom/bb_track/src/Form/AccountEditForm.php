<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Core\Entity\EntityFieldManagerInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Render\Element;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_track\AccountValidation;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\WorkAssignments;
use Drupal\island\Form\WrappedDialogFormBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * The New / Edit billing account dialog: name, external ID and terms.
 *
 * Opened over the project's billing face, as a dialog with JavaScript and
 * as a plain page without. No ticket field (tickets link on the ticket) and
 * no default switch (Make default is a row action). Only the terms of the
 * chosen type and budget render; htmx re-renders them when either changes.
 * Without JavaScript the stored type's fields show, and a save of another
 * type is validated against that type's rules.
 */
final class AccountEditForm extends WrappedDialogFormBase {

  /**
   * The id of the wrapper htmx swaps when the type or budget changes.
   */
  private const string TERMS_ID = 'bakers-track-account-terms';

  /**
   * The billing-account application service.
   */
  protected WorkAssignments $assignments;

  /**
   * The entity field manager, for the type and budget options.
   */
  protected EntityFieldManagerInterface $fields;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->assignments = $container->get('bb_track.assignments');
    $form->fields = $container->get('entity_field.manager');
    return $form;
  }

  /**
   * The trigger opening this dialog for a new or an existing account.
   *
   * @return array<string, mixed>
   *   A button component.
   */
  public static function trigger(BbProjectInterface $project, ?Account $billing_account, string $label, string $variant, bool $icon_only): array {
    $parameters = ['bb_project' => $project->uuid()];
    $route = 'bb_track.account_add';
    if ($billing_account instanceof Account) {
      $route = 'bb_track.account_edit';
      $parameters['bb_track_account'] = $billing_account->id();
    }
    $destination = Url::fromRoute('bb_track.account', ['bb_project' => $project->uuid()])->toString();
    $url = static fn (array $query): Url => Url::fromRoute($route, $parameters, ['query' => $query]);
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#attached' => ['library' => ['core/drupal.htmx', 'core/components.bb_theme--option_picker']],
      '#props' => [
        'label' => $label,
        'href' => $url(['destination' => $destination])->toString(),
        'variant' => $variant,
        'icon_only' => $icon_only,
        'attributes' => (new Htmx())
          ->get($url(['destination' => $destination, static::WRAPPER_FORMAT_PARAMETER => static::DIALOG_FORMAT]))
          ->target('#bakers-overlay')
          ->select('dialog:not(dialog dialog)')
          ->swap('innerHTML')
          ->getAttributes(),
      ],
    ];
    if ($icon_only) {
      $build['#slots']['icon'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:icon',
        '#props' => ['name' => 'plus', 'size' => 'sm'],
      ];
    }
    return $build;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_track_account_edit_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?BbProjectInterface $bb_project = NULL, ?Account $bb_track_account = NULL): array {
    if ($bb_track_account instanceof Account
      && ((int) $bb_track_account->get('project_id')->target_id !== (int) $bb_project->id() || !$bb_track_account->get('active')->value)) {
      throw new NotFoundHttpException();
    }
    $form_state->set('project', $bb_project);
    $form_state->set('account_id', $bb_track_account?->id());
    $form['#cache']['max-age'] = 0;
    $form['#theme'] = 'bb_create_dialog';
    $form['#title'] = $bb_track_account ? $this->t('Edit billing account') : $this->t('New billing account');
    $form['name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Name'),
      '#title_display' => 'invisible',
      '#placeholder' => $this->t('What is this billing account called'),
      '#default_value' => $bb_track_account?->label() ?? '',
      '#required' => TRUE,
      '#maxlength' => 255,
      '#picker_region' => 'lines',
    ];
    $form['external_id'] = [
      '#type' => 'textfield',
      '#title' => $this->t('External ID'),
      '#description' => $this->t('ID in the external billing system, e.g. a Harvest project ID.'),
      '#default_value' => $bb_track_account?->get('external_id')->value ?? '',
      '#maxlength' => 255,
      '#picker_region' => 'lines',
    ];
    $types = $this->options('billing_type');
    $type = $this->current($form_state, 'billing_type', $bb_track_account, $types);
    $form['billing_type'] = [
      '#type' => 'select',
      '#title' => $this->t('Type'),
      '#options' => $types,
      '#default_value' => $type,
      '#required' => TRUE,
    ];
    $form['terms'] = ['#type' => 'container', '#attributes' => ['id' => self::TERMS_ID]]
      + $this->termElements($form_state, $type, $bb_track_account);
    $form['active'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Active'),
      '#default_value' => $bb_track_account ? (bool) $bb_track_account->get('active')->value : TRUE,
    ];
    $form['actions'] = [
      '#type' => 'actions',
      'cancel' => [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => [
          'variant' => 'ghost',
          'label' => (string) $this->t('Cancel'),
          'href' => $this->returnUrl()->toString(),
          'attributes' => new Attribute(['data-dialog-cancel' => 'data-dialog-cancel']),
        ],
        '#weight' => -10,
      ],
      'submit' => [
        '#type' => 'submit',
        '#value' => $bb_track_account ? $this->t('Save') : $this->t('Create billing account'),
        '#theme_wrappers' => ['input__submit__bb_button'],
      ],
    ];
    $form['#attached']['library'][] = 'core/components.bb_theme--option_picker';
    $this->attachTermsRefresh($form);
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * The term fields the type and budget show, per the type's rules.
   *
   * @return array<string, array<string, mixed>>
   *   Form elements keyed by field name.
   */
  private function termElements(FormStateInterface $form_state, string $type, ?Account $billing_account): array {
    if ($type === 'non_billable') {
      return [];
    }
    $kinds = $this->options('budget_kind');
    $kind = $this->current($form_state, 'budget_kind', $billing_account, $kinds);
    $amount = fn (string $name, TranslatableMarkup $title): array => [
      '#type' => 'number',
      '#title' => $title,
      '#step' => '0.01',
      '#min' => 0,
      '#max' => 9999999999.99,
      '#default_value' => $billing_account?->get($name)->value,
    ];
    $elements = [];
    if ($type === 'fixed_fee') {
      $elements['fixed_fee'] = ['#required' => TRUE] + $amount('fixed_fee', $this->t('Fixed fee'));
    }
    $elements['budget_kind'] = [
      '#type' => 'select',
      '#title' => $this->t('Budget'),
      '#options' => $kinds,
      '#default_value' => $kind,
      '#required' => TRUE,
    ];
    if ($kind !== 'none') {
      $elements['budget_value'] = ['#required' => TRUE] + $amount('budget_value', $kind === 'hours' ? $this->t('Budget hours') : $this->t('Budget amount'));
    }
    if ($type === 'fixed_fee' ? $kind === 'hours' : $kind !== 'none') {
      $elements['budget_resets_monthly'] = [
        '#type' => 'checkbox',
        '#title' => $this->t('Budget resets every month'),
        '#default_value' => (bool) $billing_account?->get('budget_resets_monthly')->value,
      ];
    }
    $elements['hourly_rate'] = $amount('hourly_rate', $this->t('Hourly rate'));
    return $elements;
  }

  /**
   * The posted choice if it is an option, else the stored one, else the first.
   *
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   * @param string $name
   *   The list field.
   * @param \Drupal\bb_track\Entity\Account|null $billing_account
   *   The edited account, or NULL.
   * @param array<string, string> $options
   *   The field's options.
   */
  private function current(FormStateInterface $form_state, string $name, ?Account $billing_account, array $options): string {
    $posted = $form_state->getUserInput()[$name] ?? NULL;
    if (is_string($posted) && isset($options[$posted])) {
      return $posted;
    }
    return (string) ($billing_account?->get($name)->value ?? array_key_first($options));
  }

  /**
   * A list field's allowed values.
   *
   * @return array<string, string>
   *   Labels keyed by value.
   */
  private function options(string $name): array {
    return $this->fields->getBaseFieldDefinitions('bb_track_account')[$name]->getSetting('allowed_values');
  }

  /**
   * Re-renders the terms when the type or the budget changes.
   *
   * As in BbTicketCreateForm: posts to the url the form posts to and names
   * the trigger, so the refresh runs no submit and reports no errors.
   *
   * @param array $form
   *   The form, mutated in place; ungenerified for `Htmx::applyTo()`.
   */
  private function attachTermsRefresh(array &$form): void {
    $this->termsRefresh('billing_type')->applyTo($form['billing_type']);
    if (isset($form['terms']['budget_kind'])) {
      $this->termsRefresh('budget_kind')->applyTo($form['terms']['budget_kind']);
    }
  }

  /**
   * An htmx post re-rendering the terms wrapper, triggered by the field.
   */
  private function termsRefresh(string $name): Htmx {
    $htmx = (new Htmx())
      ->post($this->isDialogRequest() ? $this->dialogPostUrl() : Url::fromUserInput($this->getRequest()->getPathInfo()))
      ->trigger('change')
      ->vals(['_triggering_element_name' => $name])
      ->select('#' . self::TERMS_ID)
      ->target('#' . self::TERMS_ID)
      ->swap('outerHTML');
    if (!$this->isDialogRequest()) {
      $htmx->onlyMainContent();
    }
    return $htmx;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    foreach (AccountValidation::terms($this->postedTerms($form, $form_state)) as $name => $message) {
      $form_state->setErrorByName($name, $message);
    }
  }

  /**
   * The type and the terms it shows; hidden terms are not taken.
   *
   * @return array<string, mixed>
   *   Terms in the shape AccountValidation::terms() reads.
   */
  private function postedTerms(array $form, FormStateInterface $form_state): array {
    $terms = ['billing_type' => (string) $form_state->getValue('billing_type'), 'budget_kind' => 'none'];
    foreach (Element::children($form['terms']) as $name) {
      $value = $form_state->getValue($name);
      $terms[$name] = match (TRUE) {
        $name === 'budget_resets_monthly' => (bool) $value,
        $value === NULL || $value === '' => NULL,
        default => (string) $value,
      };
    }
    return $terms;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $project = $form_state->get('project');
    assert($project instanceof BbProjectInterface);
    $id = $form_state->get('account_id');
    try {
      $this->assignments->saveAccount((int) $project->id(), [
        'name' => (string) $form_state->getValue('name'),
        'external_id' => (string) $form_state->getValue('external_id'),
        'active' => (bool) $form_state->getValue('active'),
      ] + $this->postedTerms($form, $form_state), $id === NULL ? NULL : (int) $id);
    }
    catch (\InvalidArgumentException | \DomainException $error) {
      $this->messenger()->addError($error->getMessage());
      $form_state->setRebuild();
      return;
    }
    // A busy account lock, or a database error: logged, never shown raw.
    catch (\Throwable $error) {
      $this->logger('bb_track')->error('Billing account write failed: @message', ['@message' => $error->getMessage()]);
      $this->messenger()->addError($this->t('The billing account could not be saved. Refresh and retry.'));
      $form_state->setRebuild();
      return;
    }
    $this->messenger()->addStatus($id === NULL
      ? new TranslatableMarkup('Billing account created.')
      : new TranslatableMarkup('Billing account saved. Existing bookings keep their account.'));
    $this->respondAtReturnUrl($form_state);
  }

}
