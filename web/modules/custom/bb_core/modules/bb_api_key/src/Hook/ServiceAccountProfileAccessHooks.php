<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Hook;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityFormInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_api_key\Access\ServiceAccountAccess;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbProfileInterface;
use Drupal\user\UserInterface;

/**
 * Lets a workspace lead edit the profile of its active service accounts.
 *
 * The profile only in the service account's own workspace. The profile is
 * the account's page: it offers Manage API keys and Disable.
 */
final class ServiceAccountProfileAccessHooks {

  public function __construct(
    private readonly ServiceAccountManager $serviceAccountManager,
    private readonly ServiceAccountAccess $serviceAccountAccess,
  ) {}

  /**
   * Implements hook_ENTITY_TYPE_access() for user.
   *
   * Grants only `edit profile`; neutral for humans, disabled accounts and
   * every other operation.
   */
  #[Hook('user_access')]
  public function userAccess(UserInterface $user, string $operation, AccountInterface $account): AccessResultInterface {
    if ($operation !== 'edit profile') {
      return AccessResult::neutral();
    }
    $workspace = $this->serviceAccountManager->workspace($user);
    if ($workspace === NULL || !$user->isActive()) {
      return AccessResult::neutral()->addCacheableDependency($user);
    }
    $allowed = $this->serviceAccountAccess->manage($workspace, $account, $user);
    return $allowed->isAllowed() ? $allowed : AccessResult::neutral()->addCacheableDependency($allowed);
  }

  /**
   * Implements hook_ENTITY_TYPE_access() for bb_profile.
   *
   * Extends the `edit profile` grant to the service account's profile in its
   * own workspace, for view and update only.
   */
  #[Hook('bb_profile_access')]
  public function profileAccess(BbProfileInterface $profile, string $operation, AccountInterface $account): AccessResultInterface {
    $owner = $profile->getOwner();
    if (!in_array($operation, ['view', 'update'], TRUE) || !$owner instanceof UserInterface) {
      return AccessResult::neutral();
    }
    $workspace = $this->serviceAccountManager->workspace($owner);
    if ($workspace === NULL || (int) $workspace->id() !== $profile->workspaceId()) {
      return AccessResult::neutral()->addCacheableDependency($profile);
    }
    $allowed = $this->userAccess($owner, 'edit profile', $account);
    return AccessResult::allowedIf($allowed->isAllowed())->addCacheableDependency($allowed)->addCacheableDependency($profile);
  }

  /**
   * Implements hook_form_FORM_ID_alter() for the profile form.
   *
   * Adds Manage API keys and Disable to a service account's profile, each
   * where its route grants it.
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  #[Hook('form_bb_profile_form_alter')]
  public function profileFormAlter(array &$form, FormStateInterface $form_state): void {
    $form_object = $form_state->getFormObject();
    $profile = $form_object instanceof EntityFormInterface ? $form_object->getEntity() : NULL;
    $owner = $profile instanceof BbProfileInterface ? $profile->getOwner() : NULL;
    $workspace = $owner instanceof UserInterface && $owner->isActive() ? $this->serviceAccountManager->workspace($owner) : NULL;
    if ($workspace === NULL || !isset($form['actions'])) {
      return;
    }
    $disable = Url::fromRoute('bb_api_key.service_account.disable', [
      'bb_workspace' => $workspace->getSlug(),
      'user' => $owner->id(),
    ]);
    $links = [
      'api_keys' => [
        (string) new TranslatableMarkup('Manage API keys'),
        Url::fromRoute('view.bb_api_keys.page', ['user' => $owner->id()]),
        'neutral',
      ],
      'disable' => [(string) new TranslatableMarkup('Disable'), $disable, 'danger'],
    ];
    foreach ($links as $key => [$label, $url, $variant]) {
      // The route's own access, with its cacheability, decides the button.
      $access = $url->access(NULL, TRUE);
      $form['actions'][$key] = ['#access' => $access] + ($access->isAllowed() ? [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => ['label' => $label, 'href' => $url->toString(), 'variant' => $variant],
        '#weight' => 50,
      ] : []);
    }
  }

}
