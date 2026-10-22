<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\file\Entity\File;
use Drupal\Tests\user\Traits\UserCreationTrait;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Projects, groups and workspaces carry an optional description and image.
 *
 * Pins the field contract — multiline plain text of at most 280 characters
 * and a single, optional, private raster image.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectGroupIdentityTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'og', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'file', 'og_membership', 'bb_workspace', 'bb_group',
      'bb_team', 'bb_project', 'bb_environment',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
  }

  /**
   * The two entity types and their image directories.
   *
   * @return array<string, array{string, string}>
   *   Entity type id and file directory.
   */
  public static function entityTypes(): array {
    return [
      'project' => ['bb_project', 'project-images'],
      'group' => ['bb_group', 'group-images'],
      'workspace' => ['bb_workspace', 'workspace-images'],
    ];
  }

  /**
   * The description is optional multiline plain text of at most 280 characters.
   */
  #[DataProvider('entityTypes')]
  public function testDescriptionIsShortOptionalPlainText(string $entity_type_id): void {
    $entity = $this->createSubject($entity_type_id);
    $definition = $entity->getFieldDefinition('description');
    self::assertSame('string_long', $definition->getType());
    self::assertFalse($definition->isRequired());

    $entity->set('description', str_repeat('é', 280));
    self::assertCount(0, $entity->get('description')->validate());
    $entity->set('description', str_repeat('é', 281));
    $violations = $entity->get('description')->validate();
    self::assertCount(1, $violations);
    self::assertSame('Description: may not be longer than 280 characters.', (string) $violations->get(0)->getMessage(), 'The message names the field.');
    $entity->set('description', '');
    self::assertCount(0, $entity->get('description')->validate());

    // Line breaks and markup are stored as the literal text they are.
    $entity->set('description', "Line one\nLine two <b>x</b>");
    $entity->save();
    $reloaded = $this->container->get('entity_type.manager')->getStorage($entity_type_id)->loadUnchanged($entity->id());
    self::assertInstanceOf(ContentEntityInterface::class, $reloaded);
    self::assertSame("Line one\nLine two <b>x</b>", $reloaded->get('description')->value);
  }

  /**
   * The image is one optional private raster file, without alt or crop.
   */
  #[DataProvider('entityTypes')]
  public function testImageIsOneOptionalPrivateRasterFile(string $entity_type_id, string $directory): void {
    $definition = $this->createSubject($entity_type_id)->getFieldDefinition('image');
    self::assertSame('image', $definition->getType());
    self::assertFalse($definition->isRequired());
    self::assertSame(1, $definition->getFieldStorageDefinition()->getCardinality());
    self::assertSame('private', $definition->getSetting('uri_scheme'));
    self::assertSame($directory, $definition->getSetting('file_directory'));
    self::assertSame('png gif jpg jpeg webp', $definition->getSetting('file_extensions'));
    self::assertSame('2 MB', $definition->getSetting('max_filesize'));
    self::assertFalse($definition->getSetting('alt_field'));
    self::assertFalse($definition->getSetting('title_field'));
  }

  /**
   * A file that is not a readable image is refused on attach, on any path.
   */
  #[DataProvider('entityTypes')]
  public function testNonImageFileIsRefusedOnAttach(string $entity_type_id): void {
    // File reference access is not the subject here.
    $this->setUpCurrentUser([], [], TRUE);
    $entity = $this->createSubject($entity_type_id);
    file_put_contents('public://not-an-image.png', 'plain text, not a PNG');
    $text = File::create(['uri' => 'public://not-an-image.png', 'status' => 1]);
    $text->save();
    $entity->set('image', $text->id());
    $refused = $entity->get('image')->validate();
    self::assertCount(1, $refused, (string) $refused);
    self::assertStringContainsString('The image file is invalid', (string) $refused->get(0)->getMessage());

    file_put_contents('public://pixel.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
    $png = File::create(['uri' => 'public://pixel.png', 'status' => 1]);
    $png->save();
    $entity->set('image', $png->id());
    $violations = $entity->get('image')->validate();
    self::assertCount(0, $violations, (string) $violations);

    // A saved image missing on disk does not block the next edit, while a
    // newly attached non-image is still refused.
    $entity->save();
    unlink('public://pixel.png');
    $entity->set('description', 'Edited after the file went missing.');
    $violations = $entity->get('image')->validate();
    self::assertCount(0, $violations, (string) $violations);
    $entity->set('image', $text->id());
    self::assertCount(1, $entity->get('image')->validate());
  }

  /**
   * Creates an unsaved project, group or workspace.
   */
  private function createSubject(string $entity_type_id): ContentEntityInterface {
    $manager = $this->container->get('entity_type.manager');
    $workspace = $manager->getStorage('bb_workspace')->create([
      'name' => 'Identity workspace',
      'slug' => 'identity-' . str_replace('_', '-', $entity_type_id),
    ]);
    $subject = $entity_type_id === 'bb_workspace' ? $workspace : NULL;
    if ($subject instanceof ContentEntityInterface) {
      return $subject;
    }
    $workspace->save();
    $group = $manager->getStorage('bb_group')->create(['name' => 'Identity group', 'workspace_id' => $workspace->id()]);
    if ($entity_type_id === 'bb_project') {
      $group->save();
      $subject = $manager->getStorage('bb_project')->create(['name' => 'Identity project', 'group_id' => $group->id()]);
    }
    $subject ??= $group;
    self::assertInstanceOf(ContentEntityInterface::class, $subject);
    return $subject;
  }

}
