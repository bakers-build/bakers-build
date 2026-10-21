<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Form\GroupMembersForm;
use Drupal\bb_core\Members\MemberItemBuilder;
use Drupal\bb_core\Members\WorkspaceInvite;
use Drupal\bb_core\Form\GroupMemberFormTrait;
use Drupal\island\IslandContextProviderInterface;
use Drupal\island\Plugin\Island\ConfiguredForm;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * One member surface, now reached from one screen (BB-419 D6, D7/D8).
 *
 * THE PROJECT HOST IS GONE. This class used to enumerate two hosts — team and
 * project — to prove a near-duplicate plugin registered for either could not
 * quietly diverge from the shared surface. BB-462 D7 deregisters
 * `bb_project` as an OG group entirely and retires `BbProjectIslandHost`
 * along with it, so `team` is now the only host this surface reaches. The
 * class stays rather than being deleted: `MemberItemBuilder` and
 * `GroupMembersForm` remain shared infrastructure the workspace's own member
 * surface (BB-462 D8) is expected to become a second consumer of, and the
 * source-level "no entity-type literal" guard still matters with one caller.
 *
 * AC 6 IS A SOURCE-LEVEL PROPERTY AND IS ASSERTED AT THAT LEVEL. "Does not
 * branch on bb_team vs bb_project" cannot be observed from behaviour: a
 * class full of `instanceof` branches behaves identically until one of the
 * branches is wrong. Reading the files is the only check that fails for the
 * reason the criterion states.
 *
 * WHAT IS DELIBERATELY NOT SHARED IS THE HOST, and that is not a hole. A host's
 * whole job is to say which entity the current route is about, so there is one
 * per entity type by definition. What the host hands over is the key `group`,
 * which is what lets the island and the forms stay type-blind.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class GroupMemberSurfaceTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * The one screen that carries a member surface, by host id (BB-462 D7).
   *
   * @var array<string>
   */
  private const MEMBER_HOSTS = ['team'];

  /**
   * EVERY shared bb_core file that must contain no entity-type literal.
   *
   * `GroupMembers` (BB-435's own island plugin) is NOT in this list any
   * more — BB-443 moved that role onto `ConfiguredForm`, generic shared
   * infrastructure in the `island` module that takes no `bb_core`
   * dependency at all, so it cannot reference `bb_team`/`bb_project`
   * without first importing a class this list would then also have to watch.
   * What replaces that check is `testBothScreensRenderTheSameIslandPlugin()`
   * asserting both hosts configure the identical `form_class`.
   *
   * The trait is named here as a string subject rather than as a class: for
   * this check a file is a file, and ReflectionClass resolves a trait's file
   * exactly as it resolves a class's.
   *
   * @var array<string>
   */
  private const TYPE_BLIND_SOURCES = [
    // ONE FORM WHERE THERE WERE THREE CLASSES AND A VIEWS FIELD (BB-435).
    // `GroupMemberAddForm`, `GroupMemberRemoveForm` and the
    // `bb_group_member_remove` field plugin collapsed into one form,
    // so the type-blindness this case guards now has one fewer place to leak
    // from — and the surviving file is the one that does all three writes.
    GroupMembersForm::class,
    // The FACE half of that collapse. `GroupMembersForm` kept the writes and
    // `MemberItemBuilder` took the cells and the two interactive controls, so
    // the type-blindness this case guards has to reach both halves — the
    // builder is where a branch on the group's kind would be most tempting,
    // because it is the file that decides which arm an item takes.
    MemberItemBuilder::class,
    GroupMemberFormTrait::class,
    WorkspaceInvite::class,
  ];

  /**
   * Both hosts declare the member surface, and it is ONE plugin and ONE form.
   *
   * Since BB-443, the shared plugin is the generic `ConfiguredForm`, placed
   * under each host's own `members` placement id via `getIslandPluginId()`
   * (`IslandHostResolver::pluginId()`). A near-duplicate plugin registered
   * for the project host would still resolve to the SAME `configured_form`
   * id, so the property this test actually has to pin moved to the
   * CONFIGURATION: both hosts must name the identical `form_class`.
   */
  public function testBothScreensRenderTheSameIslandPlugin(): void {
    $resolver = $this->container->get('island.host_resolver');
    $manager = $this->container->get('plugin.manager.island');

    foreach (self::MEMBER_HOSTS as $host_id) {
      $host = $resolver->resolve($host_id);
      self::assertInstanceOf(
        IslandContextProviderInterface::class,
        $host,
        "the $host_id screen has an island host",
      );
      self::assertContains(
        'members',
        $host->getIslandIds(),
        "the $host_id screen declares the member surface",
      );
      $plugin_id = $resolver->pluginId('members', $host);
      self::assertSame(
        'configured_form',
        $plugin_id,
        "the $host_id screen places the member surface on the generic form-backed island",
      );
      $configuration = $host->getIslandConfiguration('members');
      self::assertSame(
        GroupMembersForm::class,
        $configuration['form_class'] ?? NULL,
        "the $host_id screen's member surface renders the shared form",
      );
      self::assertInstanceOf(
        ConfiguredForm::class,
        $manager->createInstance($plugin_id, $configuration),
      );
    }
  }

  /**
   * Both hosts hand the island the same key, so the island stays type-blind.
   *
   * The parameterisation D6 rests on. If one host answered `team` and the other
   * `project`, the island would have to ask which — and asking is the branch
   * AC 6 forbids.
   */
  public function testBothHostsHandOverTheGroupUnderOneKey(): void {
    $resolver = $this->container->get('island.host_resolver');

    foreach (self::MEMBER_HOSTS as $host_id) {
      $host = $resolver->resolve($host_id);
      self::assertInstanceOf(IslandContextProviderInterface::class, $host);
      // Off its own route a host has no ambient group, so the data is empty —
      // that is the tenancy rule, not a missing key. What is asserted here is
      // that no host invents a key of its own.
      $keys = array_keys($host->getIslandData('members'));
      self::assertTrue(
        $keys === [] || $keys === ['group'],
        sprintf('the %s host hands over `group`, not a type-specific key; got [%s]', $host_id, implode(', ', $keys)),
      );
    }
  }

  /**
   * No shared file names either entity type (AC 6).
   */
  public function testTheSharedClassesCarryNoEntityTypeLiteral(): void {
    self::assertCount(
      4,
      self::TYPE_BLIND_SOURCES,
      'every shared file is watched; adding one to the surface adds it here',
    );

    foreach (self::TYPE_BLIND_SOURCES as $class) {
      $file = (new \ReflectionClass($class))->getFileName();
      self::assertIsString($file);
      $source = file_get_contents($file);
      self::assertIsString($source);

      foreach (['bb_team', 'bb_project'] as $literal) {
        self::assertStringNotContainsString(
          $literal,
          $source,
          sprintf('%s must not branch on %s', $class, $literal),
        );
      }
    }
  }

}
