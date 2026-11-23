<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Component\Utility\UrlHelper;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Url;
use Drupal\bb_core\Controller\UserProfileController;
use Drupal\bb_core\Entity\BbProfileInterface;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Edits a profile's position and background in its workspace.
 *
 * The form of `bb_profile`, shown on the user's Profile tab, so a workspace
 * lead editing a service account never reaches name, mail or password.
 */
final class UserProfileForm extends ContentEntityForm {

  /**
   * Resolves the profile the Profile tab edits.
   */
  protected UserProfileController $page;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->page = $container->get('class_resolver')->getInstanceFromDefinition(UserProfileController::class);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getEntityFromRouteMatch(RouteMatchInterface $route_match, $entity_type_id): EntityInterface {
    $user = $route_match->getParameter('user');
    if (!$user instanceof UserInterface) {
      return parent::getEntityFromRouteMatch($route_match, $entity_type_id);
    }
    return $this->page->profileFor($user);
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @return array<string, mixed>
   *   The profile fields, or an empty state without any workspace.
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = $this->hasWorkspace() ? parent::form($form, $form_state) : [
      'empty' => [
        '#type' => 'component',
        '#component' => 'bb_theme:empty-state',
        '#props' => [
          'message' => (string) $this->t('You are in no workspace yet. Join a workspace to fill in your profile.'),
          'icon' => 'user',
        ],
      ],
    ];
    (new CacheableMetadata())->addCacheContexts(['url.query_args:workspace', 'user'])
      ->addCacheTags(['og_membership_list', 'bb_profile_list'])
      ->applyTo($form);
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @return array<string, mixed>
   *   The buttons; none without a workspace.
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    return $this->hasWorkspace() ? parent::actions($form, $form_state) : [];
  }

  /**
   * Whether the profile belongs to a workspace.
   */
  private function hasWorkspace(): bool {
    return $this->entity instanceof BbProfileInterface && $this->entity->workspaceId() !== 0;
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $result = parent::save($form, $form_state);
    $this->messenger()->addStatus($this->t('Profile saved.'));
    TicketNavigation::finishAt($this->returnUrl(), $form_state, $this->getRequest());
    return $result;
  }

  /**
   * The local `destination`, else this profile page.
   */
  private function returnUrl(): Url {
    $destination = $this->getRequest()->query->get('destination');
    if (is_string($destination) && str_starts_with($destination, '/') && !UrlHelper::isExternal($destination)) {
      return Url::fromUserInput($destination);
    }
    $profile = $this->entity;
    assert($profile instanceof BbProfileInterface);
    $workspace = $profile->get('workspace_id')->entity;
    return Url::fromRoute('bb_core.user.profile', ['user' => $profile->getOwnerId()], [
      'query' => $workspace === NULL ? [] : ['workspace' => $workspace->uuid()],
    ]);
  }

}
