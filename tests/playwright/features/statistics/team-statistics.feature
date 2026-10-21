@feature:team-statistics
Feature: The team Stats tab has one period switch and a painted chart
  Two of this surface's properties are only observable in a browser. The first
  is the period switch: a PHP test can count controls in markup, but only a
  reader sees whether the page offers one switch or one per card. The second is
  the comparison chart, which is a `<canvas>` painted by Chart.js — no Storybook
  story, no contract script and no PHP test can see whether it was painted at
  all, let alone after the tab was swapped in rather than loaded cold.

  THE TAB-CLICK ENTRY IS THE POINT of the painting scenarios. Reaching /stats by
  URL is an ordinary whole-page render and proves nothing about the library
  race; arriving by clicking the tab is the boosted path, where a library the
  fragment has to FETCH can land after core has already run attachBehaviors and
  the canvas is then inserted and never painted. That is the measured BB-396
  F43 failure mode, and it is why Chart.js is attached up front.

  Background:
    Given I am logged in as "Administrator"

  # AC 1. Every figure declares the same `period` filter and the selected value
  # is applied to all of them, so a control per figure was several identical
  # switches for one effect.
  Scenario: The Stats tab offers exactly one period switch
    When I visit the team "Platform Crew" tab "Stats"
    Then the statistics page has exactly one period switch
    And no statistics figure carries a period switch of its own

  # AC 2. The one switch has to move the whole page, not the figure it sits in.
  Scenario: The single switch changes every figure
    Given I visit the team "Platform Crew" tab "Stats"
    And I note the statistics figures
    When I choose the period "1 year"
    Then the address carries the period "365"
    And the statistics page has exactly one period switch
    And the period "1 year" is the current one
    And the same statistics figures are shown
    And every chart figure reports a different bucket count

  # AC 3, AC 8, AC 12 — the painting, on the entry path that can lose the race.
  Scenario: The comparison chart paints after the Stats tab is swapped in
    Given I visit the team "Platform Crew"
    When I click the tab "Stats"
    Then the document was not reloaded
    And the comparison chart is painted
    And the comparison chart spans the content width

  # THE SECOND CLICK. A declaration or a library lost in the swap survives the
  # first one, so the assertion is what happens on the way back. The second
  # arrival is also where a missing teardown shows: the swapped-away host is
  # gone from the document, but its Chart instance and its observer on <html>
  # are not, and nothing in the painting assertion can see what was left behind.
  Scenario: The chart still paints when the Stats tab is reached a second time
    Given I visit the team "Platform Crew" tab "Stats"
    When I click the tab "Runs"
    Then the document was not reloaded
    When I click the tab "Stats"
    Then the document was not reloaded
    And the comparison chart is painted
    And no comparison chart instance is left behind

  # AC 4. No colour is a JS literal: every series colour is read from the theme's
  # own custom properties at paint time, which is the only thing that makes one
  # chart follow both modes. Switching the mode has to change what the canvas
  # contains.
  Scenario: The chart follows the colour mode
    Given I visit the team "Platform Crew" tab "Stats"
    And I note the chart ink
    When I switch to the dark colour mode
    Then the chart ink changed
