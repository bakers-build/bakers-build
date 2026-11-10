<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Resource;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\bb_core\Conductor\ConductorRegistrar;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_addon\AddonContractValidator;
use Drupal\bb_addon\AddonWorkspaceResolver;
use Drupal\bb_addon\Entity\BbAddon;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_inbox\Resource\PlainResourceTrait;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi_resources\Resource\ResourceBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Route;

/**
 * A conductor registers the addon definitions it runs.
 *
 * `{conductor_id, addons: [definition…]}`. Each valid definition lists the
 * conductor on the row of its (name, version) holding an identical
 * definition (same keys, values and key order), or on a new one; the
 * conductor leaves every other row. A differing definition never locks
 * another conductor out of a version. The answer names each accepted and
 * rejected addon; it is a 422 only when every sent addon was rejected.
 */
final class AddonsRegisterResource extends ResourceBase implements ContainerInjectionInterface {

  use PlainResourceTrait;

  private const TYPE = 'bb_addon_registration';
  private const FIELDS = ['accepted', 'rejected'];

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly AccountInterface $currentUser,
    private readonly AddonContractValidator $validator,
    private readonly AddonWorkspaceResolver $workspaceResolver,
    private readonly LockBackendInterface $lock,
    private readonly ConductorRegistrar $registrar,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('entity_type.manager'),
      $container->get('current_user'),
      $container->get('bb_addon.contract_validator'),
      $container->get('bb_addon.workspace_resolver'),
      $container->get('lock'),
      $container->get('bb_core.conductor_registrar'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getRouteResourceTypes(Route $route, string $route_name): array {
    return [self::plainResourceType(self::TYPE, self::FIELDS)];
  }

  /**
   * Handles the registration POST.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The request carrying data.attributes.
   *
   * @return \Drupal\jsonapi\ResourceResponse
   *   200 with `accepted` and `rejected`, or 422 when all were rejected.
   */
  public function process(Request $request): ResourceResponse {
    // Decoded as objects: an associative decode cannot tell {} from [].
    $body = json_decode($request->getContent());
    $attributes = is_object($body) && isset($body->data->attributes) ? $body->data->attributes : new \stdClass();
    $conductor = $this->ownConductor((string) ($attributes->conductor_id ?? ''));
    $workspace = $this->workspaceResolver->resolve($conductor);
    if (!$workspace instanceof BbWorkspaceInterface) {
      throw new NotFoundHttpException('The conductor has no resolvable workspace.');
    }
    $accepted = [];
    $rejected = [];
    $keep = [];
    foreach (is_array($attributes->addons ?? NULL) ? $attributes->addons : [] as $definition) {
      $name = (string) ($definition->name ?? '');
      $version = (string) ($definition->version ?? '');
      $error = is_object($definition) ? $this->register($definition, $conductor, $workspace) : 'The definition must be an object.';
      if ($error instanceof BbAddonInterface) {
        $keep[] = (int) $error->id();
        $accepted[] = ['name' => $name, 'version' => $version, 'id' => $error->uuid()];
        continue;
      }
      $rejected[] = ['name' => $name, 'version' => $version, 'error' => $error];
    }
    $this->leaveOtherVersions($conductor, $keep);
    $status = $accepted === [] && $rejected !== [] ? 422 : 200;
    return $this->plainResponse($request, self::plainResourceType(self::TYPE, self::FIELDS), $conductor->uuid(), [
      'accepted' => $accepted,
      'rejected' => $rejected,
    ], $status);
  }

  /**
   * Upserts one definition and lists the conductor on it.
   *
   * @param object $definition
   *   The definition, decoded as objects.
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The registering conductor.
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The conductor's resolved workspace.
   *
   * @return \Drupal\bb_addon\Entity\BbAddonInterface|string
   *   The stored addon, or the reason it was rejected.
   */
  private function register(object $definition, BbConductorInterface $conductor, BbWorkspaceInterface $workspace): BbAddonInterface|string {
    $contract = (int) ($definition->contract ?? 1);
    if ($contract !== 2) {
      return 'Only contract 2 definitions are accepted.';
    }
    $errors = $this->validator->validateDefinitionV2($definition);
    if ($errors !== []) {
      return implode('; ', $errors);
    }
    $values = (array) $definition;
    $json = (string) json_encode($definition, JSON_UNESCAPED_SLASHES);
    $addon = $this->stored((int) $workspace->id(), (string) $values['name'], (string) $values['version'], $json);
    if ($addon->isNew() || !$addon->runsOn($conductor)) {
      $addon->addConductor($conductor)->save();
    }
    return $addon;
  }

  /**
   * The workspace's row of a name and version, creating it under a lock.
   *
   * Identity is (workspace, name, version, fingerprint): an identical
   * definition shares a row, a differing one gets its own, so another
   * member's registration never decides what runs on this conductor. The
   * unique database key
   * (`BbAddonStorageSchema`) is the authority under concurrent
   * registration; a collision on create means another request won the race,
   * so this reloads the now-existing row instead of failing.
   *
   * @return \Drupal\bb_addon\Entity\BbAddonInterface
   *   The stored row, saved.
   */
  private function stored(int $workspace_id, string $name, string $version, string $json): BbAddonInterface {
    $storage = $this->entityTypeManager->getStorage('bb_addon');
    $fingerprint = BbAddon::fingerprintOf($json);
    $lock_name = 'bb_addon_register:' . $workspace_id . ':' . $name . ':' . $version . ':' . $fingerprint;
    if (!$this->lock->acquire($lock_name)
      && ($this->lock->wait($lock_name, 5) || !$this->lock->acquire($lock_name))) {
      throw new \RuntimeException("Could not acquire the registration lock for {$name}@{$version}.");
    }
    try {
      $existing = $this->existing($storage, $workspace_id, $name, $version, $fingerprint);
      if ($existing instanceof BbAddonInterface) {
        return $existing;
      }
      $definition = json_decode($json, TRUE);
      $addon = $storage->create([
        'workspace_id' => $workspace_id,
        'name' => $name,
        'version' => $version,
        'contract' => (int) ($definition['contract'] ?? 0),
        'definition' => $json,
      ]);
      assert($addon instanceof BbAddonInterface);
      try {
        $addon->save();
        return $addon;
      }
      catch (EntityStorageException) {
        // The unique key rejected a concurrent duplicate; the winner is
        // already stored under this same lock name's prior holder.
        $reloaded = $this->existing($storage, $workspace_id, $name, $version, $fingerprint);
        if ($reloaded instanceof BbAddonInterface) {
          return $reloaded;
        }
        throw new \RuntimeException("Registration race for {$name}@{$version} left no row to reload.");
      }
    }
    finally {
      $this->lock->release($lock_name);
    }
  }

  /**
   * The existing row for this identity, or NULL.
   */
  private function existing(EntityStorageInterface $storage, int $workspace_id, string $name, string $version, string $fingerprint): ?BbAddonInterface {
    $addons = $storage->loadByProperties([
      'workspace_id' => $workspace_id,
      'name' => $name,
      'version' => $version,
      'fingerprint' => $fingerprint,
    ]);
    $addon = reset($addons);
    return $addon instanceof BbAddonInterface ? $addon : NULL;
  }

  /**
   * Removes the conductor from every version it no longer runs.
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The registering conductor.
   * @param array<int> $keep
   *   The ids of the accepted rows.
   */
  private function leaveOtherVersions(BbConductorInterface $conductor, array $keep): void {
    $storage = $this->entityTypeManager->getStorage('bb_addon');
    $query = $storage->getQuery()->accessCheck(FALSE)->condition('conductors', $conductor->id());
    if ($keep !== []) {
      $query->condition('id', $keep, 'NOT IN');
    }
    foreach ($storage->loadMultiple($query->execute()) as $addon) {
      if ($addon instanceof BbAddonInterface) {
        $addon->removeConductor($conductor)->save();
      }
    }
  }

  /**
   * The conductor with that registration id, owned by the current user.
   */
  private function ownConductor(string $conductor_id): BbConductorInterface {
    $conductors = $conductor_id === '' ? [] : $this->entityTypeManager->getStorage('bb_conductor')
      ->loadByProperties(['conductor_id' => $conductor_id]);
    $conductor = reset($conductors);
    if (!$conductor instanceof BbConductorInterface) {
      throw new NotFoundHttpException('No such conductor.');
    }
    if (!$this->registrar->serves($conductor, $this->currentUser)) {
      throw new AccessDeniedHttpException('Only the conductor owner registers its addons.');
    }
    return $conductor;
  }

}
