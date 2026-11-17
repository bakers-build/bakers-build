<?php

declare(strict_types=1);

namespace Drupal\bb_core\Controller;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\DependencyInjection\AutowireTrait;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbProfileInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Navigation\AccountWorkspaceContext;
use Drupal\bb_core\Profile\Profiles;
use Drupal\og\MembershipManagerInterface;
use Drupal\user\UserInterface;

/**
 * The Profile tab: a user's profile in the workspace in context.
 *
 * A service account's own workspace; else, on the own account, the validated
 * `?workspace=` origin; else the user's first workspace by label.
 */
final class UserProfileController extends ControllerBase {

  use AutowireTrait;

  public function __construct(
    private readonly Profiles $profiles,
    private readonly AccountWorkspaceContext $workspaceContext,
    private readonly MembershipManagerInterface $membershipManager,
  ) {}

  /**
   * The profile form, or an empty state without any workspace.
   *
   * @return array<string, mixed>
   *   A render array.
   */
  public function edit(UserInterface $user): array {
    $profile = $this->profileFor($user);
    $build = $profile === NULL
      ? [
        '#type' => 'component',
        '#component' => 'bb_theme:empty-state',
        '#props' => ['message' => (string) $this->t('You are in no workspace yet. Join a workspace to fill in your profile.'), 'icon' => 'user'],
      ]
      : $this->entityFormBuilder()->getForm($profile, 'default');
    (new CacheableMetadata())->addCacheContexts(['url.query_args:workspace', 'user'])
      ->addCacheTags(['og_membership_list', 'bb_profile_list'])
      ->applyTo($build);
    return $build;
  }

  /**
   * The page title, naming the workspace.
   */
  public function title(UserInterface $user): TranslatableMarkup {
    $workspace = $this->workspaceFor($user);
    return $workspace === NULL
      ? $this->t('Profile')
      : $this->t('Profile in @workspace', ['@workspace' => $workspace->label()]);
  }

  /**
   * The profile the page edits, unsaved when new; NULL without a workspace.
   */
  public function profileFor(UserInterface $user): ?BbProfileInterface {
    $workspace = $this->workspaceFor($user);
    return $workspace === NULL ? NULL : $this->profiles->forAccount((int) $user->id(), (int) $workspace->id());
  }

  /**
   * The workspace whose profile the page edits.
   */
  private function workspaceFor(UserInterface $user): ?BbWorkspaceInterface {
    $storage = $this->entityTypeManager()->getStorage('bb_workspace');
    if ($user->hasField('bb_service_workspace') && !$user->get('bb_service_workspace')->isEmpty()) {
      $workspace = $storage->load($user->get('bb_service_workspace')->target_id);
      return $workspace instanceof BbWorkspaceInterface ? $workspace : NULL;
    }
    if ($this->workspaceContext->isOwnProfile()) {
      $workspace = $this->workspaceContext->resolve(new CacheableMetadata());
      if ($workspace !== NULL) {
        return $workspace;
      }
    }
    $ids = $this->membershipManager->getUserGroupIds((int) $user->id())['bb_workspace'] ?? [];
    $workspaces = $storage->loadMultiple($ids);
    uasort($workspaces, static fn ($a, $b): int => strnatcasecmp((string) $a->label(), (string) $b->label()));
    $first = reset($workspaces);
    return $first instanceof BbWorkspaceInterface ? $first : NULL;
  }

}
