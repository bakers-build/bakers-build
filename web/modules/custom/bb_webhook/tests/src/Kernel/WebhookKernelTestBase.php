<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_webhook\Kernel;

use Drupal\bb_webhook\Entity\BbWebhookInterface;
use Drupal\filter\Entity\FilterFormat;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\user\UserInterface;

/**
 * Two workspaces, each with a project, a group and a lead (Admin).
 */
abstract class WebhookKernelTestBase extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'views', 'bb_core',
    'bb_activity', 'bb_webhook',
  ];

  /**
   * The lead (Admin rank) of each side, keyed 'a'/'b'.
   *
   * @var array<string, \Drupal\user\UserInterface>
   */
  protected array $leads = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->installEntitySchema('bb_activity');
    $this->installEntitySchema('bb_webhook');
    FilterFormat::create(['format' => 'bb_rich', 'name' => 'bakers.build rich'])->save();
    $this->buildTwoWorkspaceWorld();
    foreach (['a', 'b'] as $side) {
      $lead = $this->createAccount("lead-$side");
      $this->addMembership($this->fixture($side, 'bb_workspace'), $lead, ['lead']);
      $this->addMembership($this->fixture($side, 'bb_team'), $lead, []);
      $this->leads[$side] = $lead;
    }
  }

  /**
   * Builds an unsaved webhook on a side's workspace.
   *
   * @param string $side
   *   The workspace side.
   * @param array<string, mixed> $values
   *   Field values overriding the defaults.
   */
  protected function newWebhook(string $side, array $values = []): BbWebhookInterface {
    $webhook = $this->container->get('entity_type.manager')->getStorage('bb_webhook')->create($values + [
      'name' => "hook-$side",
      'url' => "https://hooks.example.com/$side",
      'workspace_id' => $this->fixture($side, 'bb_workspace')->id(),
      'owner_user_id' => $this->leads[$side]->id(),
    ]);
    self::assertInstanceOf(BbWebhookInterface::class, $webhook);
    return $webhook;
  }

  /**
   * Violation messages of a webhook validated as an account.
   *
   * @return array<string>
   *   The messages.
   */
  protected function violations(BbWebhookInterface $webhook, ?UserInterface $account = NULL): array {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($account ?? $this->leads['a']);
    try {
      $messages = [];
      foreach ($webhook->validate() as $violation) {
        $messages[] = (string) $violation->getMessage();
      }
      return $messages;
    }
    finally {
      $switcher->switchBack();
    }
  }

}
