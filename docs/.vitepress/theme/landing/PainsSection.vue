<script setup lang="ts">
const pains = [
  ['“My idea has been sitting in the backlog for weeks.”', 'You start tickets yourself. Building starts once you approve the scope, not once a developer is free.'],
  ['“AI in our project? Who makes sure nothing breaks?”', 'Tests run before every handoff, a second agent reviews independently, and a person authorizes the merge.'],
  ['“I can’t see what’s happening, or what it costs.”', 'Every run is recorded: who or what worked on it, when, with which result and how much AI it used.'],
  ['“Another tool that forces a process on us.”', 'Your process lives in WORKFLOW.md in your repo. One text edit, and the line works differently.'],
  ['“Our code must not end up in someone else’s cloud.”', 'Agents run on your machines, with your own agent subscription.'],
]
</script>

<template>
  <section class="lp-wrap py-[88px]">
    <p class="lp-mono m-0 text-[13px] font-medium text-[color:var(--lp-ink-3)]">Why bakers.build</p>
    <h2 class="lp-display m-0 mt-5 max-w-[760px] text-[38px] font-extrabold leading-[0.95] tracking-[-1.8px] md:text-[60px]">
      What used to hold you back.
    </h2>
    <p class="m-0 mt-5 text-[19px] leading-[1.5] text-[color:var(--lp-ink-2)]">And what the line changes about it.</p>
    <dl class="m-0 mt-12">
      <div
        v-for="([pain, answer], i) in pains"
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
