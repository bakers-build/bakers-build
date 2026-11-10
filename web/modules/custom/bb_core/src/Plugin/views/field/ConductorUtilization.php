<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\field;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Derive\ConductorDeriver;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Renders a conductor's utilization as load-vs-capacity plus its level.
 *
 * Views' `alter.text` rewrite yields "2/4" only as a plain string, so a full
 * conductor looks like an idle one in the DOM. This field emits "2 / 4
 * parallel runs" with a meter and a `data-utilization` level, the stable
 * contract tests bind to; without a linked machine it reads "Unknown
 * capacity" with neither number nor meter. The markup lives in
 * `bb-conductor-utilization.html.twig`.
 *
 * Freshness is not folded in: the adjacent Heartbeat column carries it.
 */
#[ViewsField('bb_conductor_utilization')]
final class ConductorUtilization extends FieldPluginBase {

  /**
   * Derives the conductor's display values.
   */
  protected ConductorDeriver $conductorDeriver;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->conductorDeriver = $container->get(ConductorDeriver::class);
    return $instance;
  }

  /**
   * {@inheritdoc}
   *
   * This is a pseudo-field: it renders from the row's loaded entity and has no
   * column of its own. Without this no-op override the base implementation
   * would add a non-existent `utilization` column to the SELECT, which fails
   * the whole view rather than just this cell.
   */
  public function query(): void {
  }

  /**
   * {@inheritdoc}
   *
   * @return array|string
   *   A render array for the utilization cell, or an empty string when the row
   *   carries no conductor — the same shape core's EntityOperations field uses.
   */
  public function render(ResultRow $values) {
    $conductor = $this->getEntity($values);
    if (!$conductor instanceof BbConductorInterface) {
      return '';
    }
    $level = $this->conductorDeriver->nodeLoadLevel($conductor);
    return [
      '#theme' => 'bb_conductor_utilization',
      '#label' => $this->conductorDeriver->nodeLoadLabel($conductor),
      '#level' => $level,
      '#capacity' => $this->conductorDeriver->nodeCapacity($conductor),
    ];
  }

}
