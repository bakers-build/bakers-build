---
name: bakers-design
description: Use this skill to generate well-branded interfaces and assets for bakers.build (the Drupal 11 orchestration dashboard), either for production or throwaway prototypes/mocks. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
bakers.build is a light "keytec × GitLab hybrid": neutral chrome from Gin (light), four state colors from keytec, a 2px-black brand accent used sparingly (header rule, primary CTA, alert cards), state always encoded doubly (accent edge + dot/pill), no emoji, compact laptop-half-screen density, read-only monitoring.
If creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out and create static HTML files for the user to view — link `styles.css` for the real tokens and use the `bakers-*` component classes. If working on production code, copy assets and read the rules here to become an expert in designing with this brand (Drupal 11 · Twig · Gin 5 · htmx).
If the user invokes this skill without other guidance, ask them what they want to build, ask some questions, and act as an expert designer who outputs HTML artifacts or production code, depending on the need.
