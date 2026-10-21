<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\Component\Uuid\Uuid;
use Drupal\Core\DefaultContent\ImportException;
use Drupal\Core\DefaultContent\PreEntityImportEvent;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Entity\EntityTypeBundleInfoInterface;
use Drupal\Core\TypedData\TypedDataManagerInterface;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Makes an og_membership expressible as recipe content.
 *
 * `og_membership.entity_id` is a plain `string` base field, not an entity
 * reference, so a fixture cannot name its group by UUID the way every other
 * reference does — and a numeric id in a fixture breaks the moment seeding
 * order changes. This resolves the UUID before the entity exists.
 *
 * Not a presave hook: `OgMembership::preSave()` throws when the group does not
 * load, and it runs before `invokeHook('presave')`. `PreEntityImportEvent`
 * sees the raw array, and `Finder` orders files on `_meta.depends`, so a
 * fixture declaring its group is imported after it. Generic over group types.
 */
final class OgMembershipImportSubscriber implements EventSubscriberInterface {

  /**
   * Constructs an OgMembershipImportSubscriber.
   *
   * @param \Drupal\Core\Entity\EntityRepositoryInterface $entityRepository
   *   Resolves a UUID to an entity, per entity type.
   * @param \Drupal\Core\Entity\EntityTypeBundleInfoInterface $bundleInfo
   *   Refreshed before the first membership is built.
   * @param \Drupal\Core\TypedData\TypedDataManagerInterface $typedDataManager
   *   Refreshed before the first membership is built.
   */
  public function __construct(
    private readonly EntityRepositoryInterface $entityRepository,
    private readonly EntityTypeBundleInfoInterface $bundleInfo,
    private readonly TypedDataManagerInterface $typedDataManager,
  ) {
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, string>
   *   The subscribed events.
   */
  public static function getSubscribedEvents(): array {
    return [PreEntityImportEvent::class => 'onPreEntityImport'];
  }

  /**
   * Replaces a UUID in og_membership.entity_id with the group's numeric id.
   *
   * @param \Drupal\Core\DefaultContent\PreEntityImportEvent $event
   *   The import event, carrying the raw decoded content array.
   */
  public function onPreEntityImport(PreEntityImportEvent $event): void {
    if (($event->metadata['entity_type'] ?? NULL) !== 'og_membership') {
      return;
    }
    $this->ensureBundleIsKnown((string) ($event->metadata['bundle'] ?? ''));
    $data = $event->data;
    foreach (array_keys($data) as $langcode) {
      if (!is_array($data[$langcode] ?? NULL)) {
        continue;
      }
      $group_type = $data[$langcode]['entity_type'][0]['value'] ?? NULL;
      foreach (array_keys($data[$langcode]['entity_id'] ?? []) as $delta) {
        $value = $data[$langcode]['entity_id'][$delta]['value'] ?? NULL;
        if (!is_string($value) || !Uuid::isValid($value)) {
          // A numeric id, or anything else a fixture states deliberately, is
          // passed through: rewriting it would break a fixture that is right.
          continue;
        }
        $data[$langcode]['entity_id'][$delta]['value'] = (string) $this
          ->resolve($value, $group_type, (string) ($event->metadata['uuid'] ?? ''));
      }
    }
    $event->data = $data;
  }

  /**
   * Makes sure the membership bundle's typed-data derivative is discoverable.
   *
   * The second obstacle to importing an og_membership, and as invisible as the
   * first. `og.og_membership_type.default` is installed with the og module, and
   * a recipe install imports the content in the SAME request — but
   * TypedDataManager caches its definitions without a bundle cache tag, so the
   * bundle-keyed derivative `entity:og_membership:default` is absent from a set
   * built before the bundle existed. Validating the membership then dies with
   * `The "entity:og_membership:default" plugin does not exist`, and the whole
   * recipe install fails.
   *
   * Guarded on the definition actually being missing, so a warm install pays
   * nothing; and it clears the bundle info first, because the derivative is
   * derived from it.
   *
   * @param string $bundle
   *   The bundle from the fixture's `_meta`, or '' when it states none.
   */
  private function ensureBundleIsKnown(string $bundle): void {
    if ($bundle === '') {
      return;
    }
    if ($this->typedDataManager->hasDefinition('entity:og_membership:' . $bundle)) {
      return;
    }
    $this->bundleInfo->clearCachedBundles();
    $this->typedDataManager->clearCachedDefinitions();
  }

  /**
   * Resolves a group UUID to its numeric id.
   *
   * @param string $uuid
   *   The group's UUID, as stated by the fixture.
   * @param mixed $group_type
   *   The group's entity type id, read from the row's own `entity_type` field.
   * @param string $fixture_uuid
   *   The membership's own UUID, which is also its file name.
   *
   * @return string|int
   *   The group's entity id.
   *
   * @throws \Drupal\Core\DefaultContent\ImportException
   *   When the row states no group type, or the UUID resolves to nothing.
   */
  private function resolve(string $uuid, mixed $group_type, string $fixture_uuid): string|int {
    // The message carries the fixture's own UUID — which is its file name — the
    // group type and the unresolved UUID. OG's failure for the same state says
    // only "A group entity is required for creating a membership.", and a
    // recipe seeds dozens of files in one run.
    if (!is_string($group_type) || $group_type === '') {
      throw new ImportException(sprintf(
        'The og_membership fixture %s states a UUID in entity_id but no '
        . 'entity_type to resolve it against.',
        $fixture_uuid,
      ));
    }
    $group = $this->entityRepository->loadEntityByUuid($group_type, $uuid);
    if ($group === NULL) {
      throw new ImportException(sprintf(
        'The og_membership fixture %s references the %s entity %s, which does '
        . 'not exist. Declare it in the fixture\'s _meta.depends so the '
        . 'importer creates it first.',
        $fixture_uuid,
        $group_type,
        $uuid,
      ));
    }
    $id = $group->id();
    if ($id === NULL) {
      throw new ImportException(sprintf(
        'The og_membership fixture %s references the %s entity %s, which has '
        . 'no id.',
        $fixture_uuid,
        $group_type,
        $uuid,
      ));
    }
    return $id;
  }

}
