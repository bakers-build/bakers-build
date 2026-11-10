<script setup lang="ts">
import type { Copy } from './copy'

const props = defineProps<{ t: Copy }>()
// The run log as text. The log stays English in both languages; only the two lines
// the person types follow the page language, as in the design.
const ok = 'var(--lp-sprout)'
const you = 'var(--lp-butter)'
const rose = 'var(--lp-rose)'
const muted = '#b3a28a'
const log: { mark: string; color: string; msg: string; tail?: string; tailColor?: string }[] = [
  { mark: '✓', color: ok, msg: ' conductor studio-m1 claimed BB-142', tail: ' · worktree feat/bb-142', tailColor: muted },
  { mark: 'agent', color: muted, msg: '  Plan approved. Implementing the login redirect.' },
  { mark: '✓', color: ok, msg: ' playwright · 12 passed, 0 failed' },
  { mark: '✓', color: ok, msg: ' state written: review' },
  { mark: 'you  ', color: you, msg: `  ${props.t.run.sendBack}` },
  { mark: '←', color: rose, msg: ' state written: working · changes requested' },
  { mark: 'agent', color: muted, msg: '  Keeping the return URL; regression scenario added.' },
  { mark: '✓', color: ok, msg: ' playwright · 13 passed, 0 failed' },
  { mark: '✓', color: ok, msg: ' state written: review · ', tail: 'verdict: looks good', tailColor: rose },
  { mark: 'you  ', color: you, msg: `  ${props.t.run.merge}` },
  { mark: '✓', color: ok, msg: ' merge authorized by you · merging #241' },
]
</script>

<template>
  <section class="lp-wrap grid items-center gap-8 py-12 md:py-[98px] lg:grid-cols-[420px_minmax(0,852px)] lg:justify-between lg:gap-14">
    <div>
      <h2 class="lp-display m-0 max-w-[420px] text-[38px] font-extrabold leading-[0.96] tracking-[-2.08px] md:text-[52px]">
        {{ t.run.title }}
      </h2>
      <p class="m-0 mt-[18px] max-w-[364px] text-[18px] leading-[1.55] text-[color:var(--lp-ink-2)]">
        {{ t.run.text }}
      </p>
    </div>
    <figure class="m-0 min-w-0 overflow-hidden rounded-[16px] border-[2.5px] border-[color:var(--lp-ink)] bg-[color:var(--lp-ink)] shadow-[0_18px_40px_-18px_rgba(43,33,22,0.55)]">
      <figcaption class="flex items-center gap-2 bg-[#3a2d1f] px-4 py-3">
        <span v-for="n in 3" :key="n" class="size-[11px] rounded-full bg-[#6e5b45]" aria-hidden="true" />
        <img src="/landing/icon-runlog.svg" alt="" width="16" height="16" class="ml-3" />
        <span class="lp-mono pl-[6px] text-[12px] leading-[21px] text-[#cdbda6]">BB-142 · run log</span>
      </figcaption>
      <pre data-runlog class="lp-mono m-0 whitespace-pre-wrap break-words px-6 pb-6 pt-5 text-[14.5px] leading-[1.75] text-[#b3a28a]"><code><template v-for="(l, i) in log" :key="i"><span :style="{ color: l.color }">{{ l.mark }}</span><span class="text-[#f3eada]">{{ l.msg }}</span><span v-if="l.tail" :style="{ color: l.tailColor }">{{ l.tail }}</span>{{ '\n' }}</template><span class="mt-[10px] inline-block h-[18px] w-[9px] bg-[color:var(--lp-butter)] align-middle" aria-hidden="true" /></code></pre>
    </figure>
  </section>
</template>
