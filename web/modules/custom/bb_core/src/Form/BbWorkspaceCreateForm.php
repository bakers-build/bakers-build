<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\Entity\EntityFormDisplay;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Entity\EntityTypeBundleInfoInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Onboarding\FirstProjectCreator;
use Drupal\bb_core\Workspace\WorkspaceProvisioner;
use Drupal\bb_core\Workspace\WorkspaceSlugDeriver;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The bb_workspace entity's own form, asking the settings fields.
 *
 * Renders the shared `settings` form display (`name`, `description`,
 * `image`) plus a required first-team name; the slug is derived, and
 * `::save()` hands the values to `WorkspaceProvisioner` instead of saving
 * the entity. `create bb_workspace` is granted to nobody, so the route
 * guards on `_user_is_logged_in` only.
 *.
 */
final class BbWorkspaceCreateForm extends ContentEntityForm {

  /**
   * Constructs the create form.
   *
   * @param \Drupal\Core\Entity\EntityRepositoryInterface $entityRepository
   *   Required by `ContentEntityForm`.
   * @param \Drupal\Core\Entity\EntityTypeBundleInfoInterface $entityTypeBundleInfo
   *   Required by `ContentEntityForm`.
   * @param \Drupal\Component\Datetime\TimeInterface $time
   *   Required by `ContentEntityForm`.
   * @param \Drupal\bb_core\Workspace\WorkspaceProvisioner $provisioner
   *   Creates workspace, team and both memberships in one transaction.
   * @param \Drupal\bb_core\Workspace\WorkspaceSlugDeriver $slugDeriver
   *   Derives the slug for ::buildEntity()'s validation pass; the same
   *   stateless class the provisioner uses for the actual save.
   * @param \Drupal\Core\Database\Connection $database
   *   Carries the one transaction around the workspace and its first project.
   * @param \Drupal\bb_core\Onboarding\FirstProjectCreator $firstProject
   *   Creates the optional first group and project.
   */
  public function __construct(
    EntityRepositoryInterface $entityRepository,
    EntityTypeBundleInfoInterface $entityTypeBundleInfo,
    TimeInterface $time,
    // Protected and not readonly: an image upload caches this form, and
    // DependencySerializationTrait serializes and restores only the service
    // properties visible to its own scope.
    protected WorkspaceProvisioner $provisioner,
    protected WorkspaceSlugDeriver $slugDeriver,
    protected Connection $database,
    protected FirstProjectCreator $firstProject,
  ) {
    parent::__construct($entityRepository, $entityTypeBundleInfo, $time);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $entityTypeManager = $container->get('entity_type.manager');
    $instance = new static(
      $container->get('entity.repository'),
      $container->get('entity_type.bundle.info'),
      $container->get('datetime.time'),
      $container->get('bb_core.workspace_provisioner'),
      $container->get('bb_core.workspace_slug_deriver'),
      $container->get('database'),
      $container->get('bb_core.onboarding_first_project'),
    );
    // A PLAIN `_form` ROUTE, NOT `_entity_form`: nothing else wires the
    // services `EntityForm` needs or hands this form an entity to work on, so
    // both are done here — the same two calls the entity form builder would
    // otherwise have made.
    $instance->setModuleHandler($container->get('module_handler'));
    $instance->setEntityTypeManager($entityTypeManager);
    $instance->setStringTranslation($container->get('string_translation'));
    $instance->setEntity($entityTypeManager->getStorage('bb_workspace')->create([]));
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_workspace_create_form';
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    // The shared settings display carries `name`, `description` and `image`,
    // so neither the widget loop nor `copyFormValuesToEntity()` reaches any
    // other field.
    assert($this->entity instanceof BbWorkspaceInterface);
    $this->setFormDisplay(
      EntityFormDisplay::collectRenderDisplay($this->entity, 'settings'),
      $form_state,
    );

    $form = parent::form($form, $form_state);

    // A full document POST, never a boosted fragment: the submit ends in a
    // workspace, so the application shell must replace the gate document.
    $form['#attributes']['data-hx-boost'] = 'false';

    if (isset($form['name']['widget'][0]['value'])) {
      $widget = &$form['name']['widget'][0]['value'];
      $widget['#title'] = $this->t('Workspace name');
      $widget['#description'] = $this->t("Your workspace's address is derived from this.");
      $widget['#attributes']['autocomplete'] = 'organization';
      // THE NAME IS NOT VALIDATED FOR URL SAFETY, and that is the point of
      // deriving the slug: every string a customer can type is an acceptable
      // name. Only an empty one is refused, and this replaces the `#required`
      // violation core's own textfield widget would otherwise report.
      $widget['#required_error'] = $this->t('Please enter a name for the workspace.');
      unset($widget);
    }
    // THE FIRST TEAM IS NAMED HERE, not silently: the first project is created
    // for it, so the customer picks its name at sign-up.
    $form['team_name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Team name'),
      '#description' => $this->t('Your first team in this workspace.'),
      '#required' => TRUE,
      '#required_error' => $this->t('Enter a team name.'),
      '#maxlength' => 255,
    ];
    // THE FIRST PROJECT IS ASKED HERE because a new account has no workspace
    // while it is in the onboarding wizard, so this is where it can be asked.
    // Its fields are always shown; Skip creates the workspace without it.
    $form['project_name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Project name'),
      '#description' => $this->t('Your first project. Skip it to add one later.'),
      '#maxlength' => 255,
      '#weight' => 50,
    ];
    $form['repository_url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Repository URL'),
      '#maxlength' => 2048,
      '#weight' => 51,
    ];
    $form['group_name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Group name'),
      '#description' => $this->t('A group bundles related projects.'),
      '#maxlength' => 255,
      '#weight' => 52,
    ];
    // Nothing else on the entity is asked about, so nothing else needs a
    // presenter position — nulling `#group`/`#weight` scaffolding a display
    // that shipped no `core.entity_form_display` config might otherwise add.
    unset($form['langcode']);

    // INSIDE THE FORM: the page's messages block stands outside the gate, so
    // an error about the project is printed here, beside the fields. The
    // page's one h1 is the gate's own title, set by the presenter.
    $form['messages'] = ['#type' => 'status_messages', '#weight' => -20];

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    $actions['submit']['#value'] = $this->t('Create workspace');
    $actions['submit']['#theme_wrappers'] = ['input__submit__bb_button'];
    // Skip makes the workspace alone: the same handlers, and the project fields
    // are not asked for.
    $actions['skip'] = [
      '#value' => $this->t('Skip'),
      '#name' => 'skip_project',
      '#bb_variant' => 'ghost',
      '#weight' => 10,
    ] + $actions['submit'];
    unset($actions['delete']);
    return $actions;
  }

  /**
   * {@inheritdoc}
   */
  public function buildEntity(array $form, FormStateInterface $form_state): ContentEntityInterface {
    $entity = parent::buildEntity($form, $form_state);
    assert($entity instanceof BbWorkspaceInterface);
    // The same deriver the provisioner uses, so the validated slug matches
    // the saved one except possibly in a uniqueness suffix.
    $entity->setSlug($this->slugDeriver->derive($entity->getName()));
    if ($entity->get('owner_user_id')->isEmpty()) {
      $entity->set('owner_user_id', $this->currentUser()->id());
    }
    return $entity;
  }

  /**
   * Whether the Skip button made this submission.
   */
  private function skipsProject(FormStateInterface $form_state): bool {
    return ($form_state->getTriggeringElement()['#name'] ?? '') === 'skip_project';
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): ContentEntityInterface {
    $entity = parent::validateForm($form, $form_state);
    if ($this->skipsProject($form_state)) {
      return $entity;
    }
    $messages = [
      'project_name' => $this->t('Enter a project name.'),
      'repository_url' => $this->t('Enter the repository URL.'),
      'group_name' => $this->t('Enter a group name.'),
    ];
    foreach ($messages as $field => $message) {
      if (trim((string) $form_state->getValue($field, '')) === '') {
        $form_state->setErrorByName($field, $message);
      }
    }
    return $entity;
  }

  /**
   * {@inheritdoc}
   *
   * Not `parent::save()`: a bare save would create the workspace without its
   * team and memberships. `WorkspaceProvisioner::provision()` runs that
   * transaction; the entity `buildEntity()` produced is left unsaved.
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $account = $this->entityTypeManager->getStorage('user')->load($this->currentUser()->id());
    if (!$account instanceof UserInterface) {
      throw new \RuntimeException('The acting session has no loadable account.');
    }

    /** @var \Drupal\bb_core\Entity\BbWorkspaceInterface $entity */
    $entity = $this->entity;

    // THE PROVISIONER THROWS RATHER THAN RETURNING NULL, so there is no branch
    // here that could redirect a customer into a workspace that does not exist.
    // An unexpected failure becomes a 500 with the rollback already done, which
    // is honest; a caught throwable rendered as "something went wrong" beside a
    // half-provisioned workspace would not be.
    // ONE TRANSACTION AROUND BOTH: the provisioner's own is nested in it, so a
    // first project that fails validation takes the workspace back with it.
    $transaction = $this->database->startTransaction();
    $project = NULL;
    try {
      $workspace = $this->provisioner->provision($entity->getName(), $account, trim((string) $form_state->getValue('team_name')), [
        'description' => $entity->get('description')->getValue(),
        'image' => $entity->get('image')->getValue(),
      ]);
      if (!$this->skipsProject($form_state)) {
        $project = $this->firstProject->create(
          $workspace,
          $account,
          trim((string) $form_state->getValue('project_name', '')),
          trim((string) $form_state->getValue('repository_url', '')),
          trim((string) $form_state->getValue('group_name', '')),
        );
      }
    }
    catch (\Throwable $error) {
      $transaction->rollBack();
      if (!$error instanceof \InvalidArgumentException) {
        throw $error;
      }
      // Nothing was saved; the typed values stay and the message says why.
      $this->messenger()->addError($error->getMessage());
      $form_state->setRebuild();
      return SAVED_NEW;
    }
    // The form's own entity now stands for the SAVED one, so a caller reading
    // `$this->getEntity()` after submission sees the real, persisted row
    // rather than the discarded draft `buildEntity()` produced.
    $this->entity = $workspace;

    // Completed accounts creating a workspace stay on the overview. Incomplete
    // accounts never reach this form: the entry guard sends them to the wizard
    // first.
    if ($project instanceof BbProjectInterface) {
      $form_state->setRedirectUrl($project->toUrl());
      return SAVED_NEW;
    }
    $form_state->setRedirect('bb_core.home');

    return SAVED_NEW;
  }

}
