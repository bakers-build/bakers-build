---
title: Islands and profiles
description: How the web UI is assembled from islands, how an island profile chooses a layout per route and rank, and where the rules live.
---

# Islands and profiles

**The web UI is a set of islands on a page. A profile decides which islands a visitor gets.**

An island is a self-contained fragment of the page: a list, a card, a dialog form. The `island` module (`web/modules/custom/island`) renders islands, refreshes them over htmx and keeps dialogs working without JavaScript. bakers.build's screens are compositions of islands; the theme supplies the components.

## Profiles

An **island profile** (`island.profile.*` config) names a set of placements: which island renders in which region of a page. Several profiles can exist for the same route; conditions decide which one applies.

- **Two levels of conditions.** A profile's own conditions select the profile. Each placement inside it has its own conditions that show or hide that one island. Both use Drupal's Condition API, the same plugins block visibility uses, with an `and`/`or` operator per collection.
- **Selection.** The first enabled profile whose conditions pass wins, by weight, then machine name. Profiles are never merged. A profile without conditions is only the app's default.
- **Placements.** A placement whose conditions fail renders nothing, and the same check runs again before an island refresh or action, so a hidden island cannot be reached through a side door. Visibility never grants what the island's own access denies.
- **Caching.** Every decision carries the cacheability of every condition it looked at, including rejected profiles, so the ordinary page is never served where a profile applies. A condition that cannot be evaluated denies with no caching.

## bakers.build's conditions

| Plugin | Passes when |
|---|---|
| `route_name` | the current route is in the configured list |
| `bb_user_area_route` | the route belongs to the account area |
| `bb_ambient_workspace` | a workspace resolves for this request |
| `bb_workspace_rank` | the account holds one of the selected ranks: Admin (`lead`), `contributor`, `guest`, `non-member` |

The workspace conditions read the ambient workspace by default; a profile can map them to the route's own workspace instead. A site role grants no rank.

## Editing a profile

The profile form embeds each condition plugin's own form at both levels, as the block form does. Conditions left at their defaults are not stored; a stored condition whose plugin is unavailable is kept for repair. `request_path` is core's: aliases, case-insensitive, `*` anywhere.

## Where to read more

The island module's README (`web/modules/custom/island/README.md`) covers profile and placement conditions, client-side scripts, wrapped dialog forms, the page-cache request policy and fragment rendering. Components, stories and scenes are created through the Designbook skills, never by hand ([Development](/configuration/project/contributing#index)).
