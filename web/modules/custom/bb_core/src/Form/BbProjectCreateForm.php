<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Project creation defaults and labels for the shared create dialog.
 */
final class BbProjectCreateForm extends BbCreateDialogFormBase {

  /**
   * The form mode whose display owns the five fields and their widgets.
   */
  private const FORM_MODE = 'settings';

  /**
   * Stable form ID used by the dialog trigger and Drupal's HTMX form handling.
   */
  public const string FORM_ID = 'bb_project_create_form';

  /**
   * Initializes the subject for both routed and direct form construction.
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->prepareSubject($container, 'bb_project', self::FORM_MODE);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return self::FORM_ID;
  }

  /**
   * {@inheritdoc}
   *
   * Forced to `settings` regardless of the routed `create` operation — see
   * `BbCreateDialogFormBase::formDisplayMode()`.
   * `entity.bb_project.create_form` still declares
   * `_entity_form: 'bb_project.create'`, which is what
   * selects THIS class via `handlers.form.create`; the display it should
   * render is `bb_project.bb_project.settings`, the same one
   * the project Settings screen renders.
   */
  protected function formDisplayMode(): string {
    return self::FORM_MODE;
  }

  /**
   * {@inheritdoc}
   *
   * THE DIALOG SHOWS FEWER FIELDS THAN THE DISPLAY CARRIES, and it hides them
   * here rather than through a second form mode. The Settings tab and this
   * dialog render the SAME display (see formDisplayMode()), and the divergence
   * is a property of this surface: the `project-create` scene asks for a name,
   * a repository URL and its default branch, so the branch convention and
   * project environment variables — which belong on Settings — are hidden
   * rather than duplicated into a second display that would then have to be
   * kept from drifting. `default_branch` stays visible: a repository is
   * rarely useful without naming the branch runs base work on and merge
   * requests target, and the field is optional and falls back to `main`.
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    $form['env_vars']['#access'] = FALSE;
    $form['repository']['widget'][0]['branch_convention']['#access'] = FALSE;
    return $form;
  }

  /**
   * Re-applies dependent defaults after widgets have supplied their values.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity being built from the submitted values.
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  protected function copyFormValuesToEntity(EntityInterface $entity, array $form, FormStateInterface $form_state): void {
    parent::copyFormValuesToEntity($entity, $form, $form_state);
    assert($entity instanceof ContentEntityInterface);
    $entity->get('key')->applyDefaultValue();
  }

  /**
   * {@inheritdoc}
   */
  protected function actionLabels(): array {
    return [
      'submit' => $this->t('Create project'),
      'cancel' => $this->t('Cancel'),
    ];
  }

}
