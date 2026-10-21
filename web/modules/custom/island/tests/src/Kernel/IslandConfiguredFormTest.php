<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\Core\Form\EnforcedResponseException;
use Drupal\Core\Form\FormState;
use Drupal\Core\Session\AccountInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\island\IslandContextProviderInterface;
use Drupal\island\IslandInterface;
use Drupal\island_test\Form\TestMultiTriggerForm;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Tests BB-443's generic form-backed island plugin and its trait helpers.
 *
 * Covers, independent of any `bb_core` code:
 * - `ConfiguredForm`'s own configuration-driven guard and delegation.
 * - A host placing `configured_form` under a placement id of its own
 *   choosing, with the resulting html id following the placement id.
 * - `IslandFormTrait::pressedPrefixed()`/`::suppressElementValidation()`
 *   reproducing the exact defect class a BB-435 review round found: a
 *   non-primary trigger refused because a `#required` `entity_autocomplete`
 *   attaches its own validator unconditionally.
 */
#[Group('island')]
final class IslandConfiguredFormTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['system', 'user', 'island', 'island_test'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
  }

  /**
   * Instantiates `configured_form` and asserts the island contract.
   *
   * @param array<string, mixed> $configuration
   *   Plugin configuration, including optional host contexts.
   */
  private function createConfiguredForm(array $configuration): IslandInterface {
    $island = $this->container->get('plugin.manager.island')->createInstance('configured_form', $configuration);
    $this->assertInstanceOf(IslandInterface::class, $island);
    return $island;
  }

  /**
   * The `forms` fixture host.
   */
  private function formsHost(): IslandContextProviderInterface {
    $host = $this->container->get('island.host_resolver')->resolve('forms');
    $this->assertInstanceOf(IslandContextProviderInterface::class, $host);
    return $host;
  }

  /**
   * The guard rejects a missing required-data key.
   */
  public function testGuardRejectsMissingKey(): void {
    $island = $this->createConfiguredForm([
      'form_class' => TestMultiTriggerForm::class,
      'required_data_key' => 'group',
    ]);
    $this->assertSame([], $island->build([]));
  }

  /**
   * The guard rejects a value of the wrong class.
   */
  public function testGuardRejectsWrongClass(): void {
    $island = $this->createConfiguredForm([
      'form_class' => TestMultiTriggerForm::class,
      'required_data_key' => 'group',
      'required_data_class' => AccountInterface::class,
    ]);
    $this->assertSame([], $island->build(['group' => 'not an account']));
  }

  /**
   * The guard passes and the configured form is delegated to.
   *
   * Routed through the real `forms` host and the `configured_task` placement
   * (see FormHostProvider), because delegation calls `getForm()`, which needs
   * a resolvable host and placement to build the nested form — the same path
   * a real consumer takes, not a shortcut around it.
   */
  public function testGuardPassesAndDelegates(): void {
    $host = $this->formsHost();
    $configuration = $host->getIslandConfiguration('configured_task');
    $configuration['contexts']['host'] = $host;
    $configuration['contexts']['placement_id'] = 'configured_task';
    $island = $this->createConfiguredForm($configuration);
    $build = $island->build($host->getIslandData('configured_task'));
    $this->assertArrayHasKey('account', $build);
  }

  /**
   * No form_class configured renders nothing rather than erroring.
   */
  public function testMissingFormClassRendersEmpty(): void {
    $island = $this->createConfiguredForm([]);
    $this->assertSame([], $island->build([]));
  }

  /**
   * The html id follows the HOST's placement id, not the plugin's own id.
   *
   * `configured_task` is placed under plugin id `configured_form` via
   * `FormHostProvider::getIslandPluginId()`; the resulting id must read
   * `island-forms-configured_task`, proving the existing `placement_id`
   * context seam is enough — no deriver needed for one plugin to serve many
   * differently-named placements.
   */
  public function testHtmlIdFollowsPlacementIdNotPluginId(): void {
    $host = $this->formsHost();
    $configuration = $host->getIslandConfiguration('configured_task');
    $configuration['contexts']['host'] = $host;
    $configuration['contexts']['placement_id'] = 'configured_task';
    $plugin_id = $this->container->get('island.host_resolver')->pluginId('configured_task', $host);
    $this->assertSame('configured_form', $plugin_id);
    $island = $this->createConfiguredForm($configuration);
    $this->assertSame('island-forms-configured_task', $island->getHtmlId('forms'));
  }

  /**
   * A non-primary trigger succeeds with unresolved primary text.
   *
   * Reproduces the exact defect class a BB-435 review round found: a
   * `#required` entity_autocomplete attaches its own validator
   * unconditionally, so a pick/remove trigger was refused whenever that
   * control held unresolved text.
   */
  public function testNonPrimaryTriggerSucceedsWithUnresolvedPrimaryText(): void {
    $request = Request::create('/island-test', 'POST', [
      'account' => 'no such person',
      'mark_1' => '1',
      'form_id' => 'island_test_multi_trigger_form',
    ]);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);

    $args = ['island_id' => 'configured_task', 'host_id' => 'forms'];
    $form_state = (new FormState())->addBuildInfo('args', [$args]);
    try {
      $this->container->get('form_builder')->buildForm(TestMultiTriggerForm::class, $form_state);
      $this->fail('Expected the fragment response to short-circuit the build.');
    }
    catch (EnforcedResponseException $e) {
      $this->assertNotNull($e->getResponse());
    }
    $this->assertEmpty($form_state->getErrors());
    $this->assertSame('marked:1', $this->formsHost()->getIslandData('configured_task')['recorded']);
  }

  /**
   * The primary submit still validates the account field.
   *
   * Proves the suppression is scoped to the non-primary trigger only:
   * unresolved text on the primary control still refuses an Add.
   */
  public function testPrimarySubmitStillValidatesTheAccountField(): void {
    $request = Request::create('/island-test', 'POST', [
      'account' => 'no such person',
      'op' => 'Add',
      'form_id' => 'island_test_multi_trigger_form',
    ]);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);

    $args = ['island_id' => 'configured_task', 'host_id' => 'forms'];
    $form_state = (new FormState())->addBuildInfo('args', [$args]);
    $this->container->get('form_builder')->buildForm(TestMultiTriggerForm::class, $form_state);
    $this->assertNotEmpty($form_state->getErrors());
  }

}
