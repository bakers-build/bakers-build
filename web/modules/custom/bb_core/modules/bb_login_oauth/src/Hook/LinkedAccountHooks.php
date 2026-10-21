<?php

declare(strict_types=1);

namespace Drupal\bb_login_oauth\Hook;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Entity\EntityFormInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\bb_login_oauth\BbGoogleAuthManager;
use Drupal\bb_login_oauth\IdentityLink;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Keeps a provider-linked account's mail read-only and swaps the auth manager.
 */
final class LinkedAccountHooks {

  use StringTranslationTrait;

  public function __construct(
    #[Autowire(service: 'bb_login_oauth.identity_link')]
    private readonly IdentityLink $identityLink,
  ) {}

  /**
   * Implements hook_entity_field_access().
   *
   * Locks `user.mail` for edit once the account holds a social_auth link; the
   * address is sourced from the provider. `view` stays untouched.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  #[Hook('entity_field_access')]
  public function entityFieldAccess(string $operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL): AccessResult {
    if ($operation !== 'edit'
      || $field_definition->getTargetEntityTypeId() !== 'user'
      || $field_definition->getName() !== 'mail'
      || $items === NULL) {
      return AccessResult::neutral();
    }

    $entity = $items->getEntity();
    if (!$entity instanceof EntityInterface || $entity->isNew()) {
      return AccessResult::neutral();
    }

    $result = $this->identityLink->isLinked((int) $entity->id())
      ? AccessResult::forbidden('Mail is sourced from the linked OAuth provider.')
      : AccessResult::neutral();

    return $result
      ->addCacheableDependency($entity)
      ->addCacheTags(['social_auth_list']);
  }

  /**
   * Implements hook_form_FORM_ID_alter() for user_form.
   *
   * `AccountForm` builds `mail` by hand and sets `#access` from the field
   * access above, which would remove the field; keep it visible but disabled.
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  #[Hook('form_user_form_alter')]
  public function formUserFormAlter(array &$form, FormStateInterface $form_state): void {
    $form_object = $form_state->getFormObject();
    if (!$form_object instanceof EntityFormInterface) {
      return;
    }
    $account = $form_object->getEntity();
    if (!$account instanceof UserInterface || $account->isNew() || !isset($form['account']['mail'])) {
      return;
    }
    if (!$this->identityLink->isLinked((int) $account->id())) {
      return;
    }

    $form['account']['mail']['#access'] = TRUE;
    $form['account']['mail']['#disabled'] = TRUE;
    $form['account']['mail']['#description'] = ($form['account']['mail']['#description'] ?? '')
      . ' ' . $this->t('This address comes from the linked google account and cannot be changed here.');
  }

  /**
   * Implements hook_social_api_network_info_alter().
   *
   * A duplicate `social_auth_google` network plugin loses silently to
   * discovery order; the alter hook substitutes the auth manager
   * deterministically.
   *
   * @param array<string, array<string, mixed>> $definitions
   *   The network plugin definitions.
   */
  #[Hook('social_api_network_info_alter')]
  public function socialApiNetworkInfoAlter(array &$definitions): void {
    if (isset($definitions['social_auth_google'])) {
      $definitions['social_auth_google']['auth_manager'] = '\\' . BbGoogleAuthManager::class;
    }
  }

}
