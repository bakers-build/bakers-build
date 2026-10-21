<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Yaml\Yaml;

/**
 * No seeded og_membership stores OG's implicit `member` role.
 *
 * `member` is `OgRoleInterface::AUTHENTICATED`: every membership carries it by
 * definition, and OG refuses to store it. `OgMembership::setRoles()` filters it
 * out of any assignment, and `OgMembership::preSave()` revokes it again before
 * the row is written — so a fixture naming `<entity_type>-<bundle>-member` in
 * `roles` describes a state OG does not model, and the importer silently drops
 * it. The imported entity therefore no longer matches its own source file, so a
 * re-export of that fixture produces a diff nobody asked for.
 *
 * Runs without a bootstrapped site: the recipe directories resolve from
 * __DIR__.
 */
#[Group('bb_core')]
final class SeedMembershipImplicitRoleTest extends UnitTestCase {

  /**
   * Every shipped og_membership fixture omits its group's implicit role.
   */
  public function testSeededMembershipsOmitTheImplicitMemberRole(): void {
    $offenders = [];

    foreach ($this->membershipFixtures() as $path) {
      $data = Yaml::parseFile($path);
      foreach ($data as $langcode => $values) {
        if ($langcode === '_meta' || !is_array($values)) {
          continue;
        }
        $implicit = sprintf(
          '%s-%s-member',
          $values['entity_type'][0]['value'] ?? '',
          $values['entity_bundle'][0]['value'] ?? '',
        );
        foreach ($values['roles'] ?? [] as $role) {
          if (($role['target_id'] ?? NULL) === $implicit) {
            $offenders[] = basename($path) . ' → ' . $implicit;
          }
        }
      }
    }

    self::assertSame([], $offenders, implode("\n", $offenders));
  }

  /**
   * Every og_membership fixture shipped by any recipe.
   *
   * Globbed rather than listed, so a recipe or fixture added later is covered
   * without an enumeration to maintain.
   *
   * @return array<string>
   *   Absolute fixture paths.
   */
  private function membershipFixtures(): array {
    $paths = glob(dirname(__DIR__, 7) . '/recipes/*/content/og_membership/*.yml') ?: [];
    self::assertNotSame([], $paths, 'No og_membership fixtures were found.');
    return $paths;
  }

}
