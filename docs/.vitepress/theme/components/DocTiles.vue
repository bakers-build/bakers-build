<script setup lang="ts">
// DocTiles — the docs home's grid of entry cards, Storybook-docs style
// (BB-427 D7). Pure presentation: each tile is one link.
import { ICONS } from './icons'

defineProps<{
  tiles: Array<{ title: string; text: string; link: string; icon?: string; meta?: string }>
}>()
</script>

<template>
  <div class="doc-tiles">
    <a v-for="t in tiles" :key="t.link" class="doc-tile" :href="t.link">
      <span v-if="t.icon && ICONS[t.icon]" class="doc-tile__icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          v-html="ICONS[t.icon]"
        />
      </span>
      <span class="doc-tile__title">{{ t.title }}</span>
      <p class="doc-tile__text">{{ t.text }}</p>
      <span v-if="t.meta" class="doc-tile__meta">{{ t.meta }}</span>
    </a>
  </div>
</template>
