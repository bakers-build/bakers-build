<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_ticket_trigger\Kernel;

use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\bb_core\TicketTemplate\TemplateNotFoundException;
use Drupal\bb_ticket_trigger\TicketTrigger\BbTicketTriggerTargetInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The `template` trigger target: field, tenancy, access and preflight.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TemplateTriggerTargetTest extends KernelTestBase {

  use TicketTriggerTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'system', 'user', 'serialization', 'options', 'entity',
    'state_machine', 'link', 'text', 'filter', 'markdown_easy', 'field', 'og',
    'plugin', 'consumers', 'simple_oauth', 'views', 'island', 'bb_core',
    'bb_api_key', 'bb_ticket_trigger',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installTriggerWorld();
    $this->freezeTriggerTime('2026-10-20T00:00:00Z');
  }

  /**
   * The template target plugin.
   */
  private function target(): BbTicketTriggerTargetInterface {
    $target = $this->container->get('plugin.manager.bb_ticket_trigger_target')->createInstance('template');
    self::assertInstanceOf(BbTicketTriggerTargetInterface::class, $target);
    return $target;
  }

  /**
   * The target builds one required reference to the template.
   */
  public function testBuildsTheTemplateReference(): void {
    $fields = $this->target()->buildFieldDefinitions();
    $this->assertSame(['template_id'], array_keys($fields));
    $field = $fields['template_id'];
    $this->assertInstanceOf(BaseFieldDefinition::class, $field);
    $this->assertSame('entity_reference', $field->getType());
    $this->assertSame('bb_ticket_template', $field->getSetting('target_type'));
    $this->assertTrue($field->isRequired());
  }

  /**
   * The target resolves the template, its workspace and readable IDs.
   */
  public function testResolvesTargetWorkspaceAndReadableIds(): void {
    $trigger = $this->newTrigger('a');
    $target = $this->target();
    $this->assertSame($this->triggerTemplate('a')->id(), $target->getTarget($trigger)?->id());
    $this->assertSame($this->fixture('a', 'bb_workspace')->id(), $target->getWorkspace($trigger)?->id());

    $readable = $target->readableTargetIds($this->member('b'));
    $this->assertNotContains($this->triggerTemplate('a')->id(), $readable);
    $this->assertContains($this->triggerTemplate('a')->id(), $target->readableTargetIds($this->lead('a')));
  }

  /**
   * Viewing follows template view; changing follows template update.
   */
  public function testAccessDelegatesToTheTemplate(): void {
    $trigger = $this->newTrigger('a');
    $target = $this->target();
    $contributor = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $contributor, ['contributor']);
    $this->addMembership($this->fixture('a', 'bb_team'), $contributor, []);

    $this->assertTrue($target->access($trigger, 'update', $this->lead('a'))->isAllowed());
    $this->assertFalse($target->access($trigger, 'update', $this->lead('b'))->isAllowed());
    $this->assertTrue($target->access($trigger, 'view', $contributor)->isAllowed());
    $this->assertFalse($target->access($trigger, 'update', $contributor)->isAllowed());
  }

  /**
   * Preflight names why an account cannot create tickets from the template.
   */
  public function testPreflightRejectsGuestRankAccount(): void {
    $trigger = $this->newTrigger('a');
    $target = $this->target();
    $this->assertNotEmpty($target->preflight($trigger, $this->serviceAccount('a', 'guest')));
    $this->assertNull($target->preflight($trigger, $this->serviceAccount('a')));
  }

  /**
   * Template errors are final; anything else is retried.
   */
  public function testClassifiesFailures(): void {
    $target = $this->target();
    $this->assertTrue($target->isPermanentFailure(new TemplateNotFoundException('gone')));
    $this->assertFalse($target->isPermanentFailure(new \RuntimeException('deadlock')));
  }

}
