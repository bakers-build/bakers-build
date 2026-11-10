<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Onboarding\FirstProjectCreator;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The first project, asked on a page of its own right after a workspace.
 *
 * Create makes a group and a project on the account's teams of the workspace
 * and lands on the project; Skip leaves for the overview and creates nothing.
 * The route's workspace-scoped create check decides who sees the page.
 */
final class BbFirstProjectForm extends FormBase {

  public function __construct(
    protected EntityTypeManagerInterface $entityTypeManager,
    protected FirstProjectCreator $firstProject,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('entity_type.manager'),
      $container->get('bb_core.onboarding_first_project'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_first_project_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    // A full document POST: the submit ends on a project page, which the
    // application shell must replace the gate document for.
    $form['#attributes']['data-hx-boost'] = 'false';
    // Inside the form: the page's messages block stands outside the gate.
    $form['messages'] = ['#type' => 'status_messages', '#weight' => -20];
    $form['project_name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Project name'),
      '#required' => TRUE,
      '#required_error' => $this->t('Enter a project name.'),
      '#maxlength' => 255,
    ];
    $form['repository_url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Repository URL'),
      '#required' => TRUE,
      '#required_error' => $this->t('Enter the repository URL.'),
      '#maxlength' => 2048,
    ];
    $form['group_name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Group name'),
      '#description' => $this->t('A group bundles related projects.'),
      '#required' => TRUE,
      '#required_error' => $this->t('Enter a group name.'),
      '#maxlength' => 255,
    ];
    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Create project'),
      '#name' => 'create_project',
      '#button_type' => 'primary',
      '#weight' => 0,
      '#theme_wrappers' => ['input__submit__bb_button'],
    ];
    // Skip checks and writes nothing.
    $form['actions']['skip'] = [
      '#type' => 'submit',
      '#value' => $this->t('Skip'),
      '#name' => 'skip_project',
      '#limit_validation_errors' => [],
      '#submit' => ['::skip'],
      '#bb_variant' => 'ghost',
      '#weight' => 10,
      '#theme_wrappers' => ['input__submit__bb_button'],
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $workspace = $this->getRouteMatch()->getParameter('bb_workspace');
    $account = $this->entityTypeManager->getStorage('user')->load($this->currentUser()->id());
    if (!$workspace instanceof BbWorkspaceInterface || !$account instanceof UserInterface) {
      throw new \RuntimeException('The first project needs a workspace and an account.');
    }
    try {
      $project = $this->firstProject->create(
        $workspace,
        $account,
        trim((string) $form_state->getValue('project_name', '')),
        trim((string) $form_state->getValue('repository_url', '')),
        trim((string) $form_state->getValue('group_name', '')),
      );
    }
    catch (\InvalidArgumentException $error) {
      // Nothing was saved; the typed values stay and the message says why.
      $this->messenger()->addError($error->getMessage());
      $form_state->setRebuild();
      return;
    }
    $form_state->setRedirectUrl($project->toUrl());
  }

  /**
   * Leaves for the overview without creating a project.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function skip(array &$form, FormStateInterface $form_state): void {
    $form_state->setRedirect('bb_core.home');
  }

}
