<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_ticket_trigger\Kernel;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\filter\Entity\FilterFormat;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\bb_ticket_trigger\Hook\TicketTriggerHooks;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\user\UserInterface;

/**
 * A two-workspace world with leads, templates and real service accounts.
 *
 * Service accounts are created through ServiceAccountManager, so their
 * marker, memberships and ranks are exactly what the product produces.
 */
trait TicketTriggerTestTrait {

  use WorkspaceReadScopeTestTrait;

  /**
   * The lead (Admin rank) of each side, keyed 'a'/'b'.
   *
   * @var array<string, \Drupal\user\UserInterface>
   */
  private array $leads = [];

  /**
   * Installs the world: schemas, OG, two workspaces, a lead per workspace.
   */
  protected function installTriggerWorld(): void {
    $this->installReadScopeEnvironment();
    foreach (['bb_ticket_trigger', 'consumer', 'oauth2_token'] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installConfig(['bb_api_key', 'simple_oauth']);
    $this->container->get('entity_type.manager')->getStorage('oauth2_scope')->create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'grant_types' => ['client_credentials' => ['status' => TRUE]],
      'umbrella' => TRUE,
    ])->save();
    FilterFormat::create(['format' => 'bb_rich', 'name' => 'bakers.build rich'])->save();
    $this->buildTwoWorkspaceWorld();
    foreach (['a', 'b'] as $side) {
      $template = $this->triggerTemplate($side);
      $template->set('description', ['value' => 'Body', 'format' => 'bb_rich']);
      $template->save();
      $lead = $this->createAccount("lead-$side");
      $this->addMembership($this->fixture($side, 'bb_workspace'), $lead, ['lead']);
      $this->addMembership($this->fixture($side, 'bb_team'), $lead, []);
      $this->leads[$side] = $lead;
    }
  }

  /**
   * The lead of one side.
   */
  protected function lead(string $side): UserInterface {
    return $this->leads[$side];
  }

  /**
   * The template fixture of one side.
   */
  protected function triggerTemplate(string $side): BbTicketTemplateInterface {
    $template = $this->fixture($side, 'bb_ticket_template');
    self::assertInstanceOf(BbTicketTemplateInterface::class, $template);
    return $template;
  }

  /**
   * Creates a service account of one side through the product's manager.
   *
   * @param string $side
   *   The workspace side.
   * @param string $rank
   *   The workspace rank: 'contributor' or 'guest'.
   */
  protected function serviceAccount(string $side, string $rank = 'contributor'): UserInterface {
    $workspace = $this->fixture($side, 'bb_workspace');
    $team = $this->fixture($side, 'bb_team');
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $expiry = (new \DateTimeImmutable('+30 days'))->format('Y-m-d');
    $result = $this->serviceAccounts()->create($workspace, $team, "bot-$side-$rank", $rank, 'member', $expiry, $this->lead($side));
    return $result['user'];
  }

  /**
   * The service-account manager.
   */
  protected function serviceAccounts(): ServiceAccountManager {
    $manager = $this->container->get(ServiceAccountManager::class);
    self::assertInstanceOf(ServiceAccountManager::class, $manager);
    return $manager;
  }

  /**
   * Builds an unsaved monthly trigger on a side's template.
   *
   * @param string $side
   *   The workspace side.
   * @param array<string, mixed> $values
   *   Field values overriding the defaults.
   */
  protected function newTrigger(string $side, array $values = []): BbTicketTriggerInterface {
    $trigger = $this->container->get('entity_type.manager')->getStorage('bb_ticket_trigger')->create($values + [
      'bundle' => 'template',
      'workspace_id' => $this->fixture($side, 'bb_workspace')->id(),
      'template_id' => $this->triggerTemplate($side)->id(),
      'trigger_type' => [
        'plugin_id' => 'schedule',
        'plugin_configuration' => [
          'frequency' => 'monthly',
          'day' => '1',
          'time' => '09:00',
          'timezone' => 'Europe/Berlin',
        ],
      ],
      'enabled' => FALSE,
    ]);
    self::assertInstanceOf(BbTicketTriggerInterface::class, $trigger);
    return $trigger;
  }

  /**
   * Freezes `datetime.time` at a UTC instant for every service built after.
   */
  protected function freezeTriggerTime(string $instant): void {
    $timestamp = (new \DateTimeImmutable($instant))->getTimestamp();
    $time = $this->createMock(TimeInterface::class);
    $time->method('getCurrentTime')->willReturn($timestamp);
    $time->method('getRequestTime')->willReturn($timestamp);
    $this->container->set('datetime.time', $time);
    foreach (['bb_core.ticket_template_instantiator', 'bb_ticket_trigger.runner', TicketTriggerHooks::class] as $service) {
      $this->container->set($service, NULL);
    }
  }

  /**
   * Violation messages of an entity validated as an account.
   *
   * @return array<string>
   *   The messages.
   */
  protected function triggerViolations(BbTicketTriggerInterface $trigger, ?UserInterface $account = NULL): array {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($account ?? $this->lead('a'));
    try {
      $messages = [];
      foreach ($trigger->validate() as $violation) {
        $messages[] = (string) $violation->getMessage();
      }
      return $messages;
    }
    finally {
      $switcher->switchBack();
    }
  }

}
