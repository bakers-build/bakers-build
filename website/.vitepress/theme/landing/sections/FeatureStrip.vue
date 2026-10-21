<script setup lang="ts">
// c-strip — the hairline strip at the fold: everything around bakers.build is an
// addon you can swap, the tickets stay the same.
const cells = [
  { glyph: '⌁', title: 'Your agent', text: 'Claude Code, Codex, Grok, Kimi, OpenCode or Pi, on your own subscription.' },
  { glyph: '▣', title: 'Your terminal', text: 'herdr keeps a tab per ticket today; tuios is coming. Swap it, keep the tickets.' },
  { glyph: '⎇', title: 'Your stack', text: 'Drupal with DDEV and docs ship with step skills; write one for any other stack.' },
  { glyph: '§', title: 'Your rules', text: 'Checks, standards and methods live in WORKFLOW.md in your repo.' },
]
</script>

<template>
  <div class="sr relative z-[3] mt-24 border-y border-white/[.07] bg-[color:var(--lp-bg)]">
    <div class="mx-auto grid max-w-[1120px] grid-cols-4 px-6 max-[860px]:grid-cols-2">
      <div
        v-for="(c, i) in cells"
        :key="c.title"
        class="relative isolate border-l border-white/[.07] px-[30px] py-[38px] after:pointer-events-none after:absolute after:inset-[10px] after:-z-10 after:rounded-[14px] after:bg-[rgba(164,143,255,.06)] after:opacity-0 after:transition-opacity after:duration-300 after:content-[''] hover:after:opacity-100 max-[860px]:border-t max-[860px]:border-white/[.07]"
        :class="{ 'border-l-0': i === 0 }"
      >
        <div class="lp-badge-text mb-3 text-[20px]">{{ c.glyph }}</div>
        <h3 class="mb-2 text-[18px] font-semibold text-[color:var(--lp-text-1)]">{{ c.title }}</h3>
        <p class="text-[15.5px] text-[color:var(--lp-text-2)]">{{ c.text }}</p>
      </div>
    </div>
  </div>
</template>
