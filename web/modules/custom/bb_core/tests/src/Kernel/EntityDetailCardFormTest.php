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
use Symfony\Component\Routing\Route;

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
      'owner_user_id' => $this->owner->id(),
      'max_parallel' => 4,
    ]);
    self::assertInstanceOf(BbMachineInterface::class, $machine);
    $machine->save();
    $this->machine = $machine;
    $this->setCurrentUser($this->owner);
  }

  /**
   * A machine is edited on one card: name and capacity, the rest read-only.
   */
  public function testMachineEditsNameAndCapacityOnOneCard(): void {
    [$identity] = $this->open('identity');
    self::assertArrayHasKey('name', $identity);
    self::assertArrayHasKey('max_parallel', $identity);
    self::assertArrayNotHasKey('current_load', $identity);
    self::assertArrayHasKey('submit', $identity['actions']);
    self::assertStringContainsString((string) $this->machine->uuid(), $this->readOnlyText($identity));
    self::assertStringContainsString('Current load', $this->readOnlyText($identity));
    self::assertSame(['identity'], BbEntityDetailCardForm::operations('bb_machine'));
  }

  /**
   * A save applies only the card's changed fields onto the stored entity.
   */
  public function testSaveKeepsChangesMadeElsewhereSinceOpening(): void {
    [$form, $state, $builder] = $this->open('identity');
    $this->machine->set('max_parallel', 9)->save();
    $this->post($form, $state);
    $state->setValue('name', [['value' => 'Renamed']]);
    $state->setValue('max_parallel', [['value' => 4]]);

    $entity = $builder->buildEntity($form, $state);

    self::assertSame('Renamed', $entity->label());
    self::assertSame(9, (int) $entity->get('max_parallel')->value);
  }

  /**
   * A rename announces itself once and retitles the routed entity.
   *
   * The page around a native POST titles the request's entity, so the saved
   * one replaces it there. A save that keeps the label announces nothing.
   */
  public function testRenameAnnouncesOnceAndRetitlesTheRoutedEntity(): void {
    [$form, $state, $builder] = $this->open('identity');
    $this->post($form, $state);
    $state->setValue('name', [['value' => 'Renamed']]);
    $state->setValue('max_parallel', [['value' => 4]]);
    $builder->validateForm($form, $state);
    $builder->submitForm($form, $state);
    $builder->save($form, $state);

    $routed = $this->container->get('request_stack')->getCurrentRequest()->attributes->get('bb_machine');
    self::assertSame('Renamed', $routed?->label());
    self::assertSame([['HX-Trigger', BbEntityDetailCardForm::RENAMED_EVENT]], $builder->form([], $state)['#attached']['http_header'] ?? NULL);
    self::assertArrayNotHasKey('http_header', $builder->form([], $state)['#attached'] ?? [], 'A later answer of the same card announces nothing.');

    $this->container->get('request_stack')->getCurrentRequest()->setMethod('GET');
    [$form, $state, $builder] = $this->open('identity');
    $this->post($form, $state);
    $state->setValue('name', [['value' => 'Renamed']]);
    $state->setValue('max_parallel', [['value' => 5]]);
    $builder->validateForm($form, $state);
    $builder->submitForm($form, $state);
    $builder->save($form, $state);
    self::assertArrayNotHasKey('http_header', $builder->form([], $state)['#attached'] ?? [], 'A label-keeping save announces nothing.');
  }

  /**
   * A snapshot opened for one machine cannot be replayed against another.
   */
  public function testSnapshotIsBoundToItsEntity(): void {
    [$alpha, $state] = $this->open('identity');
    $this->machine = $this->machine->createDuplicate();
    $this->machine->save();
    [$beta, , $builder] = $this->open('identity');
    $state->setFormObject($builder);
    $this->post($alpha, $state);
    $state->setValue('max_parallel', [['value' => 2]]);

    $this->expectException(AccessDeniedHttpException::class);
    $builder->buildEntity($beta, $state);
  }

  /**
   * Only cards that edit a field have a POST route; the others only show.
   */
  public function testCardsWithoutEditableFieldsHaveNoPostRoute(): void {
    $routes = $this->container->get('router.route_provider');
    self::assertInstanceOf(Route::class, $routes->getRouteByName('entity.bb_machine.identity_form'));
    self::assertSame([], $routes->getRoutesByNames([
      'entity.bb_project.identity_form',
      'entity.bb_project.properties_form',
      'entity.bb_group.identity_form',
      'entity.bb_group.properties_form',
    ]));
    // Project and group Settings edit them; their detail cards only show.
    foreach (['bb_project', 'bb_group'] as $type) {
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
   * The opening snapshot survives a theme that filters markup from values.
   *
   * A field holding `<b>` or `&` must not change the signed payload on its
   * way through the hidden input, or the card's Save is refused.
   */
  public function testSnapshotCarriesNoMarkupCharacters(): void {
    $this->machine->set('name', 'A <b>bold</b> & "quoted" name')->save();

    [$form] = $this->open('identity');

    self::assertDoesNotMatchRegularExpression('/[<>&"\']/', $form['property_baseline']['#default_value']);
  }

  /**
   * Only registered cards exist.
   */
  public function testUnknownCardIsRefused(): void {
    self::assertNull(BbEntityDetailCardForm::fields('bb_machine', 'settings'));
    self::assertNull(BbEntityDetailCardForm::fields('bb_machine', 'capacity'));
    self::assertSame(['name', 'max_parallel'], BbEntityDetailCardForm::fields('bb_machine', 'identity')['edit']);
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
   * Turns the request into the card's POST with its opening snapshot.
   *
   * @param array<string, mixed> $form
   *   The opened form.
   * @param \Drupal\Core\Form\FormState $state
   *   Its form state.
   */
  private function post(array $form, FormState $state): void {
    $this->container->get('request_stack')->getCurrentRequest()->setMethod('POST');
    $state->setUserInput([
      'form_build_id' => $form['#build_id'],
      'property_baseline' => $form['property_baseline']['#default_value'],
      'property_signature' => $form['property_signature']['#default_value'],
    ]);
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
