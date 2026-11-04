<?php

declare(strict_types=1);

namespace Drupal\bb_core\Conductor;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Decides what a conductor_id the owner has not registered yet stands for.
 *
 * Used by ConductorRegistrar under its registration lock.
 */
final class ConductorTakeover {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Refuses a new conductor_id that another user already holds.
   *
   * Derived ids carry no user, so two machines with the same hand-picked
   * machine_id would otherwise share one.
   */
  public function refuseForeignConductorId(AccountInterface $owner, string $conductorId): void {
    $taken = $this->entityTypeManager->getStorage('bb_conductor')->getQuery()
      ->accessCheck(FALSE)
      ->condition('conductor_id', $conductorId)
      ->condition('owner_user_id', $owner->id(), '<>')
      ->count()
      ->execute();
    if ((int) $taken > 0) {
      throw new ConflictHttpException(sprintf(
        'Conductor id "%s" belongs to another user; give this machine its own id: remove machine_id from ~/.bakers/machine.config.js and run bakers init.',
        $conductorId,
      ));
    }
  }

  /**
   * Finds the conductor a new conductor_id replaces, or NULL to create one.
   *
   * A conductor_id is derived from machine + project + variant, so a new one
   * for a combination that already has a conductor (registered under an
   * older id) is offered for takeover instead of silently duplicated. The
   * client decides once: `adopt` (that conductor's UUID) moves it to the new
   * id with its tickets and runs; `create_new` registers another conductor.
   *
   * @param \Drupal\Core\Session\AccountInterface $owner
   *   The authenticated conductor owner.
   * @param string $hostKey
   *   The registering machine.
   * @param int $projectId
   *   Project entity id.
   * @param array<string, mixed> $attrs
   *   Registration attributes: `conductor_name` (the variant), `adopt`,
   *   `create_new`.
   *
   * @return \Drupal\bb_core\Entity\BbConductorInterface|null
   *   The conductor to adopt, or NULL to create a new one.
   */
  public function match(AccountInterface $owner, string $hostKey, int $projectId, array $attrs): ?BbConductorInterface {
    if (!empty($attrs['create_new'])) {
      return NULL;
    }
    $variant = $this->variant($attrs['conductor_name'] ?? NULL);
    $storage = $this->entityTypeManager->getStorage('bb_conductor');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('owner_user_id', $owner->id())
      ->condition('project_id', $projectId)
      ->condition('machine.entity.host_key', $hostKey)
      ->execute();
    $matches = array_filter(
      $storage->loadMultiple($ids),
      fn ($c) => $c instanceof BbConductorInterface && $this->variant($c->get('conductor_name')->value) === $variant,
    );
    $adopt = isset($attrs['adopt']) && is_string($attrs['adopt']) ? $attrs['adopt'] : '';
    if ($adopt !== '') {
      foreach ($matches as $match) {
        if ($match->uuid() === $adopt) {
          return $match;
        }
      }
      throw new UnprocessableEntityHttpException(sprintf('Conductor %s is not your conductor for this machine, project and variant.', $adopt));
    }
    if ($matches === []) {
      return NULL;
    }
    $start = $variant === 'conductor' ? 'bakers oven start' : sprintf('bakers --conductor %s oven start', $variant);
    $offers = array_map(
      fn (BbConductorInterface $c) => sprintf('"%s" (%s --adopt %s)', $c->label(), $start, $c->uuid()),
      $matches,
    );
    throw new ConductorTakeoverOffer(
      sprintf(
        'This machine, project and variant already have %s; take it over, or create a new conductor with %s --new.',
        implode(', ', $offers),
        $start,
      ),
      array_values(array_map(
        fn (BbConductorInterface $c) => [
          'uuid' => (string) $c->uuid(),
          'label' => (string) $c->label(),
          'conductor_id' => (string) $c->get('conductor_id')->value,
          'last_seen' => (int) $c->get('last_seen')->value,
        ],
        $matches,
      )),
    );
  }

  /**
   * Returns the reloaded conductor to adopt, or refuses one that changed.
   *
   * The match was read before the old id's lock was held; a heartbeat, an
   * edit or another adopt may have changed the conductor since.
   */
  public function unchanged(BbConductorInterface $match, mixed $fresh): BbConductorInterface {
    $fields = ['conductor_id', 'owner_user_id', 'project_id', 'machine'];
    if (!$fresh instanceof BbConductorInterface
      || $this->variant($fresh->get('conductor_name')->value) !== $this->variant($match->get('conductor_name')->value)
      || array_filter($fields, fn ($f) => $fresh->get($f)->getValue() != $match->get($f)->getValue()) !== []) {
      throw new ConflictHttpException('The conductor to take over changed meanwhile; retry.');
    }
    return $fresh;
  }

  /**
   * The variant a conductor_name stands for; empty is the default config.
   */
  private function variant(mixed $conductorName): string {
    return is_string($conductorName) && $conductorName !== '' ? $conductorName : 'conductor';
  }

}
