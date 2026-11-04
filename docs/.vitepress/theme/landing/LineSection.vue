<script setup lang="ts">
const stations = [
  { n: '01', state: 'spec', avatar: 'avatar-scale', title: 'Plan', text: 'You describe what you need: in the browser, in a chat with Claude or in the terminal. The agent sorts it, asks what’s unclear and proposes a plan with acceptance criteria you can check.', decision: 'Nothing gets built until you approve the scope.' },
  { n: '02', state: 'coding', avatar: 'avatar-oven', title: 'Build', text: 'The agent works on its own branch, in its own environment on your machines. Automated tests run before the ticket moves on.', decision: 'You confirm the result.' },
  { n: '03', state: 'review', avatar: 'avatar-magnifier', title: 'Review', text: 'A second agent reviews independently and gives a verdict. When it needs an expert eye, a developer joins.', decision: 'Confirm it, or send it back with a clear expectation.' },
  { n: '04', state: 'done', avatar: 'avatar-bun', title: 'Ship', text: 'A person authorizes the merge: you or someone on your team. If you want, the line ships it too.', decision: 'A person authorizes the merge.' },
]
</script>

<template>
  <section id="how-it-works" class="lp-wrap scroll-mt-4 py-[88px]">
    <p class="lp-mono m-0 text-[13px] font-medium text-[color:var(--lp-ink-3)]">How it works</p>
    <h2 class="lp-display m-0 mt-5 max-w-[760px] text-[38px] font-extrabold leading-[0.95] tracking-[-1.8px] md:text-[60px]">
      Every ticket passes the same line.
    </h2>
    <p class="m-0 mt-5 max-w-[640px] text-[19px] leading-[1.5] text-[color:var(--lp-ink-2)]">
      Four stations. Agents do the work, and a person decides at every station. You choose who: your client, a developer or you.
    </p>
    <ol class="m-0 mt-12 grid list-none border-t-2 border-[color:var(--lp-ink)] p-0 pt-7 md:grid-cols-2 lg:grid-cols-4">
      <li
        v-for="(s, i) in stations"
        :key="s.n"
        class="flex flex-col gap-[14px] border-dashed border-[color:var(--lp-ink)] pb-8 lg:min-h-[317px] lg:px-[22px] lg:pb-2"
        :class="i === 0 ? 'lg:pl-0' : 'lg:border-l'"
      >
        <div class="flex items-center gap-3">
          <img :src="`/landing/${s.avatar}.svg`" alt="" width="44" height="44" />
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
