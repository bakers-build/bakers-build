<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;

/**
 * The `person` props of a `user` entity, for the `user.user.compact` mapping.
 *
 * Initials, colour and picture are the account's computed `person_*` fields,
 * the one place every person mark reads. All props go through this one
 * source: mixing it with generic sources left props empty at render time.
 */
#[Source(
  id: 'bb_user_person_props',
  label: new TranslatableMarkup('[bakers.build] Person props from a user'),
  description: new TranslatableMarkup('Every `person` prop for the `user.user.compact` mapping, derived from one account.'),
  prop_types: ['string', 'enum', 'variant'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:user', label: new TranslatableMarkup('User'), required: TRUE),
  ],
)]
final class BbUserPersonPropsSource extends SourcePluginBase {

  use PersonIdentityTrait;

  private const string PROP_VARIANT = 'variant';
  private const string PROP_SIZE = 'size';
  private const string PROP_DISPLAY_NAME = 'display_name';
  private const string PROP_INITIALS = 'initials';
  private const string PROP_COLOR = 'color';
  private const string PROP_PICTURE = 'picture';

  /**
   * {@inheritdoc}
   */
  public function alterComponent(array $element): array {
    $element = parent::alterComponent($element);
    $account = $this->account();
    if ($account === NULL) {
      return $element;
    }
    $cache = CacheableMetadata::createFromRenderArray($element);
    $cache->addCacheableDependency($account);
    $cache->applyTo($element);
    return $element;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $account = $this->account();
    if ($account === NULL) {
      return '';
    }

    return match ($this->getPropId()) {
      self::PROP_VARIANT => 'compact',
      self::PROP_SIZE => 'sm',
      self::PROP_DISPLAY_NAME => $this->personDisplayName($account),
      self::PROP_INITIALS => (string) $account->get('person_initials')->value,
      self::PROP_COLOR => (string) $account->get('person_color')->value,
      self::PROP_PICTURE => (string) $account->get('person_picture')->value,
      default => '',
    };
  }

  /**
   * The user this source is rendering, or NULL off a user.
   */
  private function account(): ?UserInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof UserInterface ? $entity : NULL;
  }

}
