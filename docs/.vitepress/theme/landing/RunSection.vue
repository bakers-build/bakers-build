<script setup lang="ts">
// The run log as text: [mark, mark colour, message, tail, tail colour].
const ok = '#bfe07a'
const you = '#f3ce3a'
const rose = '#f4afc0'
const log: [string, string, string, string?, string?][] = [
  ['✓', ok, ' conductor studio-m1 claimed BB-142', ' · worktree feat/bb-142', '#b3a28a'],
  ['agent', '#b3a28a', '  Plan approved. Implementing the login redirect.'],
  ['✓', ok, ' playwright · 12 passed, 0 failed'],
  ['✓', ok, ' state written: review'],
  ['you  ', you, '  The redirect works, but keep the return URL after login. Sending it back.'],
  ['←', rose, ' state written: coding · changes requested'],
  ['agent', '#b3a28a', '  Keeping the return URL; regression scenario added.'],
  ['✓', ok, ' playwright · 13 passed, 0 failed'],
  ['✓', ok, ' state written: review · ', 'verdict: looks good', rose],
  ['you  ', you, '  Review is OK. Merge it.'],
  ['✓', ok, ' merge authorized by you · merging #241'],
]
</script>

<template>
  <section class="lp-wrap grid items-center gap-14 py-[72px] lg:grid-cols-[420px_minmax(0,852px)] lg:justify-between">
    <div>
      <h2 class="lp-display m-0 max-w-[420px] text-[38px] font-extrabold leading-[0.96] tracking-[-2.08px] md:text-[52px]">
        This is what a run looks like.
      </h2>
      <p class="m-0 mt-[18px] max-w-[364px] text-[18px] leading-[1.55] text-[color:var(--lp-ink-2)]">
        The agent works and tests. If something is missing, you send the ticket back with one sentence. If it fits, you authorize the merge.
      </p>
    </div>
    <figure class="m-0 min-w-0 overflow-hidden rounded-[16px] border-[2.5px] border-[color:var(--lp-ink)] bg-[color:var(--lp-ink)] shadow-[0_18px_40px_-18px_rgba(43,33,22,0.55)]">
      <figcaption class="flex items-center gap-2 bg-[#3a2d1f] px-4 py-3">
        <span v-for="n in 3" :key="n" class="size-[11px] rounded-full bg-[#6e5b45]" aria-hidden="true" />
        <img src="/landing/icon-runlog.svg" alt="" width="16" height="16" class="ml-3" />
        <span class="lp-mono pl-[6px] text-[12px] leading-[21px] text-[#cdbda6]">BB-142 · run log</span>
      </figcaption>
      <pre class="lp-mono m-0 overflow-x-auto px-6 pb-6 pt-5 text-[14.5px] leading-[1.75] text-[#b3a28a]"><code><template v-for="([mark, markColor, msg, tail, tailColor], i) in log" :key="i"><span :style="{ color: markColor }">{{ mark }}</span><span class="text-[#f3eada]">{{ msg }}</span><span v-if="tail" :style="{ color: tailColor }">{{ tail }}</span>{{ '\n' }}</template><span class="mt-[10px] inline-block h-[18px] w-[9px] bg-[color:var(--lp-butter)] align-middle" aria-hidden="true" /></code></pre>
    </figure>
  </section>
</template>
