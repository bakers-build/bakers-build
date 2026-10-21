<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Routing\RouteMatch;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_activity\Entity\NotificationSettingInterface;
use Drupal\bb_activity\Form\NotificationSettingsForm;
use Drupal\bb_activity\NotificationSettings;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The settings page belongs to its account and to administrators.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class NotificationSettingsPageTest extends KernelTestBase {

  use UserCreationTrait;

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
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('bb_notification_setting');
    $this->installEntitySchema('og_membership');
    $this->installConfig(['system', 'user']);
    $this->createUser([], 'root');
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Own account and administrators pass; another member and anonymous do not.
   */
  public function testOnlyTheAccountItselfOrAnAdministratorOpensThePage(): void {
    $owner = $this->account('owner');
    $other = $this->account('other');
    $admin = $this->account('admin', ['administer bakers']);
    $url = Url::fromRoute('bb_activity.notifications', ['user' => $owner->id()]);
    self::assertTrue($url->access($owner));
    self::assertFalse($url->access($other));
    self::assertTrue($url->access($admin));
    self::assertFalse($url->access(new AnonymousUserSession()));
  }

  /**
   * The page offers one group: a checkbox per mailed kind, described by it.
   */
  public function testThePageOffersOneCheckboxPerMailedKind(): void {
    $owner = $this->account('owner');
    $this->setCurrentUser($owner);
    $form = $this->container->get('form_builder')->getForm($this->formFor($owner));
    $groups = array_filter($form['ticks'], static fn ($element): bool => is_array($element) && ($element['#type'] ?? '') === 'checkboxes');
    self::assertSame(['activity_mails'], array_keys($groups));
    $group = $form['ticks']['activity_mails'];
    self::assertSame('Activity mails', (string) $group['#title']);
    self::assertSame(
      ['test_broken', 'assigned', 'review_requested', 'review_completed', 'test_default_on', 'test_ticket_event'],
      array_keys($group['#options']),
    );
    self::assertSame('Ticket assigned', (string) $group['#options']['assigned']);
    self::assertSame('A ticket is assigned to you.', (string) $group['assigned']['#description']);
    self::assertSame('A review you asked for is submitted.', (string) $group['review_completed']['#description']);
  }

  /**
   * Saving stores exactly the ticked message IDs.
   */
  public function testSavingStoresTheTickedMessages(): void {
    $owner = $this->account('owner');
    $this->setCurrentUser($owner);
    $this->submit($owner, ['activity_mails' => ['assigned', 'test_ticket_event']]);
    self::assertSame(['assigned', 'test_ticket_event'], $this->sorted($this->row($owner)->ticked()));
  }

  /**
   * An administrator's save changes the page's account, not their own.
   */
  public function testAnAdministratorSavesTheOtherAccountsRow(): void {
    $owner = $this->account('owner');
    $admin = $this->account('admin', ['administer bakers']);
    $this->setCurrentUser($admin);
    $this->submit($owner, ['activity_mails' => ['test_ticket_event']]);
    self::assertSame(['test_ticket_event'], $this->row($owner)->ticked());
    // The admin chose nothing, so the admin has no row.
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_notification_setting')->loadByProperties(['user_id' => $admin->id()]));
  }

  /**
   * A stored ID of a removed kind neither breaks the page nor survives.
   */
  public function testStoredChoiceWhoseKindIsGoneDoesNotBreakThePage(): void {
    $owner = $this->account('owner');
    // save() does not validate, which is how a stale value stays stored.
    $this->container->get(NotificationSettings::class)->ensure((int) $owner->id())
      ->set('messages', ['gone', 'test_ticket_event'])
      ->save();
    $this->setCurrentUser($owner);
    $this->submit($owner, ['activity_mails' => ['test_ticket_event']]);
    self::assertSame(['test_ticket_event'], $this->row($owner)->ticked());
  }

  /**
   * Opening the page for an account without a row writes nothing.
   */
  public function testOpeningThePageWritesNothing(): void {
    $owner = $this->account('owner');
    $form = $this->formFor($owner);
    self::assertTrue($form->getEntity()->isNew());
    self::assertNull($this->container->get(NotificationSettings::class)->forUser((int) $owner->id()));
  }

  /**
   * Creates an account, without a settings row until it saves the page.
   *
   * @param string $name
   *   The account name.
   * @param array<string> $permissions
   *   Extra permissions.
   */
  private function account(string $name, array $permissions = []): UserInterface {
    $account = $this->createUser($permissions, $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

  /**
   * The account's row, fresh from storage.
   */
  private function row(UserInterface $account): NotificationSettingInterface {
    $this->container->get('entity_type.manager')->getStorage('bb_notification_setting')->resetCache();
    $row = $this->container->get(NotificationSettings::class)->forUser((int) $account->id());
    self::assertNotNull($row);
    return $row;
  }

  /**
   * The settings form as the route builds it for the account.
   */
  private function formFor(UserInterface $account): NotificationSettingsForm {
    $form = $this->container->get('entity_type.manager')->getFormObject('bb_notification_setting', 'default');
    self::assertInstanceOf(NotificationSettingsForm::class, $form);
    $route = $this->container->get('router.route_provider')->getRouteByName('bb_activity.notifications');
    $route_match = new RouteMatch('bb_activity.notifications', $route, ['user' => $account], ['user' => (string) $account->id()]);
    $form->setEntity($form->getEntityFromRouteMatch($route_match, 'bb_notification_setting'));
    return $form;
  }

  /**
   * Submits the account's page programmatically.
   *
   * @param \Drupal\user\UserInterface $account
   *   The page's account.
   * @param array<string, list<string>> $ticks
   *   Ticked message IDs keyed by group element.
   */
  private function submit(UserInterface $account, array $ticks): void {
    // A programmatic submit falls back to the default of a group it does not
    // name, so the group is always named; unticked it is empty.
    $ids = $ticks['activity_mails'] ?? [];
    $values = ['activity_mails' => array_combine($ids, $ids)];
    $form_state = (new FormState())->setValues([
      'ticks' => $values,
      'op' => 'Save notification settings',
    ]);
    $this->container->get('form_builder')->submitForm($this->formFor($account), $form_state);
    self::assertSame([], $form_state->getErrors());
  }

  /**
   * A sorted copy.
   *
   * @param list<string> $values
   *   The values.
   *
   * @return list<string>
   *   The values, sorted.
   */
  private function sorted(array $values): array {
    sort($values);
    return $values;
  }

}
