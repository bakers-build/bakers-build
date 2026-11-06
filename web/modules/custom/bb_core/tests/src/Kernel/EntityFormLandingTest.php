<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Saving a content entity's edit form lands on a product page.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EntityFormLandingTest extends KernelTestBase {

  use UserCreationTrait {
    createUser as private;
  }
  use WorkspaceReadScopeTestTrait;

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
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->installConfig(['system', 'filter']);
    $this->buildTwoWorkspaceWorld();
    $this->fixture('a', 'bb_workspace')->set('slug', 'bakers')->save();
    $this->setCurrentUser($this->createAccount('site-admin', ['administer bakers']));
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * The edited types and where their save lands.
   *
   * @return array<string, array{string, string}>
   *   The entity type, and the fixture whose canonical page it lands on.
   */
  public static function landings(): array {
    return [
      'bb_team' => ['bb_team', 'bb_team'],
      'bb_group' => ['bb_group', 'bb_group'],
      'bb_project' => ['bb_project', 'bb_project'],
      'bb_ticket' => ['bb_ticket', 'bb_ticket'],
      'bb_run' => ['bb_run', 'bb_run'],
      'bb_comment' => ['bb_comment', 'bb_ticket'],
    ];
  }

  /**
   * Save redirects to the entity's page (a comment: its ticket).
   */
  #[DataProvider('landings')]
  public function testSaveLandsInTheProduct(string $type, string $landing): void {
    $form_object = $this->container->get('entity_type.manager')
      ->getFormObject($type, 'edit')
      ->setEntity($this->fixture('a', $type));
    $form_state = new FormState();

    $this->container->get('form_builder')->submitForm($form_object, $form_state);

    self::assertSame([], array_map('strval', $form_state->getErrors()));
    $redirect = $form_state->getRedirect();
    self::assertNotNull($redirect);
    self::assertSame($this->fixture('a', $landing)->toUrl()->toString(), $redirect->toString());
  }

}
