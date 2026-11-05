<script setup lang="ts">
import type { Copy } from './copy'

defineProps<{ t: Copy }>()
</script>

<template>
  <section class="border-t border-[#d9cfbf]">
    <div class="lp-wrap flex flex-col gap-12 py-12 md:py-[88px] lg:flex-row lg:gap-20">
      <div class="flex flex-col gap-5 lg:w-[420px] lg:shrink-0">
        <p class="lp-mono m-0 text-[13px] font-medium text-[color:var(--lp-ink-3)]">{{ t.faq.eyebrow }}</p>
        <h2 class="lp-display m-0 text-[38px] font-extrabold leading-[0.98] tracking-[-1.1px] md:text-[44px]">{{ t.faq.title }}</h2>
        <p class="m-0 text-[17px] leading-[1.5] text-[color:var(--lp-ink-2)]">{{ t.faq.text }}</p>
      </div>
      <dl class="m-0 min-w-0 flex-1">
        <div
          v-for="([q, a], i) in t.faq.items"
          :key="q"
          class="flex flex-col gap-2 border-[color:var(--lp-ink)] py-[22px]"
          :class="i === 0 ? 'border-t-2' : 'border-t border-dashed'"
        >
          <dt class="lp-title text-[22px] leading-[1.25]">{{ q }}</dt>
          <dd class="m-0 text-[16.5px] leading-[1.5] text-[color:var(--lp-ink-2)]">{{ a }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>
