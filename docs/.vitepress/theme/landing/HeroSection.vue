<script setup lang="ts">
// Hero: headline, the sign-up / install group and the line illustration: four stations
// on a counter, a person's cursor on each decision. Each station keeps the design's
// 192 x 330 cell; desktop sets the four in a row on one counter, phones (frame 675:553)
// two rows of two, each on its own counter, scaled to 0.82.
import InstallCommand from './InstallCommand.vue'
import { SIGN_UP_URL, type Copy } from './copy'

const props = defineProps<{ t: Copy }>()
const art = [
  { img: 'agent-scale', cursor: 'cursor-pink', tag: 'var(--lp-rose)' },
  { img: 'agent-oven', cursor: 'cursor-green', tag: 'var(--lp-sprout)' },
  { img: 'agent-magnifier', cursor: 'cursor-yellow', tag: 'var(--lp-butter)' },
  { img: 'bun', cursor: 'cursor-yellow', tag: 'var(--lp-butter)' },
]
const stations = props.t.hero.stations.map(([title, caption, action], i) => ({ title, caption, action, ...art[i] }))
const rows = [stations.slice(0, 2), stations.slice(2)]
</script>

<template>
  <section class="lp-wrap grid gap-10 pb-14 pt-16 min-[1440px]:grid-cols-[520px_768px]">
    <div class="flex flex-col items-start self-end">
      <h1 class="lp-display m-0 max-w-[520px] text-balance text-[44px] font-extrabold leading-[0.94] tracking-[-2px] md:text-[72px] md:tracking-[-3.52px]">
        {{ t.hero.title }}
      </h1>
      <p class="m-0 mt-[26px] max-w-[425px] text-[18px] leading-[1.5] text-[color:var(--lp-ink-2)] md:text-[21px]">
        {{ t.hero.text }}
      </p>
      <div data-cta-group class="mt-[34px] flex flex-col items-start gap-[18px] sm:flex-row sm:items-end sm:gap-5">
        <a :href="SIGN_UP_URL" class="lp-btn">{{ t.signUp }}</a>
        <InstallCommand :t="t.copy" :label="t.hero.install" tall small />
      </div>
      <p class="lp-mono m-0 mt-[22px] flex items-center gap-2 text-[13px] font-medium text-[color:var(--lp-ink-2)]">
        <img src="/landing/spark.svg" alt="" width="14" height="14" />
        {{ t.hero.note }}
      </p>
    </div>

    <div data-line class="lp-line self-end justify-self-center min-[1440px]:mt-[198px] min-[1440px]:self-start" role="img" :aria-label="t.hero.lineLabel">
      <div class="relative flex flex-col gap-[10px] md:flex-row md:gap-0">
        <div class="lp-counter hidden w-[800px] md:block" />
        <div v-for="(row, r) in rows" :key="r" class="relative flex">
          <div class="lp-counter w-[416px] md:hidden" />
          <div v-for="s in row" :key="s.title" class="relative h-[330px] w-[192px]">
            <p class="lp-title m-0 text-center text-[22px] leading-[26px]">{{ s.title }}</p>
            <p class="lp-mono m-0 mt-1 text-center text-[12.5px] font-medium text-[color:var(--lp-ink-2)]">{{ s.caption }}</p>
            <img :src="`/landing/${s.img}.svg`" alt="" width="118" height="118" class="absolute left-[37px] top-[80px]" />
            <div class="absolute left-1/2 top-[236px] -translate-x-1/2">
              <span class="block whitespace-nowrap rounded-full border-[1.5px] border-[color:var(--lp-ink)] bg-[color:var(--lp-paper)] px-[14px] py-2 text-[13.5px] font-semibold leading-[16px]">{{ s.action }}</span>
              <img :src="`/landing/${s.cursor}.svg`" alt="" width="20" height="26" class="absolute right-[3.5px] top-[23.5px] max-w-none" />
              <span
                data-tag
                class="lp-mono absolute left-[calc(100%-7.5px)] top-[47.5px] whitespace-nowrap rounded-[6px] border-[1.2px] border-[color:var(--lp-ink)] px-2 py-1 text-[12px] font-medium leading-[14px]"
                :style="{ background: s.tag }"
              >{{ t.hero.tag }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* The counter the stations stand on (Figma "Theke"). */
.lp-counter {
  position: absolute;
  left: -16px;
  top: 196px;
  height: 16px;
  border: 2px solid var(--lp-ink);
  border-radius: 8px;
  background: var(--lp-crust);
}
/* The illustration keeps its drawn size; narrower screens scale it as a whole. */
@media (max-width: 767px) {
  .lp-line { zoom: 0.82; }
}
@media (min-width: 768px) and (max-width: 899px) {
  .lp-line { zoom: 0.75; }
}
</style>
