<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Navigation\AccountWorkspaceContext;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The `person` props for the SIGNED-IN account, with no entity context.
 *
 * `BbUserPersonPropsSource` needs an `entity:user` context, which a shell
 * placement does not have; this source loads the signed-in account itself.
 * Used by the `shell_rail` placement in `island.profile.bb_shell.yml`.
 */
#[Source(
  id: 'bb_current_user_person_props',
  label: new TranslatableMarkup('[bakers.build] Person props from the current user'),
  description: new TranslatableMarkup('Every `person` prop for the signed-in account, with no entity context required.'),
  prop_types: ['string', 'enum'],
)]
final class BbCurrentUserPersonPropsSource extends SourcePluginBase {

  use PersonIdentityTrait;

  private const string PROP_DISPLAY_NAME = 'display_name';
  private const string PROP_INITIALS = 'initials';
  private const string PROP_COLOR = 'color';
  private const string PROP_PICTURE = 'picture';
  private const string PROP_URL = 'url';

  /**
   * The validated account navigation context.
   */
  protected AccountWorkspaceContext $workspaceContext;

  /**
   * Fallback for the anonymous branch, so a required prop is never empty.
   *
   * This source is only wired into placements on authenticated-only routes
   * (`island.profile.bb_shell.yml`), so `account()` returning NULL is not
   * expected to be reached in the running product. It is handled anyway:
   * `person.component.yml` declares `initials` required, and ui_patterns
   * strips an empty prop value before SDC ever sees it, which turns a missing
   * value into a fatal rather than a rendered fallback avatar.
   */
  private const string ANONYMOUS_INITIALS = '?';

  /**
   * The current-session account proxy, injected in `create()`.
   */
  protected AccountProxyInterface $currentUser;

  /**
   * The entity type manager, to load the full `user` entity and image style.
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->currentUser = $container->get('current_user');
    $instance->entityTypeManager = $container->get('entity_type.manager');
    $instance->workspaceContext = $container->get(AccountWorkspaceContext::class);
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function alterComponent(array $element): array {
    $element = parent::alterComponent($element);
    $cache = CacheableMetadata::createFromRenderArray($element);
    // Per-session render: the account and its cache contexts/tags both change
    // when a different user signs in, or when this one edits their profile.
    $cache->addCacheContexts(['user']);
    $account = $this->account();
    if ($account !== NULL) {
      $cache->addCacheableDependency($account);
    }
    $this->workspaceContext->resolve($cache);
    $cache->applyTo($element);
    return $element;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $account = $this->account();
    if ($account === NULL) {
      return $this->getPropId() === self::PROP_INITIALS ? self::ANONYMOUS_INITIALS : '';
    }

    return match ($this->getPropId()) {
      self::PROP_DISPLAY_NAME => $this->personDisplayName($account),
      self::PROP_INITIALS => (string) $account->get('person_initials')->value,
      self::PROP_COLOR => (string) $account->get('person_color')->value,
      self::PROP_PICTURE => (string) $account->get('person_picture')->value,
      self::PROP_URL => $this->accountUrl($account),
      default => '',
    };
  }

  /**
   * Carries only the validated workspace UUID into the account area.
   */
  private function accountUrl(UserInterface $account): string {
    $url = $account->toUrl();
    $workspace = $this->workspaceContext->resolve(new CacheableMetadata());
    if ($workspace !== NULL) {
      $url->setOption('query', ['workspace' => $workspace->uuid()]);
    }
    return $url->toString();
  }

  /**
   * The signed-in account as a full `user` entity, or NULL when anonymous.
   */
  private function account(): ?UserInterface {
    $uid = (int) $this->currentUser->id();
    if ($uid === 0) {
      return NULL;
    }
    $entity = $this->entityTypeManager->getStorage('user')->load($uid);
    return $entity instanceof UserInterface ? $entity : NULL;
  }

}
