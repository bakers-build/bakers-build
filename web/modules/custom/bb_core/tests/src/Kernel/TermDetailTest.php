<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A term row links to the term's detail, which carries Edit and Delete.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TermDetailTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;
  use ProjectsViewTestTrait;
  use ListRowLinkTestTrait;
  use DetailActionsTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'views', 'better_exposed_filters',
    'ui_patterns', 'ui_patterns_views', 'block', 'ui_patterns_field', 'display_builder', 'display_builder_entity_view', 'display_builder_views', 'island',
    'bb_core',
  ];

  /**
   * The label term of workspace a.
   */
  private ContentEntityInterface $term;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    foreach (['a', 'b'] as $side) {
      $this->fixture($side, 'bb_workspace')->set('slug', "space-$side")->save();
    }
    $this->installConfig(['views']);
    $this->installShippedView('views.view.bb_terms');
    $this->term = $this->fixture('a', 'bb_term');
    $this->term->set('description', 'Marks urgent work.')->save();
    $this->container->get('current_user')->setAccount($this->createAccount('term-admin', ['administer bakers']));
  }

  /**
   * A row is one link, to the term's detail under its workspace.
   */
  public function testRowIsOneLinkToTheTerm(): void {
    $detail = '/space-a/term/' . $this->term->id();
    self::assertSame($detail, $this->term->toUrl()->toString());

    $html = $this->renderListDisplay('bb_terms', 'labels', ['space-a']);

    $this->assertRowsLinkOnlyToTheirDetail($html, [$detail]);
  }

  /**
   * The detail shows the description, then Edit and Delete in its footer.
   */
  public function testDetailShowsTheTermWithEditAndDelete(): void {
    $detail = $this->term->toUrl()->toString();
    $actions = $this->detailActions('bb_term_actions', $this->term);

    self::assertSame(['edit', 'delete'], array_keys($actions));
    self::assertSame($this->term->toUrl('edit-form')->toString() . '?destination=' . $detail, $actions['edit']['#props']['href']);
    self::assertSame($this->term->toUrl('delete-form')->toString(), $actions['delete']['#props']['href']);

    $html = $this->renderDetail();
    self::assertStringContainsString('Marks urgent work.', $html);
    self::assertGreaterThan(strpos($html, 'Marks urgent work.'), strpos($html, '>Delete<'));
  }

  /**
   * A guest gets no action, and the action routes stay denied.
   */
  public function testGuestGetsNoAction(): void {
    $guest = $this->createAccount('north-guest', []);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $guest, ['guest']);
    $this->container->get('current_user')->setAccount($guest);

    self::assertSame([], $this->detailActions('bb_term_actions', $this->term));
    self::assertFalse($this->term->toUrl('edit-form')->access($guest));
    self::assertFalse($this->term->toUrl('delete-form')->access($guest));
  }

  /**
   * Renders the term's canonical view with the shipped display.
   */
  private function renderDetail(): string {
    $this->installConfig(['display_builder']);
    $name = 'core.entity_view_display.bb_term.label.default';
    $data = Yaml::decode((string) file_get_contents(dirname(DRUPAL_ROOT) . '/recipes/bakers/config/' . $name . '.yml'));
    $data['uuid'] = $this->container->get('uuid')->generate();
    $this->container->get('config.storage')->write($name, $data);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $build = $this->container->get('entity_type.manager')->getViewBuilder('bb_term')->view($this->term, 'full');
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

}
