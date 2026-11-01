<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Mail\Plugin\Mail\SymfonyMailer;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\CollectingMailer;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Plugin\Mail\BbHtmlMail;
use Drupal\bb_activity\NotificationSettings;
use Drupal\user\UserInterface;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;

/**
 * A two-workspace world whose activity mail is collected as it is sent.
 */
abstract class ActivityMailKernelTestBase extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image', 'serialization', 'jsonapi',
    'bb_core', 'bb_activity', 'bb_activity_test',
  ];

  /**
   * Collects what bb_html_mail hands to the transport.
   */
  protected CollectingMailer $transport;

  /**
   * Collects what every channel logs.
   */
  protected CollectingLogger $logs;

  /**
   * {@inheritdoc}
   *
   * A cancelled run's error log is written to the private stream.
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $container->register('stream_wrapper.private', 'Drupal\Core\StreamWrapper\PrivateStream')
      ->addTag('stream_wrapper', ['scheme' => 'private']);
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // Before any account exists: hook_user_insert writes a row per account.
    $this->installEntitySchema('bb_notification_setting');
    $this->installSchema('user', ['users_data']);
    $this->installConfig(['system']);
    $this->installReadScopeEnvironment();
    $this->installEntitySchema('bb_activity');
    // A conductor change cancels the fixture's active run, which writes the
    // run's error log as a file.
    $this->installEntitySchema('file');
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->buildTwoWorkspaceWorld();
    foreach (['a', 'b'] as $side) {
      $this->fixture($side, 'bb_workspace')->set('slug', "ws-$side")->save();
    }
    $this->container->get('router.builder')->rebuild();
    $this->collectMail();
    $this->collectLogs();
  }

  /**
   * A member of one side's workspace and team, with a mail address.
   *
   * @param string $side
   *   Either 'a' or 'b'.
   * @param string $name
   *   The account name; the address is "$name@example.com".
   * @param array<string> $workspace_roles
   *   Workspace OG role names; a guest reads tickets but not runs.
   */
  protected function recipient(string $side, string $name, array $workspace_roles = ['guest']): UserInterface {
    $account = $this->createAccount($name);
    $account->setEmail($name . '@example.com')->save();
    $this->addMembership($this->fixture($side, 'bb_workspace'), $account, $workspace_roles);
    $this->addMembership($this->fixture($side, 'bb_team'), $account, []);
    return $account;
  }

  /**
   * Replaces the ticked messages of an account.
   *
   * @param \Drupal\user\UserInterface $account
   *   The account.
   * @param list<string> $message_ids
   *   The ticked message IDs, `kind.key`.
   */
  protected function tick(UserInterface $account, array $message_ids): void {
    $this->container->get(NotificationSettings::class)
      ->ensure((int) $account->id())
      ->set('messages', $message_ids)
      ->save();
  }

  /**
   * One side's ticket.
   */
  protected function ticket(string $side): BbTicketInterface {
    $ticket = $this->fixture($side, 'bb_ticket');
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * The mails sent to one account.
   *
   * @return list<\Symfony\Component\Mime\Email>
   *   The mails.
   */
  protected function mailsTo(UserInterface $account): array {
    return array_values(array_filter(
      $this->transport->sent,
      static fn (Email $email): bool => in_array(
        $account->getEmail(),
        array_map(static fn (Address $address): string => $address->getAddress(), $email->getTo()),
        TRUE,
      ),
    ));
  }

  /**
   * Routes mail through bb_html_mail into a collecting transport.
   */
  private function collectMail(): void {
    // KernelTestBase forces the collector backend through a settings
    // override; route through the production default instead.
    $GLOBALS['config']['system.mail']['interface']['default'] = 'bb_html_mail';
    $this->config('system.mail')->set('interface.default', 'bb_html_mail')->save();
    $this->config('system.site')->set('mail', 'noreply@example.com')->set('name', 'bakers.build')->save();
    $this->container->get('config.factory')->reset();
    $this->transport = new CollectingMailer();
    $plugin = $this->container->get('plugin.manager.mail')
      ->getInstance(['module' => 'bb_activity', 'key' => 'activity']);
    self::assertInstanceOf(BbHtmlMail::class, $plugin);
    $transport = $this->transport;
    \Closure::bind(function () use ($transport): void {
      $this->mailer = $transport;
    }, $plugin, SymfonyMailer::class)();
  }

  /**
   * Adds a logger that keeps every record.
   */
  private function collectLogs(): void {
    $this->logs = new CollectingLogger();
    $this->container->get('logger.factory')->addLogger($this->logs);
  }

}
