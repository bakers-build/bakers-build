<?php

declare(strict_types=1);

namespace Drupal\island\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\island\IslandHostResolver;
use Drupal\island\IslandInterface;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\island\IslandResponder;
use Drupal\island\IslandResponse;
use Drupal\island\IslandViewAccessInterface;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpFoundation\Request;

/**
 * Island form wiring reusable by any form base class.
 *
 * The island instance is wired from the form build info args
 * (['island_id' => ..., 'host_id' => ...]) which IslandPluginBase::getForm()
 * or the embedding island supplies. Consumers wire island.responder,
 * island.host_resolver and plugin.manager.island in their create() and call
 * attachIslandHtmx() when building the form and respondIsland() after a
 * successful submit.
 */
trait IslandFormTrait {

  /**
   * The island responder service.
   */
  protected IslandResponder $responder;

  /**
   * The island host resolver service.
   */
  protected IslandHostResolver $hostResolver;

  /**
   * The island plugin manager.
   */
  protected IslandPluginManagerInterface $islandManager;

  /**
   * Attaches the island HTMX wiring to the form.
   *
   * The form posts back to its own URL, negotiates fragments with the core
   * HTMX integration and swaps the island wrapper out-of-band.
   */
  protected function attachIslandHtmx(array &$form, FormStateInterface $form_state): void {
    [$island, $host] = $this->resolveIsland($form_state);
    $wrapper_id = $island->getHtmlId($host->hostId());
    (new Htmx())
      ->post()
      ->onlyMainContent()
      ->select('#' . $wrapper_id)
      ->target('#' . $wrapper_id)
      ->swap('outerHTML')
      ->applyTo($form);
    $form['#attached']['library'][] = 'island/base';
  }

  /**
   * Converts a mutation result into the partial HTMX fragment response.
   */
  protected function respondIsland(FormStateInterface $form_state, IslandResponse $response): void {
    [$island, $host] = $this->resolveIsland($form_state);
    // The form's POST input has been fully processed; the fragment response
    // re-renders islands (this form included) as a fresh representation.
    // Drop the consumed input so embedded forms do not process it again —
    // core precedents empty the request bag the same way on invalid tokens.
    $request = $this->getRequest();
    if ($request instanceof Request) {
      $request->request->replace([]);
    }
    // FormSubmitter honors a response set on the form state over any redirect.
    $form_state->setResponse($this->responder->toResponse($response, $island, $host));
  }

  /**
   * Finds which of several possible submit-name prefixes was pressed.
   *
   * For a form whose per-item controls (a remove button per row, an option
   * pick per row) are markup a template rendered ONCE inline — not Form API
   * elements `getTriggeringElement()` can see — this reads the raw request
   * input directly and returns the first name it finds starting with one of
   * the given prefixes, e.g. `remove_member_<uid>`.
   *
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The current form state; raw input is read from it, not from
   *   `getTriggeringElement()`.
   * @param string[] $prefixes
   *   Candidate `#name` prefixes, checked in the given order.
   *
   * @return array{0: string, 1: string}|null
   *   `[matched prefix, the remainder of the key after it]`, or NULL when no
   *   raw input key starts with any of the given prefixes.
   */
  protected function pressedPrefixed(FormStateInterface $form_state, array $prefixes): ?array {
    $input = $form_state->getUserInput();
    foreach ($prefixes as $prefix) {
      foreach (array_keys($input) as $key) {
        if (is_string($key) && str_starts_with($key, $prefix)) {
          return [$prefix, substr($key, strlen($prefix))];
        }
      }
    }
    return NULL;
  }

  /**
   * Strips an element's own attached validator so another trigger may fire.
   *
   * Some elements (e.g. `entity_autocomplete`) attach `#element_validate`
   * unconditionally, which refuses the submit when a different trigger fired.
   *
   * Must set an empty array, never `unset()`: `FormBuilder::doBuildForm()`
   * merges type defaults back with `+=`, which refills an absent key.
   *
   * @param array $element
   *   The form element to strip, by reference.
   */
  protected function suppressElementValidation(array &$element): void {
    $element['#element_validate'] = [];
  }

  /**
   * Resolves the island instance and its host from the form build info args.
   *
   * @return array{0: \Drupal\island\IslandInterface, 1: \Drupal\island\IslandContextProviderInterface}
   *   The island instance and its host context provider.
   */
  protected function resolveIsland(FormStateInterface $form_state): array {
    $args = $form_state->getBuildInfo()['args'][0] ?? [];
    $host = $this->hostResolver->resolve((string) ($args['host_id'] ?? ''));
    if ($host === NULL) {
      throw new \LogicException('Island form requires a host_id build argument.');
    }
    $placement_id = (string) ($args['island_id'] ?? '');
    if (!in_array($placement_id, $host->getIslandIds(), TRUE)) {
      throw new \LogicException('Island form requires an enabled placement belonging to its host.');
    }
    if ($host instanceof IslandViewAccessInterface && !$host->accessIsland($placement_id, $this->currentUser())->isAllowed()) {
      throw new AccessDeniedHttpException();
    }
    $config = $host->getIslandConfiguration((string) $args['island_id']);
    $config['contexts']['host'] = $host;
    $placement_id = (string) $args['island_id'];
    $config['contexts']['placement_id'] = $placement_id;
    $island = $this->islandManager->createInstance($this->hostResolver->pluginId($placement_id, $host), $config);
    if (!$island instanceof IslandInterface) {
      throw new \LogicException(sprintf('Island plugin "%s" does not implement IslandInterface.', (string) $args['island_id']));
    }
    return [$island, $host];
  }

}
