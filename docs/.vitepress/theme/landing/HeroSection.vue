<script setup lang="ts">
// Hero: headline, sign-up, install command and the line illustration (four
// stations on a counter, a person's cursor on each decision). The illustration
// keeps the design's fixed 768 x 330 geometry and zooms down on narrow screens.
const stations = [
  { title: 'Plan', caption: 'weighs it', img: 'agent-scale', box: [37, 80, 118], action: 'Approve plan', actionX: 38.5, cursor: 'cursor-pink', cursorX: 130, tag: 'var(--lp-rose)' },
  { title: 'Build', caption: 'bakes it', img: 'agent-oven', box: [229, 80, 118], action: 'Confirm result', actionX: 226.5, cursor: 'cursor-green', cursorX: 326, tag: 'var(--lp-sprout)' },
  { title: 'Review', caption: 'checks it', img: 'agent-magnifier', box: [424, 88, 112], action: 'Confirm verdict', actionX: 414.5, cursor: 'cursor-yellow', cursorX: 522, tag: 'var(--lp-butter)' },
  { title: 'Ship', caption: 'ready', img: 'bun', box: [637, 82, 116], action: 'Authorize merge', actionX: 604, cursor: 'cursor-yellow', cursorX: 716.5, tag: 'var(--lp-butter)' },
]
</script>

<template>
  <section class="lp-wrap grid gap-10 pb-14 pt-16 min-[1440px]:grid-cols-[520px_768px]">
    <div class="flex flex-col items-start self-end">
      <h1 class="lp-display m-0 max-w-[520px] text-balance text-[44px] font-extrabold leading-[0.94] tracking-[-2px] md:text-[72px] md:tracking-[-3.52px]">
        You're the baker. Agents run the line.
      </h1>
      <p class="m-0 mt-[26px] max-w-[425px] text-[18px] leading-[1.5] text-[color:var(--lp-ink-2)] md:text-[21px]">
        Before your team is up, the prep is done. Agents work every ticket on your own machines, and a person decides at every station.
      </p>
      <div class="mt-[34px] flex flex-wrap items-end gap-[18px]">
        <a href="/get-started/" class="lp-btn">Sign up</a>
        <div class="w-[253px] max-w-full">
          <p class="lp-mono m-0 text-[13px] font-medium leading-[18.2px] text-[color:var(--lp-ink-2)]">or self-host for free</p>
          <code class="lp-code mt-[6px] block text-[13px] leading-[18.2px] text-[color:var(--lp-ink-2)]">npm i -g @bakers-build/bakers</code>
        </div>
      </div>
      <p class="lp-mono m-0 mt-[22px] flex items-center gap-2 text-[13px] font-medium text-[color:var(--lp-ink-2)]">
        <img src="/landing/spark.svg" alt="" width="14" height="14" />
        Open source. Runs on your machines.
      </p>
    </div>

    <div class="lp-line self-end justify-self-center">
      <div
        class="relative h-[330px] w-[768px]"
        role="img"
        aria-label="The line: four stations, Plan, Build, Review and Ship, each worked by an agent. At each one a person decides: approve plan, confirm result, confirm verdict, authorize merge."
      >
        <div class="absolute left-[-16px] top-[196px] h-4 w-[800px] rounded-[8px] border-2 border-[color:var(--lp-ink)] bg-[color:var(--lp-crust)]" />
        <template v-for="(s, i) in stations" :key="s.title">
          <p class="lp-title absolute top-0 m-0 w-[192px] text-center text-[22px]" :style="{ left: `${i * 192}px` }">{{ s.title }}</p>
          <p class="lp-mono absolute top-[30px] m-0 w-[192px] text-center text-[12.5px] font-medium text-[color:var(--lp-ink-2)]" :style="{ left: `${i * 192}px` }">{{ s.caption }}</p>
          <img
            :src="`/landing/${s.img}.svg`"
            alt=""
            class="absolute"
            :width="s.box[2]"
            :height="s.box[2]"
            :style="{ left: `${s.box[0]}px`, top: `${s.box[1]}px` }"
          />
          <span
            class="absolute top-[236px] whitespace-nowrap rounded-full border-[1.5px] border-[color:var(--lp-ink)] bg-[color:var(--lp-paper)] px-[14px] py-2 text-[13.5px] font-semibold"
            :style="{ left: `${s.actionX}px` }"
          >{{ s.action }}</span>
          <img :src="`/landing/${s.cursor}.svg`" alt="" width="20" height="26" class="absolute top-[259.5px]" :style="{ left: `${s.cursorX}px` }" />
          <span
            class="lp-mono absolute top-[283.5px] rounded-[6px] border-[1.2px] border-[color:var(--lp-ink)] px-2 py-1 text-[12px] font-medium"
            :style="{ left: `${s.cursorX + 16}px`, background: s.tag }"
          >Person</span>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* The illustration is drawn at a fixed size; below its width it zooms as a whole. */
@media (max-width: 899px) {
  .lp-line { zoom: 0.75; }
}
@media (max-width: 639px) {
  .lp-line { zoom: 0.58; }
}
@media (max-width: 479px) {
  .lp-line { zoom: 0.44; }
}
</style>
