<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_ticket_trigger\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\DetailActionsTestTrait;
use Drupal\Tests\bb_core\Kernel\ListRowLinkTestTrait;
use Drupal\Tests\bb_core\Kernel\ProjectsViewTestTrait;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A trigger row links to the trigger's detail: Edit, Pause/Resume, Delete.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTriggerDetailTest extends KernelTestBase {

  use TicketTriggerTestTrait;
  use ProjectsViewTestTrait;
  use ListRowLinkTestTrait;
  use DetailActionsTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'system', 'user', 'serialization', 'options', 'entity',
    'state_machine', 'link', 'text', 'filter', 'markdown_easy', 'field', 'og',
    'plugin', 'consumers', 'simple_oauth', 'views', 'better_exposed_filters',
    'ui_patterns', 'ui_patterns_views', 'block', 'ui_patterns_field', 'display_builder', 'display_builder_entity_view', 'display_builder_views', 'island',
    'bb_core', 'bb_api_key', 'bb_ticket_trigger',
  ];

  /**
   * A paused trigger on workspace a's template.
   */
  private BbTicketTriggerInterface $trigger;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installTriggerWorld();
    $this->freezeTriggerTime('2026-10-20T00:00:00Z');
    $this->fixture('a', 'bb_workspace')->set('slug', 'space-a')->save();
    $this->installConfig(['views']);
    $this->installShippedView('views.view.bb_ticket_triggers');
    $this->trigger = $this->newTrigger('a');
    $this->trigger->save();
    $this->container->get('current_user')->setAccount($this->lead('a'));
  }

  /**
   * A row is one link, to the trigger's detail under its template.
   */
  public function testRowIsOneLinkToTheTrigger(): void {
    $template = $this->triggerTemplate('a');
    $detail = '/space-a/ticket-template/' . $template->id() . '/trigger/' . $this->trigger->id();
    self::assertSame($detail, $this->trigger->toUrl()->toString());

    $html = $this->renderListDisplay('bb_ticket_triggers', 'template_list', ['space-a', (string) $template->id()]);

    $this->assertRowsLinkOnlyToTheirDetail($html, [$detail]);
  }

  /**
   * The detail shows condition and state, then Edit, Resume and Delete.
   */
  public function testDetailShowsTheTriggerWithItsActions(): void {
    $detail = $this->trigger->toUrl()->toString();
    $back = '?destination=' . $detail;
    $toggle = Url::fromRoute('entity.bb_ticket_trigger.toggle_form', $this->trigger->toUrl('edit-form')->getRouteParameters())->toString();

    $actions = $this->detailActions('bb_ticket_trigger_actions', $this->trigger);

    self::assertSame(['edit', 'toggle', 'delete'], array_keys($actions));
    self::assertSame($this->trigger->toUrl('edit-form')->toString() . $back, $actions['edit']['#props']['href']);
    self::assertSame('Resume', $actions['toggle']['#props']['label']);
    self::assertSame($toggle . $back, $actions['toggle']['#props']['href']);
    self::assertSame($this->trigger->toUrl('delete-form')->toString(), $actions['delete']['#props']['href']);

    $html = $this->renderDetail();
    self::assertStringContainsString((string) $this->trigger->label(), $html);
    self::assertStringContainsString('Paused', $html);
    self::assertGreaterThan(strpos($html, 'Paused'), strpos($html, '>Delete<'));
  }

  /**
   * A guest reads the detail but gets no action; the routes stay denied.
   */
  public function testGuestGetsNoAction(): void {
    $guest = $this->createAccount('north-guest');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $guest, ['guest']);
    $this->container->get('current_user')->setAccount($guest);

    self::assertSame([], $this->detailActions('bb_ticket_trigger_actions', $this->trigger));
    $parameters = $this->trigger->toUrl('edit-form')->getRouteParameters();
    self::assertFalse($this->trigger->toUrl('edit-form')->access($guest));
    self::assertFalse(Url::fromRoute('entity.bb_ticket_trigger.toggle_form', $parameters)->access($guest));
    self::assertFalse($this->trigger->toUrl('delete-form')->access($guest));
  }

  /**
   * Renders the trigger's canonical view with the shipped display.
   */
  private function renderDetail(): string {
    $this->installConfig(['display_builder']);
    $name = 'core.entity_view_display.bb_ticket_trigger.template.default';
    $data = Yaml::decode((string) file_get_contents(dirname(DRUPAL_ROOT) . '/recipes/bakers/config/' . $name . '.yml'));
    $data['uuid'] = $this->container->get('uuid')->generate();
    $this->container->get('config.storage')->write($name, $data);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $build = $this->container->get('entity_type.manager')->getViewBuilder('bb_ticket_trigger')->view($this->trigger, 'full');
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

}
