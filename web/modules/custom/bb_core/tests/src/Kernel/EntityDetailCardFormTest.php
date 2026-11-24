<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Render\Element;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Form\BbEntityDetailCardForm;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Detail cards save their own fields only, onto fresh data.
 *
 * The machine is the subject because it has no workspace tenancy; the save
 * mechanics are shared by every card.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EntityDetailCardFormTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * Machine owner who may edit it.
   */
  private UserInterface $owner;

  /**
   * The machine under test.
   */
  private BbMachineInterface $machine;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'bb_machine', 'og_membership'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user', 'system']);
    $this->container->get('router.builder')->rebuild();
    $this->account('uid1-dummy', []);
    $this->owner = $this->account('card-owner', ['view own bb_machine', 'update own bb_machine']);
    $machine = $this->container->get('entity_type.manager')->getStorage('bb_machine')->create([
      'name' => 'Alpha',
      'host_key' => 'host-alpha',
      'owner_user_id' => $this->owner->id(),
      'max_parallel' => 4,
    ]);
    self::assertInstanceOf(BbMachineInterface::class, $machine);
    $machine->save();
    $this->machine = $machine;
    $this->setCurrentUser($this->owner);
  }

  /**
   * The owner reads a machine on one card; its Settings edit it.
   */
  public function testMachineCardOnlyShowsItsOwner(): void {
    [$identity] = $this->open('identity');
    foreach (['name', 'max_parallel', 'assignment', 'current_load'] as $field) {
      self::assertArrayNotHasKey($field, $identity);
    }
    self::assertEmpty($identity['actions'] ?? [], 'No Save and no Delete on the card.');
    foreach (['Alpha', 'Max parallel', 'Assignment', 'host-alpha', 'Current load'] as $text) {
      self::assertStringContainsString($text, $this->readOnlyText($identity));
    }
    self::assertSame(['identity'], BbEntityDetailCardForm::operations('bb_machine'));
  }

  /**
   * Connection addresses use the existing copyable link cell, never an input.
   */
  public function testMachineConnectionLink(): void {
    foreach (['ssh://user@[::1]:2222', 'https://host/path?q=value', NULL] as $url) {
      $this->machine->set('connection_url', $url)->save();
      [$form] = $this->open('identity');
      self::assertArrayNotHasKey('connection_url', $form);
      $rows = $form['readonly']['#props']['items'];
      $matches = array_values(array_filter($rows, static fn (array $row): bool => $row['cells']['label']['value'] === 'Connection URL'));
      self::assertCount(1, $matches);
      $expected = $url === NULL
        ? ['kind' => 'text', 'value' => '—', 'emphasis' => 'faint']
        : ['kind' => 'link', 'value' => $url, 'url' => $url, 'external' => TRUE];
      self::assertSame($expected, $matches[0]['cells']['value']);
    }
  }

  /**
   * Cards without editable fields have no POST route; Settings edit instead.
   */
  public function testCardsWithoutEditableFieldsHaveNoPostRoute(): void {
    $routes = $this->container->get('router.route_provider');
    self::assertSame([], $routes->getRoutesByNames([
      'entity.bb_project.identity_form',
      'entity.bb_project.properties_form',
      'entity.bb_group.identity_form',
      'entity.bb_group.properties_form',
      'entity.bb_machine.identity_form',
      'entity.bb_conductor.identity_form',
    ]));
    // Their Settings edit them; their detail cards only show.
    foreach (['bb_project', 'bb_group', 'bb_machine', 'bb_conductor'] as $type) {
      foreach (BbEntityDetailCardForm::operations($type) as $operation) {
        self::assertSame([], BbEntityDetailCardForm::fields($type, $operation)['edit']);
      }
    }
    self::assertSame(['name', 'workspace_id', 'owner_user_id'], BbEntityDetailCardForm::fields('bb_group', 'properties')['show']);
    $settings = $routes->getRouteByName('bb_core.bb_group.settings');
    self::assertSame('bb_group.settings', $settings->getDefault('_entity_form'));
    self::assertNull($settings->getDefault('_controller'));
  }

  /**
   * A reader sees read-only values, no Save, and cannot post.
   */
  public function testReaderGetsReadOnlyCardAndForgedPostIsRefused(): void {
    $reader = $this->account('card-reader', ['view own bb_machine']);
    $this->machine->set('owner_user_id', $reader->id())->save();
    $this->setCurrentUser($reader);

    [$form] = $this->open('identity');
    self::assertArrayNotHasKey('name', $form);
    self::assertArrayNotHasKey('max_parallel', $form);
    self::assertEmpty($form['actions'] ?? []);
    self::assertStringContainsString('Alpha', $this->readOnlyText($form));

    $this->container->get('request_stack')->getCurrentRequest()->setMethod('POST');
    $this->expectException(AccessDeniedHttpException::class);
    $this->open('identity');
  }

  /**
   * A reference shows its target's name where only the label is visible.
   *
   * The reader may see this machine but not open its owner's account; the
   * Owner row still names the owner, as core's label formatter does.
   */
  public function testOwnerIsNamedForReaderWhoCannotOpenTheAccount(): void {
    $this->setCurrentUser($this->account('card-viewer', ['view bb_machine']));

    [$form] = $this->open('identity');

    self::assertStringContainsString('card-owner', $this->readOnlyText($form));
  }

  /**
   * Only registered cards exist.
   */
  public function testUnknownCardIsRefused(): void {
    self::assertNull(BbEntityDetailCardForm::fields('bb_machine', 'settings'));
    self::assertNull(BbEntityDetailCardForm::fields('bb_machine', 'capacity'));
    self::assertSame([], BbEntityDetailCardForm::fields('bb_machine', 'identity')['edit']);
  }

  /**
   * Builds a card form as the current user.
   *
   * @return array{0: array<string, mixed>, 1: \Drupal\Core\Form\FormState, 2: \Drupal\bb_core\Form\BbEntityDetailCardForm}
   *   The form, its state and the form object.
   */
  private function open(string $operation): array {
    $builder = $this->container->get('entity_type.manager')->getFormObject('bb_machine', $operation);
    self::assertInstanceOf(BbEntityDetailCardForm::class, $builder);
    $machine = $this->container->get('entity_type.manager')->getStorage('bb_machine')->loadUnchanged($this->machine->id());
    $builder->setEntity($machine);
    $state = new FormState();
    $state->setFormObject($builder);
    $form = $builder->buildForm([], $state);
    return [$form, $state, $builder];
  }

  /**
   * The rendered read-only rows' text.
   *
   * @param array<string, mixed> $form
   *   A card form.
   */
  private function readOnlyText(array $form): string {
    $items = $form['readonly']['#props']['items'] ?? [];
    $text = [];
    foreach ($items as $item) {
      foreach ($item['cells'] as $cell) {
        $text[] = (string) ($cell['value'] ?? '');
      }
    }
    return implode(' ', $text) . ' ' . implode(' ', Element::children($form));
  }

  /**
   * A user with the given permissions through a dedicated role.
   *
   * @param string $name
   *   Account name.
   * @param array<string> $permissions
   *   Permission names.
   */
  private function account(string $name, array $permissions): UserInterface {
    $role = 'r_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role, 'label' => $role])->save();
    if ($permissions !== []) {
      user_role_grant_permissions($role, $permissions);
    }
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role]]);
    self::assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

}
