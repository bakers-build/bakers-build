<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Url;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbProfileInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Profile\Profiles;
use Drupal\island\IslandResponder;
use Drupal\island\IslandResponse;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Marks or unmarks a project as the current account's favorite.
 *
 * Its own route, so its POST is main content there. The submit announces
 * what happened; the placements that subscribe to the event come along in
 * the same answer. Without JavaScript it lands back on the project.
 */
final class ProjectFavoriteForm extends FormBase {

  /**
   * The island event a toggle dispatches.
   */
  public const CHANGED_EVENT = 'bakers.favorites.changed';

  /**
   * The id of the wrapper the form is rendered in and swapped by.
   */
  public const WRAPPER_ID = 'bb-project-favorite';

  public function __construct(
    private readonly Profiles $profiles,
    private readonly WorkspaceResolverInterface $workspaceResolver,
    private readonly IslandResponder $islandResponder,
    private readonly FormBuilderInterface $builder,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get(Profiles::class),
      $container->get('bb_core.workspace_resolver'),
      $container->get('island.responder'),
      $container->get('form_builder'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_project_favorite_form';
  }

  /**
   * The form in the wrapper its answer replaces.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  public static function wrapped(array $form): array {
    return ['#type' => 'container', '#attributes' => ['id' => self::WRAPPER_ID], 'form' => $form];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?BbProjectInterface $bb_project = NULL): array {
    $workspace = $bb_project === NULL ? NULL : $this->workspaceResolver->resolve($bb_project);
    if ($workspace === NULL) {
      return $form;
    }
    $form_state->set('project', $bb_project);
    $favorite = in_array((int) $bb_project->id(), $this->profile($bb_project)->favoriteProjectIds(), TRUE);
    $url = Url::fromRoute('bb_core.project.favorite', [
      'bb_workspace' => $workspace->getSlug(),
      'bb_project' => $bb_project->id(),
    ]);
    $form['#action'] = $url->toString();
    $form['#cache'] = ['contexts' => ['user'], 'tags' => ['bb_profile_list']];
    // Explicit target and select: an ancestor's boost declaration must not
    // be inherited by this POST.
    (new Htmx())->post($url)->target('#' . self::WRAPPER_ID)->select('#' . self::WRAPPER_ID)->swap('outerHTML')->applyTo($form);
    $form['toggle'] = [
      '#type' => 'submit',
      '#value' => $favorite ? $this->t('Remove from favorites') : $this->t('Add to favorites'),
      '#theme_wrappers' => ['input__submit__bb_button'],
      '#bb_variant' => 'ghost',
      '#bb_icon' => 'star',
      '#bb_icon_only' => TRUE,
      '#bb_pressed' => $favorite,
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $project = $form_state->get('project');
    assert($project instanceof BbProjectInterface);
    $profile = $this->profile($project, TRUE)->toggleFavorite((int) $project->id());
    $profile->save();
    $request = $this->getRequest();
    if (!$request->headers->has('HX-Request')) {
      $this->messenger()->addStatus(in_array((int) $project->id(), $profile->favoriteProjectIds(), TRUE)
        ? $this->t('Added to favorites.')
        : $this->t('Removed from favorites.'));
      $form_state->setRedirectUrl($project->toUrl());
      return;
    }
    // The form as it reads now must not consume this submission again.
    $request->request->replace([]);
    $form_state->setResponse($this->islandResponder->toFormResponse(
      IslandResponse::make()->dispatch(self::CHANGED_EVENT),
      $request,
      self::WRAPPER_ID,
      $this->builder->getForm(self::class, $project),
    ));
  }

  /**
   * The account's profile in the project's workspace.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  private function profile(BbProjectInterface $project, bool $editing = FALSE): BbProfileInterface {
    $workspace_id = (int) $this->workspaceResolver->resolve($project)?->id();
    $uid = (int) $this->currentUser()->id();
    return $editing ? $this->profiles->forEditing($uid, $workspace_id) : $this->profiles->forAccount($uid, $workspace_id);
  }

}
