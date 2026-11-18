<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Component\Plugin\Exception\PluginException;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\island\Entity\IslandProfileInterface;

/**
 * Knows which placements of a profile embed which, and what is invalid.
 *
 * A placement in the reserved `embedded` slot is rendered only where an
 * enabled placement references it (IslandEmbeddingInterface), exactly once
 * and one level deep.
 */
final class IslandProfileEmbedding {

  use StringTranslationTrait;

  public function __construct(
    private readonly IslandPluginManagerInterface $islandManager,
    private readonly IslandLayoutManager $layoutManager,
  ) {
  }

  /**
   * Maps each referenced placement id to the enabled placements referencing it.
   *
   * @return array<string, string[]>
   *   Referencing placement ids keyed by referenced id; one entry per
   *   reference.
   */
  public function references(IslandProfileInterface $profile): array {
    $references = [];
    foreach ($profile->getEnabledPlacements() as $placement_id => $placement) {
      try {
        $plugin = $this->islandManager->createInstance((string) ($placement['plugin_id'] ?? ''), $placement['configuration'] ?? []);
      }
      catch (PluginException) {
        // An unavailable plugin is reported by the profile's own validation.
        continue;
      }
      if (!$plugin instanceof IslandEmbeddingInterface) {
        continue;
      }
      foreach ($plugin->embeddedPlacements() as $embedded_id) {
        $references[$embedded_id][] = (string) $placement_id;
      }
    }
    return $references;
  }

  /**
   * Returns every embedding error of a profile, each naming its placement.
   *
   * @return string[]
   *   Error messages.
   */
  public function errors(IslandProfileInterface $profile): array {
    $slot = IslandProfileInterface::EMBEDDED_SLOT;
    $placements = $profile->get('placements') ?? [];
    $errors = [];
    $embedded = array_keys(array_filter($profile->getEnabledPlacements(), static fn(array $placement): bool => ($placement['slot'] ?? '') === $slot));
    if (isset($this->layoutManager->getSlots($profile->getLayoutId())[$slot])) {
      $errors[] = (string) $this->t('Layout @layout declares the reserved slot "@slot"; rename it before embedding placements (@ids).', [
        '@layout' => $profile->getLayoutId(),
        '@slot' => $slot,
        '@ids' => implode(', ', $embedded),
      ]);
    }
    $references = $this->references($profile);
    foreach ($references as $embedded_id => $referencing) {
      $placement = $placements[$embedded_id] ?? NULL;
      $args = ['@id' => $embedded_id, '@from' => implode(', ', array_unique($referencing)), '@slot' => $slot];
      if ($placement === NULL) {
        $errors[] = (string) $this->t('Placement @from embeds the missing placement @id.', $args);
        continue;
      }
      if (($placement['enabled'] ?? TRUE) !== TRUE) {
        $errors[] = (string) $this->t('Placement @from embeds the disabled placement @id.', $args);
        continue;
      }
      if (($placement['slot'] ?? '') !== $slot) {
        $errors[] = (string) $this->t('Placement @from embeds placement @id, which is not in the "@slot" slot.', $args);
      }
      foreach (array_unique($referencing) as $from) {
        if (($placements[$from]['slot'] ?? '') === $slot) {
          $errors[] = (string) $this->t('Embedded placement @from cannot embed placement @id; embedding is one level deep.', [
            '@from' => $from,
            '@id' => $embedded_id,
          ]);
        }
      }
    }
    return array_merge($errors, $this->countErrors($profile, $embedded, $references));
  }

  /**
   * Errors for embedded placements not referenced exactly once.
   *
   * @param \Drupal\island\Entity\IslandProfileInterface $profile
   *   The profile.
   * @param string[] $embedded
   *   Enabled placement ids in the embedded slot.
   * @param array<string, string[]> $references
   *   The result of references().
   *
   * @return string[]
   *   Error messages.
   */
  private function countErrors(IslandProfileInterface $profile, array $embedded, array $references): array {
    $errors = [];
    // References from an unavailable plugin are unknown; a zero count would
    // be a false error beside the profile's own report of that plugin.
    $unresolved = array_filter($profile->getEnabledPlacements(), fn(array $placement): bool => !$this->islandManager->hasDefinition((string) ($placement['plugin_id'] ?? '')));
    foreach ($embedded as $embedded_id) {
      $count = count($references[$embedded_id] ?? []);
      if ($count > 1 || ($count === 0 && $unresolved === [])) {
        $errors[] = (string) $this->t('Embedded placement @id must be referenced exactly once; it is referenced @count times.', [
          '@id' => $embedded_id,
          '@count' => $count,
        ]);
      }
    }
    return $errors;
  }

}
