<script setup lang="ts">
const points = [
  { icon: 'icon-basket', text: 'Set which checks must pass before the merge.' },
  { icon: 'icon-scroll', text: 'Add your own skills for your stack, from the offer to the launch.' },
  { icon: 'icon-pen', text: 'The recipe goes through code review like everything else.' },
]
const excerpt = [
  ['## Loaded skills', true],
  ['- @bakers-build/essential-skills', false],
  ['- @bakers-build/ddev-drupal-feature', false],
  ['', false],
  ['## Checks', true],
  ['| When            | Command              |', false],
  ['|-----------------|----------------------|', false],
  ['| Web UI changes  | pnpm run build       |', false],
] as const
</script>

<template>
  <section id="recipe" class="scroll-mt-4 border-b-[1.5px] border-dashed border-[color:var(--lp-rule)]">
    <div class="lp-wrap grid items-center gap-16 py-[88px] lg:grid-cols-[minmax(0,602px)_minmax(0,662px)] lg:justify-between">
      <div>
        <h2 class="lp-display m-0 max-w-[571px] text-balance text-[38px] font-extrabold leading-[0.95] tracking-[-2.4px] md:text-[60px]">
          Change the recipe, and the line changes.
        </h2>
        <p class="m-0 mt-5 max-w-[587px] text-[19px] leading-[1.55] text-[color:var(--lp-ink-2)]">
          How your line works lives in WORKFLOW.md next to your code. No migration, no support ticket.
        </p>
        <ul class="m-0 mt-7 grid max-w-[444px] list-none gap-[14px] p-0">
          <li v-for="p in points" :key="p.icon" class="relative pl-[30px] text-[17px] leading-[25.5px]">
            <img :src="`/landing/${p.icon}.svg`" alt="" width="20" height="20" class="absolute left-0 top-[2px]" />
            {{ p.text }}
          </li>
        </ul>
      </div>
      <figure class="m-0 min-w-0 overflow-hidden rounded-[18px] border-[2.5px] border-[color:var(--lp-ink)] bg-[color:var(--lp-paper)] shadow-[0_22px_44px_-26px_rgba(43,33,22,0.6)]">
        <figcaption class="lp-mono flex items-center gap-[10px] border-b-[1.5px] border-[color:var(--lp-rule)] px-[18px] py-3 text-[13px]">
          <img src="/landing/icon-file.svg" alt="" width="18" height="18" />
          <span class="font-semibold">WORKFLOW.md</span>
          <span class="ml-auto font-medium text-[color:var(--lp-ink-2)]">example · 1 line added</span>
        </figcaption>
        <pre class="lp-mono m-0 overflow-x-auto pb-[22px] pt-[18px] text-[14px] leading-[24.5px]"><code class="block"><span v-for="([line, head], i) in excerpt" :key="i" class="block px-[22px]" :class="head ? 'font-semibold' : ''">{{ line || '​' }}</span><span class="block min-w-max bg-[#e6f3c6] px-[22px]"><span class="font-semibold text-[#4d6b14]">+ </span>| Before merge    | npx playwright test  |</span></code></pre>
      </figure>
    </div>
  </section>
</template>
