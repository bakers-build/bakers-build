<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Hook;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\consumers\Entity\Consumer;
use Drupal\bb_api_key\ApiKeyManager;

/**
 * Field declaration and deletion cleanup for self-service API keys.
 */
final class ApiKeyHooks {

  public function __construct(
    private readonly ApiKeyManager $apiKeyManager,
  ) {}

  /**
   * Implements hook_entity_base_field_info().
   *
   * Two nullable, non-translatable, stored timestamps on the Simple OAuth
   * `consumer` content entity. Existing consumers keep NULL values; a
   * nonempty `bb_key_created` is what marks a consumer as a self-service
   * key (ApiKeyManager::isManaged()). Installs get the storage from this
   * definition automatically.
   *
   * @return array<string, \Drupal\Core\Field\BaseFieldDefinition>
   *   The base field definitions this hook adds.
   */
  #[Hook('entity_base_field_info')]
  public function entityBaseFieldInfo(EntityTypeInterface $entity_type): array {
    if ($entity_type->id() !== 'consumer') {
      return [];
    }

    $fields = [];
    $fields['bb_key_created'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('API key created'))
      ->setDescription(new TranslatableMarkup('Set once, by the self-service API-key form. A nonempty value marks this consumer as a self-service key.'))
      ->setTranslatable(FALSE)
      ->setRevisionable(FALSE)
      ->setDisplayConfigurable('view', FALSE)
      ->setDisplayConfigurable('form', FALSE);
    $fields['bb_expires'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('API key expires'))
      ->setDescription(new TranslatableMarkup('The UTC instant this self-service key stops validating new token requests.'))
      ->setTranslatable(FALSE)
      ->setRevisionable(FALSE)
      ->setDisplayConfigurable('view', FALSE)
      ->setDisplayConfigurable('form', FALSE);

    return $fields;
  }

  /**
   * Implements hook_entity_delete().
   *
   * Revokes every token a managed key has issued, synchronously, in the same
   * request as the consumer delete — Simple OAuth does not do this on its
   * own (it only exposes hook_consumer_update). Failure propagates: the UI
   * must not report a successful revoke while a token remains usable.
   */
  #[Hook('entity_delete')]
  public function entityDelete(EntityInterface $entity): void {
    if (!$entity instanceof Consumer || !$this->apiKeyManager->isManaged($entity)) {
      return;
    }

    // Resolved lazily, not injected: ExpiredCollector's constructor eagerly
    // loads the 'consumer' storage, which triggers base-field discovery and
    // re-enters this very hook class — a real, not just static, circular
    // dependency when ExpiredCollector is a constructor argument here.
    // @phpstan-ignore-next-line globalDrupalDependencyInjection.useDependencyInjection
    $expiredCollector = \Drupal::service('simple_oauth.expired_collector');
    // Include refresh tokens defensively, although a client_credentials-only
    // key never requests that grant.
    $tokens = $expiredCollector->collectForClient($entity, TRUE);
    if ($tokens) {
      $expiredCollector->deleteMultipleTokens($tokens);
    }
  }

  /**
   * Implements hook_views_data_alter().
   *
   * Registers the two computed fields the owner's key listing uses. Every
   * ordinary field (label, client_id, bb_key_created, bb_expires) is
   * already exposed by the Consumer entity's generic EntityViewsData.
   *
   * @param array<string, mixed> $data
   *   The Views data to alter.
   */
  #[Hook('views_data_alter')]
  public function viewsDataAlter(array &$data): void {
    if (!isset($data['consumer_field_data'])) {
      return;
    }
    $data['consumer_field_data']['bb_api_key_status'] = [
      'title' => new TranslatableMarkup('Key status'),
      'help' => new TranslatableMarkup('Disabled, Expired or Active.'),
      'field' => ['id' => 'bb_api_key_status'],
    ];
    $data['consumer_field_data']['bb_api_key_revoke_link'] = [
      'title' => new TranslatableMarkup('Revoke link'),
      'help' => new TranslatableMarkup('Link to the owner-only revoke confirmation form.'),
      'field' => ['id' => 'bb_api_key_revoke_link'],
    ];
  }

}
