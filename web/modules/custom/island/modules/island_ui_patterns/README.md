# Island UI Patterns

This optional submodule owns the UI Patterns integration for Island Profiles.
The base `island` module remains installable without UI Patterns and supplies
the App, Island Profile, SDC layout, Menu and Page Content contracts on its
own. When this submodule is enabled, the existing `island` source can be used
to map UI Patterns component props and slots and to place addressable islands.

The `ui_patterns_component` island stores a component's normal UI Patterns
`component_id`, `props` and `slots` source configuration. Configure refresh
events on the placement to rebuild its mappings after an app event. Each
placement resolves its own current host data, and responses stay within the
triggering profile instance.

App providers may return `contexts` from `getIslandData()`, mapping names to
Drupal `ContextInterface` objects. A source's `context_mapping` binds its
required context to that name. For example, the installed
`field_property:user:name:value` source can bind `entity` to a typed user entity
context. These objects are runtime data and are never exported with profiles.

App providers can also implement `AppContextProviderInterface`. Its
`getProfileContexts()` method supplies typed contexts to the administration
widget's `#source_contexts`, making the corresponding UI Patterns sources
selectable. For entity data, choose the entity field source and then the
field. Runtime values still come from `getIslandData()['contexts']`.

UI Patterns' entity field chooser requires both an `entity` context and a
`bundle` string context. Providers should declare the same pair in preview
and runtime data, for example:

```php
$contexts = [
  'entity' => EntityContext::fromEntity($entity),
  'bundle' => new Context(
    new ContextDefinition('string', 'Bundle'),
    $entity->bundle(),
  ),
];
```
