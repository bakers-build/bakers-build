<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Cache\CacheableResponse;
use Drupal\Core\Entity\Entity\EntityFormDisplay;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Field\WidgetInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Htmx\HtmxLocationResponseData;
use Drupal\Core\Htmx\HtmxRequestInfoTrait;
use Drupal\Core\Url;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Onboarding\OnboardingDestination;
use Drupal\bb_core\Workspace\InviteMatcher;
use Drupal\user\Plugin\Validation\Constraint\UserNameUnique;
use Drupal\user\UserDataInterface;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The four-step HTMX onboarding wizard: identity, About you, setup, project.
 *
 * The template composes `bb_theme:onboarding` from `#bb_copy` and the
 * fields, so heading, copy and inputs swap as one HTMX fragment. The step
 * lives in Form API state, with one resumable integer in core user.data.
 * Finish, Finish & create, and Set up later are the only writes of
 * field_onboarding_completed. The picture is the `user_picture` widget of the
 * account form display — the same square-crop widget the account form uses —
 * and its file travels with the step's multipart POST.
 *
 * One Form API object owns the four pages and their exits; splitting it would
 * add a second form and a nested POST, which this wizard must not do.
 *
 * @SuppressWarnings("PHPMD.TooManyMethods")
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
 */
final class BbOnboardingWizardForm extends FormBase {

  use HtmxRequestInfoTrait;

  /**
   * Stable html id of the form itself.
   */
  private const string FORM_HTML_ID = 'bakers-onboarding-wizard-form';

  /**
   * Identity fields: name, username, picture.
   */
  private const int STEP_IDENTITY = 1;

  /**
   * About-you fields: position, background.
   */
  private const int STEP_ABOUT = 2;

  /**
   * Skill wizard and plugin installation.
   */
  private const int STEP_SETUP = 3;

  /**
   * Prepare your first project via init-project.
   *
   * Last page: Finish lives here.
   */
  private const int STEP_PROJECT = 4;

  /**
   * Core user.data provider for this wizard's saved step.
   */
  private const string USER_DATA_PROVIDER = 'bb_core';

  /**
   * Core user.data key for the resumable step integer.
   */
  private const string USER_DATA_KEY = 'onboarding_step';

  /**
   * Published manual origin. Wizard pages never fetch these URLs.
   */
  private const string DOCS_BASE = 'https://bakers.build/docs';

  /**
   * Fallback git-group prefix when settings have no plugin_source_base.
   *
   * Must match the shipped default in bb_core.settings.yml.
   */
  private const string DEFAULT_PLUGIN_SOURCE_BASE = 'https://git.key-tec.de/bakers-build/';

  public function __construct(
    protected EntityTypeManagerInterface $entityTypeManager,
    protected OnboardingDestination $destination,
    protected UserDataInterface $userData,
    protected InviteMatcher $inviteMatcher,
    protected BbWorkspaceReadScopeInterface $readScope,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('entity_type.manager'),
      $container->get('bb_core.onboarding_destination'),
      $container->get('user.data'),
      $container->get('bb_core.invite_matcher'),
      $container->get('bb_core.workspace_read_scope'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_onboarding_wizard_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $step = $this->step($form_state);
    $user = $this->currentUserEntity();

    $form['#id'] = self::FORM_HTML_ID;
    $form['#attributes']['id'] = self::FORM_HTML_ID;
    $form['#attributes']['data-bakers-onboarding-step'] = (string) $step;
    // THE FORM IS THE FRAGMENT, and it can be because the presenter renders
    // the chrome INSIDE it: heading, description, brand, fields, actions and
    // Form API's own `form_build_id` are all children of this element, so one
    // `outerHTML` swap replaces the step and everything that identifies it.
    // Bounding the swap by the chrome instead looked equivalent and was not —
    // `form_build_id` fell outside the selected element, the next POST could
    // not restore the build, and the step reset to 1 with the wrong button
    // read as the trigger.
    (new Htmx())
      ->post()
      ->onlyMainContent()
      ->select('#' . self::FORM_HTML_ID)
      ->target('#' . self::FORM_HTML_ID)
      ->swap('outerHTML')
      ->encoding()
      ->applyTo($form);
    // NEVER CACHED, and set after applyTo(), which overwrites #cache: the step
    // and the prefilled values are this account's, from user.data, which
    // carries no cache tag. Cached, Dynamic Page Cache served one account's
    // step to the next new account.
    $form['#cache']['max-age'] = 0;

    // THE COPY IS THE STEP'S, so it is built here and handed to the chrome by
    // the presenter template as props. It travels in the same fragment the
    // fields do; `bb_theme:onboarding` renders it and owns the frame.
    $form['#bb_copy'] = $this->copyForStep($step);
    // `bb_theme_theme()` registers this hook with `render element: form`,
    // which is what hands the presenter the parts it composes the chrome from.
    // Renaming the form id drops the presenter back to core's markup.
    $form['#theme'] = 'bb_onboarding_wizard_form';
    $form['progress'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => [
        'text' => $this->progressText($step),
        'size' => 'caption',
        'tone' => 'light',
        'attributes' => ['aria-current' => 'step'],
      ],
    ];

    // INSIDE THE FRAGMENT: the swap selects this form, so a validation error
    // printed by the page's messages block would never reach the reader.
    $form['messages'] = ['#type' => 'status_messages'];

    if ($step === self::STEP_ABOUT) {
      $form['ai_use_notice'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:note',
        '#props' => ['tone' => 'attention'],
        '#slots' => [
          'body' => [
            [
              '#plain_text' => $this->t('bakers.build passes these details as context to the AI assistants it uses, so that explanations and support match your background and your goals. You can change or delete them later.'),
            ],
          ],
        ],
      ];
    }

    $form['fields'] = [
      '#type' => 'container',
      '#attributes' => [
        'class' => ['flex', 'flex-col', 'gap-4'],
      ],
    ];
    match ($step) {
      self::STEP_IDENTITY => $this->buildIdentityFields($form, $form_state, $user),
      self::STEP_ABOUT => $this->buildAboutFields($form, $user),
      self::STEP_SETUP => $this->buildSetupFields($form),
      self::STEP_PROJECT => $this->buildProjectFields($form),
      default => NULL,
    };

    $form['actions'] = ['#type' => 'actions'];
    $this->buildActions($form, $step);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    // Only identity Next validates; Back, Skip and setup actions write nothing
    // that needs a field check.
    $trigger = (string) ($form_state->getTriggeringElement()['#name'] ?? '');
    if ($this->step($form_state) !== self::STEP_IDENTITY || $trigger !== 'next') {
      return;
    }
    $name = trim((string) $form_state->getValue('account_name', ''));
    $user = $this->currentUserEntity();
    $user->setUsername($name);
    foreach ($user->validate() as $violation) {
      $path = $violation->getPropertyPath();
      if ($path !== 'name' && !str_starts_with($path, 'name.')) {
        continue;
      }
      // Core's constraint message is generic; the reader is told which of the
      // two things went wrong.
      $form_state->setErrorByName('account_name', $violation->getConstraint() instanceof UserNameUnique
        ? $this->t('This nickname is already taken.')
        : $this->t('This nickname is not valid. Use letters, digits, spaces and . - _ @, and at most @max characters.', ['@max' => UserInterface::USERNAME_MAX_LENGTH]));
      break;
    }
    $this->validatePicture($form, $form_state, $user);
  }

  /**
   * Builds the picture onto the account and flags its violations.
   *
   * The widget uploads the file while the form is processed and the item's
   * own constraints check it — alternative text, file access, a valid crop.
   * Nothing is saved here; Next saves the account.
   */
  private function validatePicture(array $form, FormStateInterface $form_state, UserInterface $user): void {
    $widget = $this->pictureWidget($user);
    if ($widget === NULL || $form_state->hasAnyErrors()) {
      return;
    }
    $items = $user->get('user_picture');
    $widget->extractFormValues($items, $form, $form_state);
    $widget->flagErrors($items, $items->validate(), $form, $form_state);
  }

  /**
   * The account form display's widget for `user_picture`, if any.
   */
  private function pictureWidget(UserInterface $user): ?WidgetInterface {
    if (!$user->hasField('user_picture')) {
      return NULL;
    }
    $widget = EntityFormDisplay::collectRenderDisplay($user, 'default')->getRenderer('user_picture');
    return $widget instanceof WidgetInterface ? $widget : NULL;
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.CyclomaticComplexity")
   * @SuppressWarnings("PHPMD.NPathComplexity")
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $trigger = (string) ($form_state->getTriggeringElement()['#name'] ?? '');
    $step = $this->step($form_state);

    if ($trigger === 'back') {
      $this->goBack($form_state, $step);
      return;
    }

    if ($trigger === 'skip' && $step === self::STEP_IDENTITY) {
      $this->advanceTo($form_state, self::STEP_ABOUT);
      return;
    }

    if ($trigger === 'next' && $step === self::STEP_IDENTITY) {
      $this->saveIdentity($form, $form_state);
      $this->advanceTo($form_state, self::STEP_ABOUT);
      return;
    }

    if ($trigger === 'next' && $step === self::STEP_ABOUT) {
      $this->saveAbout($form_state);
      $this->advanceTo($form_state, self::STEP_SETUP);
      return;
    }

    if ($trigger === 'next' && $step === self::STEP_SETUP) {
      $this->advanceTo($form_state, self::STEP_PROJECT);
      return;
    }

    if ($trigger === 'set_up_later' && ($step === self::STEP_SETUP || $step === self::STEP_PROJECT)) {
      $this->leaveWizard($form_state, 'bb_core.home');
      return;
    }

    if ($step !== self::STEP_PROJECT) {
      return;
    }

    if ($trigger === 'finish') {
      $this->leaveWizard($form_state, 'bb_core.home');
      return;
    }

    if ($trigger === 'finish_create') {
      $route = $this->mayCreateWorkspaceOnFinish()
        ? 'bb_core.workspace_create'
        : 'bb_core.home';
      $this->leaveWizard($form_state, $route);
    }
  }

  /**
   * The current wizard step, restored from Form API then user.data.
   */
  private function step(FormStateInterface $form_state): int {
    if (!$form_state->has('bb_onboarding_step')) {
      $saved = $this->userData->get(
        self::USER_DATA_PROVIDER,
        (int) $this->currentUser()->id(),
        self::USER_DATA_KEY,
      );
      $form_state->set('bb_onboarding_step', $this->boundStep((int) $saved));
    }
    return $this->boundStep((int) $form_state->get('bb_onboarding_step'));
  }

  /**
   * Restricts a stored or submitted step to the pages this account may see.
   */
  private function boundStep(int $step): int {
    if ($this->destination->isComplete($this->currentUser())) {
      return $step === self::STEP_PROJECT ? self::STEP_PROJECT : self::STEP_SETUP;
    }
    return ($step >= self::STEP_IDENTITY && $step <= self::STEP_PROJECT)
      ? $step
      : self::STEP_IDENTITY;
  }

  /**
   * Approved copy for the current step.
   *
   * @return array{title: string, description: string}
   *   Visible heading and lede.
   */
  private function copyForStep(int $step): array {
    return match ($step) {
      self::STEP_ABOUT => [
        'title' => (string) $this->t('Tell us about yourself'),
        'description' => (string) $this->t('So we speak your language — matched to your work and your background.'),
      ],
      self::STEP_SETUP => [
        'title' => (string) $this->t('Get started - set up bakers.build on your machine'),
        'description' => (string) $this->t('Install the bakers.build plugin, then paste the skill wizard prompt into your agent. This page never runs the commands for you.'),
      ],
      self::STEP_PROJECT => [
        'title' => (string) $this->t('Prepare your first project'),
        'description' => (string) $this->t('Open a checkout and let init-project connect it as a bakers.build project. This page never runs the skill for you.'),
      ],
      default => [
        'title' => (string) $this->t('What should we call you?'),
        'description' => (string) $this->t('A name and a picture — and bakers.build feels less like software and more like your team.'),
      ],
    };
  }

  /**
   * Progress caption for first-time onboarding or a voluntary reopen.
   */
  private function progressText(int $step): string {
    if ($this->destination->isComplete($this->currentUser())) {
      return (string) $this->t('Setup');
    }
    return (string) $this->t('Step @current of @total', [
      '@current' => $step,
      '@total' => self::STEP_PROJECT,
    ]);
  }

  /**
   * Identity fields: full name, nickname, optional picture.
   */
  private function buildIdentityFields(array &$form, FormStateInterface $form_state, UserInterface $user): void {
    $form['fields']['field_full_name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Full name'),
      '#default_value' => $user->hasField('field_full_name')
        ? (string) $user->get('field_full_name')->value
        : '',
      '#required' => FALSE,
      '#maxlength' => 255,
    ];
    $form['fields']['account_name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Nickname (username)'),
      '#default_value' => $user->getAccountName(),
      '#required' => TRUE,
      '#required_error' => $this->t('Enter a nickname.'),
      '#maxlength' => UserInterface::USERNAME_MAX_LENGTH,
    ];
    // THE ACCOUNT FORM'S OWN WIDGET, so the wizard and the account form crop
    // and validate a picture the same way. It needs no Drupal Ajax: the file
    // and its crop travel with Next.
    $widget = $this->pictureWidget($user);
    if ($widget !== NULL) {
      $form['#parents'] = [];
      $items = $user->get('user_picture');
      $items->filterEmptyItems();
      $form['fields']['user_picture'] = $widget->form($items, $form, $form_state);
    }
  }

  /**
   * About-you fields: optional position and prior knowledge.
   */
  private function buildAboutFields(array &$form, UserInterface $user): void {
    if (!$user->hasField('field_developer_title') || !$user->hasField('field_bb_background')) {
      return;
    }
    $form['fields']['field_developer_title'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Position'),
      '#default_value' => (string) $user->get('field_developer_title')->value,
      '#required' => FALSE,
      '#maxlength' => 255,
      '#placeholder' => $this->t('e.g. Product Lead'),
    ];
    $form['fields']['field_bb_background'] = [
      '#type' => 'textarea',
      '#title' => $this->t('What should bakers.build know about your background?'),
      '#default_value' => (string) $user->get('field_bb_background')->value,
      '#required' => FALSE,
      '#rows' => 3,
    ];
  }

  /**
   * Installation commands and documentation links.
   */
  private function buildSetupFields(array &$form): void {
    $marketplace = $this->marketplaceGitUrl();
    $form['fields']['prerequisites'] = $this->note(
      (string) $this->t('You need Node.js 20.19 or newer with npm, and git. The skill wizard walks you through the rest. You do not need Claude, Codex or a local conductor merely to use the web application.'),
    );
    $claude = [
      'label' => $this->plainText(
        (string) $this->t('Inside Claude Code, each as its own command:'),
      ),
    ];
    $i = 0;
    foreach ([
      '/plugin marketplace add ' . $marketplace => (string) $this->t('Copy the marketplace add command'),
      '/plugin install bakers@bakers' => (string) $this->t('Copy the plugin install command'),
    ] as $command => $label) {
      $claude['cmd_' . $i] = $this->commandElement($command, $label);
      $i++;
    }
    $codex = [
      'label' => $this->plainText(
        (string) $this->t('With the Codex CLI, each as its own command:'),
      ),
    ];
    $i = 0;
    foreach ([
      'codex plugin marketplace add ' . $marketplace => (string) $this->t('Copy the Codex marketplace add command'),
      'codex plugin add bakers@bakers' => (string) $this->t('Copy the Codex plugin install command'),
    ] as $command => $label) {
      $codex['cmd_' . $i] = $this->commandElement($command, $label);
      $i++;
    }
    $form['fields']['paths'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:setup_paths',
      '#props' => [
        'selected' => 'claude',
        'filter_label' => (string) $this->t('Agent'),
        'items' => [
          [
            'label' => (string) $this->t('Claude Code'),
            'value' => 'claude',
          ],
          [
            'label' => (string) $this->t('Codex'),
            'value' => 'codex',
          ],
        ],
      ],
      '#slots' => [
        'intro' => $this->plainText(
          (string) $this->t('Install the bakers.build plugin first:'),
        ),
        'panel_a' => $claude,
        'panel_b' => $codex,
        'after' => [
          'label' => $this->plainText(
            (string) $this->t('Then paste this into your agent:'),
          ),
          'init_prompt' => $this->commandElement(
            'Use `bakers:init` to guide me through installing and setting up bakers.build.',
            (string) $this->t('Copy the skill wizard prompt'),
          ),
        ],
      ],
    ];
    $this->attachDocsLinks($form, [
      (string) $this->t('bakers.build documentation') => '/get-started/',
      (string) $this->t('Install bakers.build') => '/get-started/install',
      (string) $this->t('Skill wizard') => '/get-started/install#skill-wizard-%E2%80%94-recommended',
    ]);
  }

  /**
   * Initialize-project prompt and documentation link.
   */
  private function buildProjectFields(array &$form): void {
    $form['fields']['note'] = $this->note(
      (string) $this->t('Open a repository checkout in your agent, then paste the prompt. init-project needs a bakers.build workspace, then finds or creates the project and writes the checkout configuration. You can finish here and do this later from any checkout.'),
    );
    $form['fields']['prompt_label'] = $this->plainText(
      (string) $this->t('Paste this into your agent:'),
    );
    $form['fields']['init_prompt'] = $this->commandElement(
      'Use `bakers:init-project` to connect this checkout as a bakers.build project.',
      (string) $this->t('Copy the init-project prompt'),
    );
    $this->attachDocsLinks($form, [
      (string) $this->t('bakers.build documentation') => '/get-started/',
      (string) $this->t('Connect your project') => '/get-started/connect-a-project',
      (string) $this->t('Initialize a project') => '/get-started/connect-a-project#skill-wizard-%E2%80%94-recommended',
    ]);
  }

  /**
   * Step actions for the current page.
   */
  private function buildActions(array &$form, int $step): void {
    $complete = $this->destination->isComplete($this->currentUser());
    if ($step === self::STEP_IDENTITY) {
      // Skip validates nothing and writes nothing: the account already has a
      // username, and every field on this step is optional by design. Core
      // honours `#limit_validation_errors` on a submission only for a button
      // with its own `#submit`, so both are needed.
      $form['actions']['skip'] = $this->ghostSubmit($this->t('Skip'), 'skip');
      $form['actions']['next'] = $this->primarySubmit($this->t('Next'), 'next');
      return;
    }

    if ($step !== self::STEP_SETUP || !$complete) {
      $form['actions']['back'] = $this->ghostSubmit($this->t('Back'), 'back');
    }

    if ($step === self::STEP_ABOUT || $step === self::STEP_SETUP) {
      $form['actions']['next'] = $this->primarySubmit($this->t('Next'), 'next');
    }

    if ($step === self::STEP_PROJECT) {
      $form['actions']['finish'] = $this->primarySubmit($this->t('Finish'), 'finish');
      if ($this->mayCreateWorkspaceOnFinish()) {
        $form['actions']['finish_create'] = [
          '#type' => 'submit',
          '#value' => $this->t('Finish & create a new workspace'),
          '#name' => 'finish_create',
          '#theme_wrappers' => ['input__submit__bb_button'],
        ];
      }
    }

    if ($step === self::STEP_SETUP || $step === self::STEP_PROJECT) {
      $form['actions']['set_up_later'] = $this->ghostSubmit($this->t('Set up later'), 'set_up_later');
    }
  }

  /**
   * Moves one page back without writing unsent field values.
   */
  private function goBack(FormStateInterface $form_state, int $step): void {
    $previous = match ($step) {
      self::STEP_ABOUT => self::STEP_IDENTITY,
      self::STEP_SETUP => self::STEP_ABOUT,
      self::STEP_PROJECT => self::STEP_SETUP,
      default => self::STEP_IDENTITY,
    };
    $this->advanceTo($form_state, $this->boundStep($previous));
  }

  /**
   * Records a successful step transition in Form API state and user.data.
   */
  private function advanceTo(FormStateInterface $form_state, int $step): void {
    $form_state->set('bb_onboarding_step', $step);
    $this->userData->set(
      self::USER_DATA_PROVIDER,
      (int) $this->currentUser()->id(),
      self::USER_DATA_KEY,
      $step,
    );
    $form_state->setRebuild();
  }

  /**
   * Marks onboarding complete and leaves for a fixed product route.
   *
   * With JavaScript, Home is an `HX-Location` so the document survives it;
   * workspace create is an `HX-Redirect` so the destination form is a real
   * document. Without JavaScript both are ordinary redirects. Query
   * destinations are discarded.
   */
  private function leaveWizard(FormStateInterface $form_state, string $route): void {
    $this->destination->markComplete($this->currentUser());
    $this->userData->delete(
      self::USER_DATA_PROVIDER,
      (int) $this->currentUser()->id(),
      self::USER_DATA_KEY,
    );
    $form_state->setIgnoreDestination();
    if (!$this->isHtmxRequest()) {
      $form_state->setRedirect($route);
      return;
    }
    $response = new CacheableResponse('');
    $response->getCacheableMetadata()->setCacheMaxAge(0);
    $htmx = new Htmx();
    $url = Url::fromRoute($route);
    if ($route === 'bb_core.home') {
      // Both the wizard and the overview wrap their page in Drupal's off-canvas
      // canvas. Selecting `body` fails: HTMX parses the location GET as a
      // fragment and strips html/body, so the swap is empty. This selector
      // exists on both surfaces.
      $htmx->locationHeader(new HtmxLocationResponseData(
        $url,
        target: '[data-off-canvas-main-canvas]',
        swap: 'outerHTML',
        select: '[data-off-canvas-main-canvas]',
      ));
    }
    if ($route !== 'bb_core.home') {
      $htmx->redirectHeader($url);
    }
    foreach ($htmx->getHeaders()->all() as $name => $values) {
      foreach ((array) $values as $value) {
        $response->headers->set((string) $name, (string) $value);
      }
    }
    $form_state->setResponse($response);
  }

  /**
   * Whether Finish & create is still the right exit for this account.
   *
   * Rechecked at submit: a late invitation offer, or a workspace bypass,
   * sends the account Home instead of hiding the offer behind create.
   */
  private function mayCreateWorkspaceOnFinish(): bool {
    $account = $this->currentUser();
    if ($this->readScope->isBypassed($account, 'bb_workspace')) {
      return FALSE;
    }
    return $this->inviteMatcher->offersForAccount(
      $account,
      $this->readScope->workspaceIds($account),
    ) === [];
  }

  /**
   * Saves identity fields and username from step 1.
   */
  private function saveIdentity(array $form, FormStateInterface $form_state): void {
    $user = $this->currentUserEntity();
    if ($user->hasField('field_full_name')) {
      $user->set('field_full_name', $this->optionalString($form_state, 'field_full_name'));
    }
    $user->setUsername(trim((string) $form_state->getValue('account_name', '')));
    $widget = $this->pictureWidget($user);
    $widget?->extractFormValues($user->get('user_picture'), $form, $form_state);
    $user->save();
  }

  /**
   * Saves About-you fields from step 2.
   */
  private function saveAbout(FormStateInterface $form_state): void {
    $user = $this->currentUserEntity();
    // Guarded, because the About-you fields are configuration: a site — or a
    // test fixture — that carries the module without them must still be able
    // to finish onboarding rather than fatal on the last click.
    foreach (['field_developer_title', 'field_bb_background'] as $field) {
      if ($user->hasField($field)) {
        $user->set($field, $this->optionalString($form_state, $field));
      }
    }
    $user->save();
  }

  /**
   * Trimmed submitted string, or NULL when empty.
   */
  private function optionalString(FormStateInterface $form_state, string $key): ?string {
    $value = trim((string) $form_state->getValue($key, ''));
    return $value === '' ? NULL : $value;
  }

  /**
   * The signed-in account as a full user entity.
   */
  private function currentUserEntity(): UserInterface {
    $user = $this->entityTypeManager->getStorage('user')->load($this->currentUser()->id());
    assert($user instanceof UserInterface);
    return $user;
  }

  /**
   * A ghost submit used for Skip, Back and Set up later.
   */
  private function ghostSubmit(mixed $value, string $name): array {
    return [
      '#type' => 'submit',
      '#value' => $value,
      '#name' => $name,
      '#limit_validation_errors' => [],
      '#submit' => ['::submitForm'],
      '#bb_variant' => 'ghost',
      '#theme_wrappers' => ['input__submit__bb_button'],
    ];
  }

  /**
   * A primary submit used for Next and Finish.
   */
  private function primarySubmit(mixed $value, string $name): array {
    return [
      '#type' => 'submit',
      '#value' => $value,
      '#name' => $name,
      '#button_type' => 'primary',
      '#theme_wrappers' => ['input__submit__bb_button'],
    ];
  }

  /**
   * Public git clone URL of the bakers.build plugin marketplace.
   *
   * Built from bb_core.settings:plugin_source_base so a site can point at a
   * different git host without a code change. The `.git` suffix is required so
   * marketplace clients clone the repository instead of fetching HTML.
   */
  private function marketplaceGitUrl(): string {
    $base = trim((string) $this->config('bb_core.settings')->get('plugin_source_base'));
    if ($base === '') {
      $base = self::DEFAULT_PLUGIN_SOURCE_BASE;
    }
    return rtrim($base, '/') . '/bakers-build.git';
  }

  /**
   * One displayed shell or slash command, never interpolated with account data.
   */
  private function commandElement(string $command, string $label): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:setup_command',
      '#props' => [
        'command' => $command,
        'label' => $label,
      ],
    ];
  }

  /**
   * A short instruction line.
   */
  private function plainText(string $text): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => [
        'text' => $text,
        'size' => 'caption',
        'tone' => 'light',
      ],
    ];
  }

  /**
   * A quiet aside for prerequisites and optional blocks.
   */
  private function note(string $body): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:note',
      '#props' => ['tone' => 'attention'],
      '#slots' => [
        'body' => [
          ['#plain_text' => $body],
        ],
      ],
    ];
  }

  /**
   * Documentation links that open separately from the unfinished wizard.
   *
   * @param array<string, mixed> $form
   *   The form being built.
   * @param array<string, string> $links
   *   Label to path pairs under the published manual origin.
   */
  private function attachDocsLinks(array &$form, array $links): void {
    $rows = [];
    foreach ($links as $title => $path) {
      $rows[] = [
        'url' => self::DOCS_BASE . $path,
        'title' => $title,
        'kind' => 'doc',
      ];
    }
    $form['fields']['docs'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:link-group',
      '#props' => [
        'label' => (string) $this->t('Guides'),
        'links' => $rows,
      ],
    ];
  }

}
