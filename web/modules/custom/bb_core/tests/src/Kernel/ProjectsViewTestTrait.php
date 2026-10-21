<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\views\Views;
use Symfony\Component\Yaml\Yaml;

/**
 * Installs and executes the projects screen's two shipped views.
 *
 * Three classes assert different properties of the same two views — tenancy,
 * ambient scoping, and the rendered table — and each needs the same two
 * mechanics: get the view into the test environment, and run it with a given
 * argument. They live here rather than being copied, so a change to how the
 * views are reached changes one place.
 */
trait ProjectsViewTestTrait {

  /**
   * Makes one of the projects screen's shipped views exist in this environment.
   *
   * THE FILE ON DISK IS THE SOURCE — a rotted file fails here rather than
   * passing against a copy restated in a test — and the only assertion made is
   * that the file exists and parses. Whether an install path would have
   * delivered it is a different property, asserted by the recipe run rather
   * than guessed at here.
   *
   * Both views compose display_builder sources and ship from the recipe.
   * Their schema belongs to display_builder_views, which bb_core does not
   * depend on. Keeping these views outside module config avoids optional
   * installation before that schema is available. Callers must enable
   * display_builder_views before saving either view.
   *
   * @param string $name
   *   The config object name, e.g. `views.view.projects`.
   */
  protected function installShippedView(string $name): void {
    $candidates = [
      // The repository root, from this file's own location — the module
      // extension list answers a path relative to the APP root (`web/`), which
      // cannot reach `recipes/` above it.
      dirname(__DIR__, 7) . '/recipes/bakers/config/' . $name . '.yml',
      $this->container->get('extension.list.module')->getPath('bb_core')
      . '/config/optional/' . $name . '.yml',
    ];
    $path = NULL;
    foreach ($candidates as $candidate) {
      if (file_exists($candidate)) {
        $path = $candidate;
        break;
      }
    }
    self::assertNotNull(
      $path,
      "$name is shipped in neither recipes/bakers/config nor bb_core/config/optional.",
    );
    $data = Yaml::parseFile($path);
    self::assertIsArray($data, "$name did not parse as a YAML mapping.");
    self::assertArrayHasKey('id', $data, "$name carries no view id.");

    $storage = $this->container->get('entity_type.manager')->getStorage('view');
    if ($storage->load($data['id']) === NULL) {
      $storage->create($data)->save();
    }
  }

  /**
   * Executes a view and returns the entity ids of its rows, as strings.
   *
   * @param string $view_id
   *   The view to execute.
   * @param array<int, string> $arguments
   *   The contextual filter values, in the view's declared argument order. An
   *   empty array runs the view with NO argument, which for both of these
   *   views is the `access denied` case rather than "everything".
   * @param string $display_id
   *   The display to execute. Default stays the numeric argument contract.
   * @param array<string, string> $exposed
   *   Exposed input, keyed by identifier (the title search uses `title`).
   *
   * @return array<int, string>
   *   The row entity ids.
   */
  protected function viewResultIds(string $view_id, array $arguments = [], string $display_id = 'default', array $exposed = []): array {
    $view = Views::getView($view_id);
    self::assertNotNull($view, "views.view.$view_id is not installed.");
    $view->setDisplay($display_id);
    $view->setArguments($arguments);
    if ($exposed !== []) {
      $view->setExposedInput($exposed);
    }
    $view->preExecute();
    $view->execute();

    $ids = [];
    foreach ($view->result as $row) {
      self::assertNotNull($row->_entity, 'A view row carried no entity.');
      $ids[] = (string) $row->_entity->id();
    }
    return $ids;
  }

}
