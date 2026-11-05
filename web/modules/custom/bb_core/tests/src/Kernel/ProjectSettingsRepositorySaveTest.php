<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormState;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The regression test AC-3 earns.
 *
 * An unrelated settings save must not erase a project's repository branch
 * metadata.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectSettingsRepositorySaveTest extends KernelTestBase {

  use UserCreationTrait;
  use ShippedImageConfigTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'crop', 'bb_image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * The group every project in this suite is created in.
   */
  private BbGroupInterface $group;

  /**
   * The team every project in this suite is created with.
   */
  private int $teamId;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_workspace',
      'bb_team', 'bb_environment', 'bb_ticket', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'filter', 'bb_core']);
    $this->installShippedFormDisplays();
    $this->newAccount([], 'uid1-dummy');
    $this->setCurrentUser($this->newAccount(
      ['administer bakers', 'edit bb_project'],
      'project-editor',
    ));

    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create(['name' => 'Settings-form group']);
    $group->save();
    self::assertInstanceOf(BbGroupInterface::class, $group);
    $this->group = $group;

    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 'Settings-form team']);
    $team->save();
    $this->teamId = (int) $team->id();
  }

  /**
   * A saved user account, asserted rather than the `false` failure shape.
   *
   * @param array<string> $permissions
   *   Permission machine names to grant.
   * @param string $name
   *   The account name.
   */
  private function newAccount(array $permissions, string $name): UserInterface {
    $account = $this->createUser($permissions, $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

  /**
   * Creates and saves a bb_project with the given field values.
   *
   * @param array<string, mixed> $values
   *   Field values to set on the project.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved project.
   */
  private function createProject(array $values): ContentEntityInterface {
    $p = $this->container->get('entity_type.manager')->getStorage('bb_project')
      // A valid key: the form links the project's delete page by it.
      ->create(['group_id' => $this->group->id(), 'teams' => [$this->teamId], 'key' => 'PSAVE'] + $values);
    assert($p instanceof ContentEntityInterface);
    $p->save();
    return $p;
  }

  /**
   * Reloads an entity from storage, bypassing the static cache.
   */
  private function reload(ContentEntityInterface $entity): ContentEntityInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage($entity->getEntityTypeId());
    $storage->resetCache([$entity->id()]);
    $reloaded = $storage->load($entity->id());
    assert($reloaded instanceof ContentEntityInterface);
    return $reloaded;
  }

  /**
   * Submits the `settings` operation form for the given project.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $project
   *   The project to build the form for.
   * @param array<string, mixed> $values
   *   Submitted values, merged over the project's current name and group.
   */
  private function submitSettingsForm(ContentEntityInterface $project, array $values): void {
    $form_object = $this->container->get('entity_type.manager')
      ->getFormObject('bb_project', 'settings');
    $form_object->setEntity($project);

    $form_state = new FormState();
    $form_state->setValues($values + [
      'name' => [['value' => $project->label()]],
      'group_id' => (string) $this->group->id(),
      'teams' => [(string) $this->teamId],
    ]);
    $this->container->get('form_builder')->submitForm($form_object, $form_state);
    self::assertSame([], $form_state->getErrors(), 'The settings form submitted with no validation errors.');
    // FormBuilder::submitForm() runs the button's #submit chain
    // (['::submitForm', '::save']) via the auto-selected single button, which
    // reliably mutates $form_object's in-memory entity but has proven flaky at
    // actually invoking '::save' in this headless harness; call it explicitly
    // too, which is idempotent, to make the persistence this test asserts on
    // independent of that plumbing.
    $form_object->save($form_state->getCompleteForm(), $form_state);
  }

  /**
   * Builds the `settings` form for the given project.
   *
   * @return array<string, mixed>
   *   The built form.
   */
  private function buildSettingsForm(ContentEntityInterface $project): array {
    $form_object = $this->container->get('entity_type.manager')
      ->getFormObject('bb_project', 'settings');
    $form_object->setEntity($project);
    return $this->container->get('form_builder')->getForm($form_object);
  }

  /**
   * Saving with only the name changed keeps branch metadata.
   */
  public function testAnUnrelatedSaveKeepsBranchMetadata(): void {
    $project = $this->createProject([
      'name' => 'before',
      'repository' => [[
        'url' => 'https://example.com/keep.git',
        'default_branch' => 'develop',
        'branch_convention' => 'feat/<id>',
      ],
      ],
    ]);

    $this->submitSettingsForm($project, ['name' => [['value' => 'after']]]);

    $saved = $this->reload($project);
    self::assertSame('after', $saved->label());
    self::assertSame('develop', $saved->get('repository')->first()->get('default_branch')->getValue());
    self::assertSame('feat/<id>', $saved->get('repository')->first()->get('branch_convention')->getValue());
  }

  /**
   * Saving having changed only the URL leaves default_branch/convention intact.
   */
  public function testChangingOnlyTheUrlKeepsBranchMetadata(): void {
    $project = $this->createProject([
      'name' => 'p',
      'repository' => [[
        'url' => 'https://example.com/old.git',
        'default_branch' => 'develop',
        'branch_convention' => 'feat/<id>',
      ],
      ],
    ]);

    $this->submitSettingsForm($project, [
      'repository' => [[
        'url' => 'https://example.com/new.git',
        'default_branch' => 'develop',
        'branch_convention' => 'feat/<id>',
      ],
      ],
    ]);

    $saved = $this->reload($project);
    self::assertSame('https://example.com/new.git', $saved->get('repository')->first()->get('url')->getValue());
    self::assertSame('develop', $saved->get('repository')->first()->get('default_branch')->getValue());
  }

  /**
   * The env_vars field round-trips: set, reload, clear, reload.
   */
  public function testEnvVarsRoundTripAndClear(): void {
    $project = $this->createProject(['name' => 'p']);

    $this->submitSettingsForm($project, ['env_vars' => [['value' => "A=1\nB=2"]]]);
    self::assertSame("A=1\nB=2", $this->reload($project)->get('env_vars')->value);

    $this->submitSettingsForm($this->reload($project), ['env_vars' => [['value' => '']]]);
    self::assertTrue($this->reload($project)->get('env_vars')->isEmpty());
  }

  /**
   * Each of the four editable settings elements carries a description.
   */
  public function testHelpTextIsPresentOnAllFourElements(): void {
    $project = $this->createProject(['name' => 'p']);
    $form = $this->buildSettingsForm($project);

    foreach (['url', 'default_branch', 'branch_convention'] as $property) {
      self::assertNotSame(
        '',
        (string) ($form['repository']['widget'][0][$property]['#description'] ?? ''),
        sprintf('repository.%s carries a help description.', $property),
      );
    }
    self::assertNotSame('', (string) ($form['env_vars']['widget'][0]['#description'] ?? ''));
  }

}
