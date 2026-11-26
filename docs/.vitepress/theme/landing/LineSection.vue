<script setup lang="ts">
import type { Copy } from './copy'
import ScreenshotTabs from './ScreenshotTabs.vue'

defineProps<{ t: Copy }>()
</script>

<template>
  <section id="how-it-works" class="lp-wrap scroll-mt-4 py-12 md:py-[88px]">
    <p class="lp-mono m-0 text-[13px] font-medium text-[color:var(--lp-ink-3)]">{{ t.line.eyebrow }}</p>
    <h2 id="gallery-title" class="lp-display m-0 mt-5 max-w-[760px] text-[38px] font-extrabold leading-[0.95] tracking-[-1.8px] md:text-[60px]">
      {{ t.line.title }}
    </h2>
    <p class="m-0 mt-5 max-w-[640px] text-[19px] leading-[1.5] text-[color:var(--lp-ink-2)]">
      {{ t.line.text }}
    </p>
    <ScreenshotTabs id="gallery" labelledby="gallery-title" :items="t.line.screenshots" class="mt-10" />
  </section>
</template>
