<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Access;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\FigureDisclosure;
use Drupal\bb_core\Entity\BbFigure;
use Drupal\bb_core\Entity\BbMeasurement;
use Drupal\bb_core\FigurePermissions;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\Entity\Role;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers generated permissions and direct figure disclosure parity.
 */
#[Group('bb_core')]
final class FigureDisclosureTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine', 'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installConfig(['user']);
    BbMeasurement::create([
      'id' => 'closed_tickets',
      'label' => 'Closed tickets',
      'value_type' => 'integer',
      'unit' => 'tickets',
      'source' => ['entity_type' => 'user', 'time_field' => 'created'],
      'operation' => ['type' => 'count'],
    ])->save();
    BbFigure::create([
      'id' => 'personal_overview',
      'label' => 'Personal overview',
      'widget' => 'matrix',
      'measurements' => ['closed_tickets'],
      'categories' => ['type' => 'windows', 'values' => ['day', 'week', 'month']],
      'filters' => [],
      'context_shape' => ['user'],
      'conditions' => [
        'user' => [
          'id' => 'bb_route_context',
          'entity_type' => 'user',
          'negate' => FALSE,
          'context_mapping' => ['entity' => 'user'],
        ],
      ],
    ])->save();
    Role::create([
      'id' => 'figure_viewer',
      'label' => 'Figure viewer',
    ])->grantPermission('view bakers figure personal_overview')->save();
  }

  /**
   * Every configured figure creates one dependent permission definition.
   */
  public function testFigurePermissionIsGenerated(): void {
    $permissions = (new FigurePermissions($this->container->get('entity_type.manager')))->permissions();
    self::assertArrayHasKey('view bakers figure personal_overview', $permissions);
    self::assertSame(
      ['bb_core.bb_figure.personal_overview'],
      $permissions['view bakers figure personal_overview']['dependencies']['config'],
    );
  }

  /**
   * Direct disclosure applies the same permission, Conditions, and shape gate.
   */
  public function testDirectDisclosureMatchesDiscoveryRules(): void {
    $target = $this->accountEntity('target');
    $figure = BbFigure::load('personal_overview');
    self::assertNotNull($figure);
    $allowed = $this->account(TRUE, (int) $target->id());
    $denied = $this->account(FALSE);
    $disclosure = $this->container->get('bb_core.figure_disclosure');
    self::assertInstanceOf(FigureDisclosure::class, $disclosure);

    self::assertTrue($disclosure->mayView($allowed, $figure, ['user' => $target]));
    self::assertFalse($disclosure->mayView($denied, $figure, ['user' => $target]));
    self::assertFalse($disclosure->mayView($allowed, $figure, []));
    self::assertFalse($disclosure->mayView($allowed, $figure, ['user' => $target, 'extra' => $target]));
  }

  /**
   * A global permission does not disclose another user's private context.
   */
  public function testDirectDisclosureKeepsSelfAsContextFence(): void {
    $target = $this->accountEntity('private-target');
    $figure = BbFigure::load('personal_overview');
    self::assertNotNull($figure);
    $disclosure = $this->container->get('bb_core.figure_disclosure');
    self::assertInstanceOf(FigureDisclosure::class, $disclosure);

    self::assertFalse($disclosure->mayView($this->account(TRUE), $figure, ['user' => $target]));
  }

  /**
   * Self context does not replace the generated per-figure permission.
   */
  public function testDirectDisclosureDeniesSelfWithoutFigurePermission(): void {
    $target = $this->accountEntity('self-without-figure-permission');
    $figure = BbFigure::load('personal_overview');
    self::assertNotNull($figure);
    $disclosure = $this->container->get('bb_core.figure_disclosure');
    self::assertInstanceOf(FigureDisclosure::class, $disclosure);

    self::assertFalse($disclosure->mayView(
      $this->account(FALSE, (int) $target->id()),
      $figure,
      ['user' => $target],
    ));
  }

  /**
   * Creates an account mock with a fixed permission result.
   */
  private function account(bool $allowed, int $id = 99): AccountInterface {
    $account = $this->createMock(AccountInterface::class);
    $account->method('hasPermission')->willReturn($allowed);
    $account->method('getRoles')->willReturn($allowed ? ['figure_viewer'] : []);
    $account->method('id')->willReturn($id);
    return $account;
  }

  /**
   * Creates and saves a user account entity.
   */
  private function accountEntity(string $name): UserInterface {
    $entity = $this->container->get('entity_type.manager')->getStorage('user')->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $entity);
    $entity->save();
    return $entity;
  }

}
