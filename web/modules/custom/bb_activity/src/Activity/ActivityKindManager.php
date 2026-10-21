<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Activity;

use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Field\FieldStorageDefinitionInterface;
use Drupal\Core\Plugin\DefaultPluginManager;
use Drupal\bb_activity\Attribute\BbActivityKind;
use Drupal\bb_activity\Entity\BbActivity;

/**
 * Discovers activity kinds and hands out a fresh instance on every call.
 *
 * A kind carries per-call contexts, so an instance is never reused or held.
 */
final class ActivityKindManager extends DefaultPluginManager {

  /**
   * Constructs the manager.
   */
  public function __construct(\Traversable $namespaces, CacheBackendInterface $cache_backend, ModuleHandlerInterface $module_handler) {
    parent::__construct(
      'Plugin/BbActivityKind',
      $namespaces,
      $module_handler,
      ActivityKindInterface::class,
      BbActivityKind::class,
    );
    $this->alterInfo('bb_activity_kind_info');
    $this->setCacheBackend($cache_backend, 'bb_activity_kind_plugins');
  }

  /**
   * A fresh instance of every kind, in weight order.
   *
   * @return list<\Drupal\bb_activity\Activity\ActivityKindInterface>
   *   The kinds.
   */
  public function all(): array {
    return array_map(fn (string $id): ActivityKindInterface => $this->kind($id), array_keys($this->sortedDefinitions()));
  }

  /**
   * A fresh instance of the kind a row belongs to, if its plugin still exists.
   */
  public function forActivity(BbActivity $activity): ?ActivityKindInterface {
    $id = (string) ($activity->get('kind')->value ?? '');
    return $id !== '' && $this->hasDefinition($id) ? $this->kind($id) : NULL;
  }

  /**
   * Every mail the kinds offer, one checkbox per kind.
   *
   * @return array<string, array{label: \Drupal\Core\StringTranslation\TranslatableMarkup, description: \Drupal\Core\StringTranslation\TranslatableMarkup|null, default: bool}>
   *   Keyed by kind ID, in the kinds' weight order.
   */
  public function mailOffers(): array {
    $offers = [];
    foreach ($this->sortedDefinitions() as $id => $definition) {
      if (!empty($definition['mail'])) {
        $offers[$id] = [
          'label' => $definition['mail_label'] ?? $definition['label'],
          'description' => $definition['mail_description'] ?? NULL,
          'default' => !empty($definition['mail_default']),
        ];
      }
    }
    return $offers;
  }

  /**
   * The kind IDs an account that never saved its choices wants.
   *
   * @return list<string>
   *   Kind IDs.
   */
  public function mailDefaults(): array {
    return array_keys(array_filter($this->mailOffers(), static fn (array $offer): bool => $offer['default']));
  }

  /**
   * Asks every kind listening to a trigger, in weight order, to record.
   *
   * Each kind gets a fresh instance with the facts it declares as contexts;
   * it decides itself whether the facts make a row. Runs inside the caller's
   * transaction, so a failing kind fails the caller's write.
   *
   * @param string $trigger
   *   An ActivityTrigger constant.
   * @param array<string, mixed> $facts
   *   The facts of the trigger, keyed by name; NULL facts are left unset.
   */
  public function trigger(string $trigger, array $facts): void {
    foreach ($this->sortedDefinitions() as $id => $definition) {
      if (!in_array($trigger, $definition['triggers'] ?? [], TRUE)) {
        continue;
      }
      $kind = $this->kind($id);
      foreach (array_intersect_key($facts, $kind->getContextDefinitions()) as $name => $value) {
        if ($value !== NULL) {
          $kind->setContextValue($name, $value);
        }
      }
      $kind->record();
    }
  }

  /**
   * The allowed_values_function of bb_activity.kind.
   *
   * @param \Drupal\Core\Field\FieldStorageDefinitionInterface $definition
   *   The field storage definition.
   * @param \Drupal\Core\Entity\FieldableEntityInterface|null $entity
   *   The entity, if any.
   * @param bool $cacheable
   *   Whether the result may be cached.
   *
   * @return array<string, string>
   *   Kind labels keyed by kind.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public static function allowedValues(FieldStorageDefinitionInterface $definition, ?FieldableEntityInterface $entity = NULL, bool &$cacheable = TRUE): array {
    $manager = \Drupal::service('plugin.manager.bb_activity_kind');
    assert($manager instanceof self);
    return array_map(
      static fn (array $plugin): string => (string) $plugin['label'],
      $manager->sortedDefinitions(),
    );
  }

  /**
   * A new instance of one kind.
   */
  private function kind(string $id): ActivityKindInterface {
    $kind = $this->createInstance($id);
    assert($kind instanceof ActivityKindInterface);
    return $kind;
  }

  /**
   * Definitions ordered by weight, then ID.
   *
   * @return array<string, array<string, mixed>>
   *   Definitions keyed by plugin ID.
   */
  private function sortedDefinitions(): array {
    $definitions = $this->getDefinitions();
    uasort($definitions, static fn (array $a, array $b): int => [
      $a['weight'] ?? 0,
      $a['id'],
    ] <=> [
      $b['weight'] ?? 0,
      $b['id'],
    ]);
    return $definitions;
  }

}
