<script setup lang="ts">
import type { Copy } from './copy'

defineProps<{ t: Copy }>()
</script>

<template>
  <section class="lp-wrap py-12 md:py-[88px]">
    <p class="lp-mono m-0 text-[13px] font-medium text-[color:var(--lp-ink-3)]">{{ t.pains.eyebrow }}</p>
    <h2 class="lp-display m-0 mt-5 max-w-[924px] text-[38px] font-extrabold leading-[0.95] tracking-[-1.8px] md:text-[60px]">
      {{ t.pains.title }}
    </h2>
    <p class="m-0 mt-5 text-[19px] leading-[1.5] text-[color:var(--lp-ink-2)]">{{ t.pains.text }}</p>
    <dl class="m-0 mt-12">
      <div
        v-for="([pain, answer], i) in t.pains.items"
        :key="pain"
        class="flex flex-col gap-3 border-[color:var(--lp-ink)] py-[26px] lg:flex-row lg:gap-16"
        :class="i === 0 ? 'border-t-2' : 'border-t border-dashed'"
      >
        <dt class="lp-title text-[22px] leading-[1.15] md:text-[26px] lg:w-[560px] lg:shrink-0">{{ pain }}</dt>
        <dd class="m-0 text-[17.5px] leading-[1.5] text-[color:var(--lp-ink-2)]">{{ answer }}</dd>
      </div>
    </dl>
  </section>
</template>
