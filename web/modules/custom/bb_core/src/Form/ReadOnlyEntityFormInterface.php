<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

/**
 * Opts an entity form into display-only GET rendering for entity viewers.
 *
 * Implementations must suppress editable controls without update access and
 * independently reject POST requests without update access. Ordinary entity
 * forms remain protected by the entity-form source's update access check.
 */
interface ReadOnlyEntityFormInterface {}
