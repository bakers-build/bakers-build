<?php

declare(strict_types=1);

namespace Drupal\bb_board\Plugin\views\style;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\TypedData\ComplexDataInterface;
use Drupal\bb_board\ProjectBoard;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\views\Attribute\ViewsStyle;
use Drupal\views\Plugin\views\style\StylePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Hands one board column's tickets to `bb_theme:board-card` props.
 *
 * The plugin reads ticket entities, not field output. Card status, assignee
 * marks and lease live in {@see ProjectBoard}. Column placement is each
 * column display's filters on general index fields. The theme's
 * `views-view-bb-board.html.twig` turns the cards into board-card. Empty
 * results still render: the column chrome stays up, and the view's empty
 * area says why.
 */
#[ViewsStyle(
  id: 'bb_board',
  title: new TranslatableMarkup('bakers.build board'),
  help: new TranslatableMarkup('Renders the result set as one project-board column of cards.'),
  theme: 'views_view_bb_board',
  display_types: ['normal'],
)]
final class BbBoard extends StylePluginBase {

  /**
   * {@inheritdoc}
   *
   * Core's evenEmpty() reads the plugin definition key `even empty`, which
   * ViewsStyle cannot declare. An empty column is still a column.
   */
  public function evenEmpty(): bool {
    return TRUE;
  }

  /**
   * {@inheritdoc}
   */
  protected $usesRowPlugin = FALSE;

  /**
   * {@inheritdoc}
   */
  protected $usesFields = TRUE;

  /**
   * {@inheritdoc}
   */
  protected $usesGrouping = FALSE;

  /**
   * {@inheritdoc}
   */
  protected $usesRowClass = FALSE;

  /**
   * Maps ticket entities to board-card props.
   */
  private ProjectBoard $board;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->board = $container->get(ProjectBoard::class);
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function render(): array {
    $tickets = [];
    foreach ($this->view->result as $row) {
      $ticket = $this->entityOf($row);
      if ($ticket instanceof BbTicketInterface) {
        $tickets[] = $ticket;
      }
    }
    // Views auto-registers style themes with view/options/rows/title only.
    // Extra keys such as #board are stripped before the template runs.
    return [
      [
        '#theme' => $this->themeFunctions(),
        '#view' => $this->view,
        '#rows' => $this->board->cards(
          $tickets,
          (string) $this->view->current_display,
        ),
        '#cache' => [
          'contexts' => ['user'],
          'tags' => ['bb_ticket_list', 'bb_environment_list', 'og_membership_list'],
        ],
      ],
    ];
  }

  /**
   * The ticket entity behind a result row, if Views loaded one.
   */
  private function entityOf(object $row): mixed {
    $values = get_object_vars($row);
    $entity = $values['_entity'] ?? NULL;
    $object = $values['_object'] ?? NULL;
    if ($entity === NULL && $object instanceof ComplexDataInterface) {
      $entity = $object->getValue();
    }
    return $entity;
  }

}
