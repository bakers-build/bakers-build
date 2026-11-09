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
use Drupal\bb_core\Access\BbWorkspaceCreateAccess;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Onboarding\FirstProjectCreator;
use Drupal\bb_core\Onboarding\OnboardingDestination;
use Drupal\bb_core\Workspace\InviteMatcher;
use Drupal\user\Plugin\Validation\Constraint\UserNameUnique;
use Drupal\user\UserDataInterface;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The HTMX onboarding wizard: identity, About you, project, setup.
 *
 * The project page is optional.
 *
 * The template composes `bb_theme:onboarding` from `#bb_copy` and the
 * fields, so heading, copy and inputs swap as one HTMX fragment. The step
 * lives in Form API state, with one resumable integer in core user.data.
 * Finish, Finish & create, and Set up later are the only writes of
 * field_onboarding_completed. The picture is the `user_picture` widget of the
 * account form display — the same square-crop widget the account form uses —
 * and its file travels with the step's multipart POST.
 *
 * The project step exists only for an account that may create a group and a
 * project in one of its workspaces; for everyone else the wizard has three
 * steps. The saved integer is the page number as shown.
 *
 * One Form API object owns the pages and their exits; splitting it would
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
   * Optional first project: Yes or Later, then the project's fields.
   *
   * Hidden when the account may not create one; see ::setupStep().
   */
  private const int STEP_PROJECT = 3;

  /**
   * Documentation links per audience.
   *
   * The last page when the project step is shown.
   *
   * Without the project step it is page 3; see ::setupStep().
   */
  private const int STEP_SETUP = 4;

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
   * Memo of ::projectWorkspace(): NULL unknown, FALSE none.
   */
  private BbWorkspaceInterface|false|null $projectWorkspace = NULL;

  public function __construct(
    protected EntityTypeManagerInterface $entityTypeManager,
    protected OnboardingDestination $destination,
    protected UserDataInterface $userData,
    protected InviteMatcher $inviteMatcher,
    protected BbWorkspaceReadScopeInterface $readScope,
    protected BbWorkspaceCreateAccess $createAccess,
    protected FirstProjectCreator $firstProject,
  ) {}

  /**
   * The first workspace the account may create its first project in, if any.
   *
   * The active-workspace service is URL-only and knows nothing on this route,
   * so the account's own workspaces are searched instead. It needs the right
   * to create groups and projects there and a team of its own.
   */
  private function projectWorkspace(): ?BbWorkspaceInterface {
    if ($this->projectWorkspace === NULL) {
      $this->projectWorkspace = FALSE;
      $account = $this->currentUser();
      $projects = $this->entityTypeManager->getAccessControlHandler('bb_project');
      if ($projects->createAccess('bb_project', $account)) {
        foreach ($this->entityTypeManager->getStorage('bb_workspace')->loadMultiple($this->readScope->workspaceIds($account)) as $workspace) {
          if ($workspace instanceof BbWorkspaceInterface
            && $this->createAccess->check('bb_group', $workspace, $account)->isAllowed()
            && $this->firstProject->teamIds($workspace, $this->currentUserEntity()) !== []) {
            $this->projectWorkspace = $workspace;
            break;
          }
        }
      }
    }
    return $this->projectWorkspace ?: NULL;
  }

  /**
   * Whether the optional project step is part of this wizard.
   */
  private function hasProjectStep(): bool {
    return $this->projectWorkspace() !== NULL;
  }

  /**
   * The documentation page's number: 4 with the project step, else 3.
   */
  private function setupStep(): int {
    return $this->hasProjectStep() ? self::STEP_SETUP : self::STEP_PROJECT;
  }

  /**
   * Whether this page number is the project step.
   */
  private function isProjectStep(int $step): bool {
    return $step === self::STEP_PROJECT && $this->hasProjectStep();
  }

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
      $container->get('bb_core.workspace_create_access'),
      $container->get('bb_core.onboarding_first_project'),
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
        'size' => 'meta',
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
    match (TRUE) {
      $step === self::STEP_IDENTITY => $this->buildIdentityFields($form, $form_state, $user),
      $step === self::STEP_ABOUT => $this->buildAboutFields($form, $user),
      $this->isProjectStep($step) => $this->buildProjectFields($form, $form_state),
      $step === $this->setupStep() => $this->buildSetupFields($form),
      default => NULL,
    };

    $form['actions'] = ['#type' => 'actions'];
    $this->buildActions($form, $form_state, $step);
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
      // Page 3 is the project step when shown and documentation when not.
      $this->advanceTo($form_state, self::STEP_PROJECT);
      return;
    }

    if ($this->isProjectStep($step)) {
      $this->submitProject($form_state, $trigger);
      return;
    }

    if ($step !== $this->setupStep()) {
      return;
    }

    if ($trigger === 'finish' || $trigger === 'set_up_later') {
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
   * Handles the project step's four actions.
   */
  private function submitProject(FormStateInterface $form_state, string $trigger): void {
    if ($trigger === 'project_yes' || $trigger === 'project_back') {
      $form_state->set('bb_onboarding_project_yes', $trigger === 'project_yes');
      $form_state->setRebuild();
      return;
    }
    if ($trigger === 'project_later') {
      $this->advanceTo($form_state, self::STEP_SETUP);
      return;
    }
    $workspace = $this->projectWorkspace();
    if ($trigger !== 'project_create' || $workspace === NULL) {
      return;
    }
    try {
      $project = $this->firstProject->create(
        $workspace,
        $this->currentUserEntity(),
        trim((string) $form_state->getValue('project_name', '')),
        trim((string) $form_state->getValue('repository_url', '')),
        trim((string) $form_state->getValue('group_name', '')),
      );
    }
    catch (\InvalidArgumentException $error) {
      // The rebuild keeps the typed values; the message shows in the fragment.
      $this->messenger()->addError($error->getMessage());
      $form_state->setRebuild();
      return;
    }
    $this->leaveWizard($form_state, 'entity.bb_project.canonical', $project->toUrl());
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
    $setup = $this->setupStep();
    if ($this->destination->isComplete($this->currentUser())) {
      return $setup;
    }
    // Page 4 without the project step, saved by the former four-step wizard
    // or while the step was still offered, resumes on the last page.
    if ($step > $setup && $step <= self::STEP_SETUP) {
      return $setup;
    }
    return ($step >= self::STEP_IDENTITY && $step <= $setup)
      ? $step
      : self::STEP_IDENTITY;
  }

  /**
   * Approved copy for the current step.
   *
   * @return array{title: string, description: string, explanation: string}
   *   Visible heading, lede and the left band's explanation.
   */
  private function copyForStep(int $step): array {
    return match (TRUE) {
      $step === self::STEP_ABOUT => [
        'title' => (string) $this->t('Tell us about yourself'),
        'description' => (string) $this->t('So we speak your language — matched to your work and your background.'),
        'explanation' => (string) $this->t('Your answers are passed as context to the AI assistants bakers.build uses, so that explanations match your background. Both fields are optional.'),
      ],
      $this->isProjectStep($step) => [
        'title' => (string) $this->t('Create your first project?'),
        'description' => (string) $this->t('Start right away, or set one up later from your overview.'),
        'explanation' => (string) $this->t('A project connects a repository to your team. Creating it now takes you straight into it; you can always add one later.'),
      ],
      $step === $this->setupStep() => [
        'title' => (string) $this->t('Get started with bakers.build'),
        'description' => (string) $this->t('Pick how you will work. Each guide opens in a new tab.'),
        'explanation' => (string) $this->t('bakers.build works from a chat connector or from an agent on your own machine. These guides cover both.'),
      ],
      default => [
        'title' => (string) $this->t('What should we call you?'),
        'description' => (string) $this->t('A name and a picture — and bakers.build feels less like software and more like your team.'),
        'explanation' => (string) $this->t('A name and a picture let your team recognize you. You can change both at any time.'),
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
      '@total' => $this->setupStep(),
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
   * Project fields after Yes; the choice itself has none.
   */
  private function buildProjectFields(array &$form, FormStateInterface $form_state): void {
    if (!$form_state->get('bb_onboarding_project_yes')) {
      return;
    }
    $form['fields']['project_name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Project name'),
      '#required' => TRUE,
      '#required_error' => $this->t('Enter a project name.'),
      '#maxlength' => 255,
    ];
    $form['fields']['repository_url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Repository URL'),
      '#required' => TRUE,
      '#required_error' => $this->t('Enter the repository URL.'),
      '#maxlength' => 2048,
    ];
    $form['fields']['group_name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Group name'),
      '#description' => $this->t('A group bundles related projects.'),
      '#required' => TRUE,
      '#required_error' => $this->t('Enter a group name.'),
      '#maxlength' => 255,
    ];
  }

  /**
   * Documentation links, one labelled group per audience.
   */
  private function buildSetupFields(array &$form): void {
    $this->attachAudience($form, 'ticket_only', (string) $this->t('Ticket only'), (string) $this->t('Work through chat, without a local machine.'), [
      (string) $this->t('Set up a connector') => '/get-started/connector',
    ]);
    $this->attachAudience($form, 'developer', (string) $this->t('Developer'), (string) $this->t('Run the agent on your own machine.'), [
      (string) $this->t('Set up a machine') => '/provision/machine',
      (string) $this->t('Set up a project') => '/get-started/connect-a-project',
    ]);
  }

  /**
   * Step actions for the current page.
   */
  private function buildActions(array &$form, FormStateInterface $form_state, int $step): void {
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

    if ($this->isProjectStep($step)) {
      $this->buildProjectActions($form, (bool) $form_state->get('bb_onboarding_project_yes'));
      return;
    }

    if ($step !== $this->setupStep() || !$complete) {
      $form['actions']['back'] = $this->ghostSubmit($this->t('Back'), 'back');
    }

    if ($step === self::STEP_ABOUT) {
      $form['actions']['next'] = $this->primarySubmit($this->t('Next'), 'next');
      return;
    }

    if ($step === $this->setupStep()) {
      $form['actions']['finish'] = $this->primarySubmit($this->t('Finish'), 'finish');
      if ($this->mayCreateWorkspaceOnFinish()) {
        $form['actions']['finish_create'] = [
          '#type' => 'submit',
          '#value' => $this->t('Finish & create a new workspace'),
          '#name' => 'finish_create',
          '#theme_wrappers' => ['input__submit__bb_button'],
        ];
      }
      $form['actions']['set_up_later'] = $this->ghostSubmit($this->t('Set up later'), 'set_up_later');
    }
  }

  /**
   * Yes and Later, or after Yes the fields' own Back and Create project.
   */
  private function buildProjectActions(array &$form, bool $yes): void {
    if ($yes) {
      $form['actions']['project_back'] = $this->ghostSubmit($this->t('Back'), 'project_back');
      $form['actions']['project_create'] = $this->primarySubmit($this->t('Create project'), 'project_create');
      return;
    }
    $form['actions']['back'] = $this->ghostSubmit($this->t('Back'), 'back');
    $form['actions']['project_later'] = $this->ghostSubmit($this->t('Later'), 'project_later');
    $form['actions']['project_yes'] = $this->primarySubmit($this->t('Yes'), 'project_yes');
    // Yes has no fields to check; Back and Later above skip validation too.
    $form['actions']['project_yes']['#limit_validation_errors'] = [];
    $form['actions']['project_yes']['#submit'] = ['::submitForm'];
  }

  /**
   * Moves one page back without writing unsent field values.
   */
  private function goBack(FormStateInterface $form_state, int $step): void {
    $previous = match (TRUE) {
      $step === self::STEP_ABOUT => self::STEP_IDENTITY,
      $this->isProjectStep($step) => self::STEP_ABOUT,
      $step === $this->setupStep() => $this->hasProjectStep() ? self::STEP_PROJECT : self::STEP_ABOUT,
      default => self::STEP_IDENTITY,
    };
    $this->advanceTo($form_state, $this->boundStep($previous));
  }

  /**
   * Records a successful step transition in Form API state and user.data.
   */
  private function advanceTo(FormStateInterface $form_state, int $step): void {
    $form_state->set('bb_onboarding_step', $step);
    $form_state->set('bb_onboarding_project_yes', FALSE);
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
  private function leaveWizard(FormStateInterface $form_state, string $route, ?Url $target = NULL): void {
    $this->destination->markComplete($this->currentUser());
    $this->userData->delete(
      self::USER_DATA_PROVIDER,
      (int) $this->currentUser()->id(),
      self::USER_DATA_KEY,
    );
    $form_state->setIgnoreDestination();
    if (!$this->isHtmxRequest()) {
      $target === NULL ? $form_state->setRedirect($route) : $form_state->setRedirectUrl($target);
      return;
    }
    $response = new CacheableResponse('');
    $response->getCacheableMetadata()->setCacheMaxAge(0);
    $htmx = new Htmx();
    $url = $target ?? Url::fromRoute($route);
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
   * A short instruction line.
   */
  private function plainText(string $text): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => [
        'text' => $text,
        'size' => 'meta',
        'tone' => 'light',
      ],
    ];
  }

  /**
   * One audience: a caption, then its labelled documentation links.
   *
   * The links open in a new tab, separately from the unfinished wizard.
   *
   * @param array<string, mixed> $form
   *   The form being built.
   * @param string $key
   *   Render key of the audience's link group.
   * @param string $label
   *   Audience name, the group's label.
   * @param string $caption
   *   Who the audience is.
   * @param array<string, string> $links
   *   Label to path pairs under the published manual origin.
   */
  private function attachAudience(array &$form, string $key, string $label, string $caption, array $links): void {
    $rows = [];
    foreach ($links as $title => $path) {
      $rows[] = [
        'url' => self::DOCS_BASE . $path,
        'title' => $title,
        'kind' => 'doc',
      ];
    }
    $form['fields'][$key . '_caption'] = $this->plainText($caption);
    $form['fields'][$key] = [
      '#type' => 'component',
      '#component' => 'bb_theme:link-group',
      '#props' => [
        'label' => $label,
        'links' => $rows,
      ],
    ];
  }

}
