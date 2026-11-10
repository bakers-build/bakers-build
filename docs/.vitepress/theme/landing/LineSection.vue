<script setup lang="ts">
import type { Copy } from './copy'

const props = defineProps<{ t: Copy }>()
// The step icons are the hero's four illustrations at 44 px (stroke 2).
const meta = [['01', 'plan', 'scale'], ['02', 'working', 'oven'], ['03', 'review', 'magnifier'], ['04', 'done', 'bun']]
const stations = props.t.line.stations.map(([title, text, decision], i) => {
  const [n, state, icon] = meta[i]
  return { n, state, icon, title, text, decision }
})
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
    <ol class="m-0 mt-12 grid list-none border-t-2 border-[color:var(--lp-ink)] p-0 pt-7 md:grid-cols-2 lg:grid-cols-4">
      <li
        v-for="(s, i) in stations"
        :key="s.n"
        class="flex flex-col gap-[14px] border-dashed border-[color:var(--lp-ink)] pb-8 lg:min-h-[317px] lg:px-[22px] lg:pb-2"
        :class="i === 0 ? 'lg:pl-0' : 'lg:border-l'"
      >
        <div class="flex items-center gap-3">
          <img :src="`/landing/step-${s.icon}.svg`" alt="" width="44" height="44" />
          <div class="lp-mono flex flex-col gap-[2px] font-medium">
            <span class="text-[12.5px] text-[color:var(--lp-ink-3)]">{{ s.n }}</span>
            <span class="text-[13px]">{{ s.state }}</span>
          </div>
        </div>
        <h3 class="lp-title m-0 text-[22px] leading-[1.1]">{{ s.title }}</h3>
        <p class="m-0 text-[16px] leading-[1.5] text-[color:var(--lp-ink-2)]">{{ s.text }}</p>
        <p class="m-0 mt-auto rounded-[8px] bg-[color:var(--lp-butter)] px-3 py-2 text-[14.5px] font-semibold leading-[1.4]">{{ s.decision }}</p>
      </li>
    </ol>
  </section>
</template>
