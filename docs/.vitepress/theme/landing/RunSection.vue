<script setup lang="ts">
import type { Copy } from './copy'
import ScreenshotTabs from './ScreenshotTabs.vue'

defineProps<{ t: Copy }>()
</script>

<template>
  <section class="lp-wrap py-12 md:py-[98px]">
    <h2 id="clients-title" class="lp-display m-0 max-w-[760px] text-[38px] font-extrabold leading-[0.96] tracking-[-2.08px] md:text-[52px]">
      {{ t.run.title }}
    </h2>
    <p class="m-0 mt-[18px] max-w-[640px] text-[18px] leading-[1.55] text-[color:var(--lp-ink-2)]">
      {{ t.run.text }}
    </p>
    <ScreenshotTabs id="clients" labelledby="clients-title" :items="t.run.clients" class="mt-10" />
  </section>
</template>
