<script setup lang="ts">
import type { Copy } from './copy'

defineProps<{ t: Copy }>()
</script>

<template>
  <section id="how-it-works" class="lp-wrap scroll-mt-4 py-12 md:py-[88px]">
    <p class="lp-mono m-0 text-[13px] font-medium text-[color:var(--lp-ink-3)]">{{ t.line.eyebrow }}</p>
    <h2 class="lp-display m-0 mt-5 max-w-[760px] text-[38px] font-extrabold leading-[0.95] tracking-[-1.8px] md:text-[60px]">
      {{ t.line.title }}
    </h2>
    <p class="m-0 mt-5 max-w-[640px] text-[19px] leading-[1.5] text-[color:var(--lp-ink-2)]">
      {{ t.line.text }}
    </p>
    <div class="mt-12 grid gap-8 md:grid-cols-2">
      <figure v-for="s in t.line.screenshots" :key="s.image" class="m-0 min-w-0">
        <img
          :src="`/landing/${s.image}.png`"
          :alt="s.alt"
          width="1440"
          height="900"
          loading="lazy"
          class="block h-auto w-full rounded-[12px] border border-[color:var(--lp-rule)]"
        />
        <figcaption class="mt-4">
          <h3 class="lp-title m-0 text-[22px] leading-[1.1]">{{ s.title }}</h3>
          <p class="m-0 mt-2 text-[16px] leading-[1.5] text-[color:var(--lp-ink-2)]">{{ s.text }}</p>
        </figcaption>
      </figure>
    </div>
  </section>
</template>
