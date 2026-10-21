<script setup lang="ts">
// c-hero — manifesto headline with Reflect's headline gradient, badge and
// one CTA per way in: with your agent, in the browser, for your team.
import BadgePill from '../primitives/BadgePill.vue'
import PillButton from '../primitives/PillButton.vue'
</script>

<template>
  <div class="relative z-[2] px-6 pt-[84px] text-center">
    <BadgePill dot class="sr mb-[34px]">Open source · MIT licensed</BadgePill>
    <h1 class="lp-headline sr dl1 mx-auto max-w-[16ch] text-[clamp(46px,6.4vw,84px)] font-bold leading-[1.05] tracking-[-.028em]">
      Agents work the tickets. You keep the workflow.
    </h1>
    <p class="sr dl2 mx-auto mb-9 mt-7 max-w-[44ch] text-[20px] leading-[1.6] text-[color:var(--lp-text-2)]">
      Your agent, your machine, your subscriptions. bakers.build moves every ticket
      through the states your team already follows, with you deciding at
      every step.
    </p>
    <div class="sr dl3 flex flex-wrap justify-center gap-3.5">
      <PillButton href="/get-started/install" variant="brand">Start with your agent</PillButton>
      <PillButton href="/get-started/work-in-the-browser" variant="ghost">Start in the browser</PillButton>
      <PillButton href="/get-started/is-bakers-right-for-us" variant="ghost">Is bakers.build right for us?</PillButton>
    </div>
    <p class="sr dl4 mt-[26px] text-[15.5px] text-[color:var(--lp-text-3)]">Nothing to host to get started. Add worker machines when your laptop becomes the limit.</p>
  </div>
</template>
