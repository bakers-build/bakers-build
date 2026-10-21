<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Form\BbWorkspaceCreateForm;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The gate Create workspace control is one button, not a wrapped pair.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceCreateFormButtonTest extends KernelTestBase {

  use UserCreationTrait;

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
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installConfig(['system', 'user', 'filter', 'bb_core']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->setUpCurrentUser(['uid' => 1]);
    $account = $this->createUser([]);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);
  }

  /**
   * The create form states the bb_button wrapper once.
   */
  public function testCreateWorkspaceStatesTheButtonWrapperOnce(): void {
    $form = $this->container->get('form_builder')->getForm(BbWorkspaceCreateForm::class);
    $wrappers = $form['actions']['submit']['#theme_wrappers'] ?? [];
    self::assertSame(
      ['input__submit__bb_button'],
      array_values(array_filter(
        $wrappers,
        static fn ($wrapper): bool => $wrapper === 'input__submit__bb_button',
      )),
    );
  }

  /**
   * The form survives the form cache an image upload puts it in.
   */
  public function testServicesSurviveTheFormCache(): void {
    $form_object = $this->container->get('class_resolver')->getInstanceFromDefinition(BbWorkspaceCreateForm::class);
    $restored = unserialize(serialize($form_object), ['allowed_classes' => [BbWorkspaceCreateForm::class]]);
    foreach (['provisioner', 'slugDeriver'] as $property) {
      self::assertTrue((new \ReflectionProperty($restored, $property))->isInitialized($restored), "$property is restored.");
    }
  }

}
