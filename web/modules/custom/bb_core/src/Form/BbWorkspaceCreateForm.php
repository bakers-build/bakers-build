<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\Entity\EntityFormDisplay;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Entity\EntityTypeBundleInfoInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Workspace\WorkspaceProvisioner;
use Drupal\bb_core\Workspace\WorkspaceSlugDeriver;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The bb_workspace entity's own form, asking the settings fields.
 *
 * Renders the shared `settings` form display (`name`, `description`,
 * `image`); the slug is derived, and `::save()` hands the values to
 * `WorkspaceProvisioner` instead of saving the entity. `create bb_workspace`
 * is granted to nobody, so the route guards on `_user_is_logged_in` only.
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
    // Nothing else on the entity is asked about, so nothing else needs a
    // presenter position — nulling `#group`/`#weight` scaffolding a display
    // that shipped no `core.entity_form_display` config might otherwise add.
    unset($form['langcode']);

    // The page's one h1: the gate chrome carries the mark, not a heading.
    $form['heading'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => [
        'text' => $this->t('Create a workspace'),
        'as' => 'h1',
        'size' => 'section-title',
        'align' => 'center',
      ],
      '#weight' => -20,
    ];

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    $actions['submit']['#value'] = $this->t('Create workspace');
    $actions['submit']['#theme_wrappers'] = ['input__submit__bb_button'];
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
    $workspace = $this->provisioner->provision($entity->getName(), $account, [
      'description' => $entity->get('description')->getValue(),
      'image' => $entity->get('image')->getValue(),
    ]);
    // The form's own entity now stands for the SAVED one, so a caller reading
    // `$this->getEntity()` after submission sees the real, persisted row
    // rather than the discarded draft `buildEntity()` produced.
    $this->entity = $workspace;

    // Completed accounts creating a workspace stay on the overview. Incomplete
    // accounts never reach this form: the entry guard sends them to the wizard
    // first.
    $form_state->setRedirect('bb_core.home');

    return SAVED_NEW;
  }

}
