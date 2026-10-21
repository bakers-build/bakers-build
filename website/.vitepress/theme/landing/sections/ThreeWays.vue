<script setup lang="ts">
// c-ways — three ways in, one per kind of reader: with your agent, in the
// browser, for your team. Each card is three lines and one link.
import PillButton from '../primitives/PillButton.vue'
import SectionHead from '../primitives/SectionHead.vue'

const ways = [
  {
    title: 'With your agent in the repo',
    lines: [
      'Describe a ticket; your agent writes it with checkable criteria.',
      'Your conductor runs it on your machine, step by step.',
      'You read each summary and give your verdict in the browser.',
    ],
    href: '/get-started/install',
    cta: 'Set up bakers.build',
  },
  {
    title: 'In the browser only',
    lines: [
      'Connect claude.ai, Claude Desktop or Cowork once.',
      'Create and qualify tickets in your chat, up to the spec.',
      'Follow, answer and accept in the bakers.build web UI. Nothing to install.',
    ],
    href: '/get-started/work-in-the-browser',
    cta: 'Start in the browser',
  },
  {
    title: 'For your team',
    lines: [
      'Connect the project once; your agent writes WORKFLOW.md.',
      'Encode your checks, standards and method; swap agents and tools freely.',
      'Add worker machines when a laptop becomes the limit.',
    ],
    href: '/get-started/is-bakers-right-for-us',
    cta: 'Check the fit',
  },
]
</script>

<template>
  <div class="relative z-[2] px-6 pt-[140px]">
    <SectionHead kicker="THREE WAYS IN">
      <template #title>Start where you are</template>
      <template #lead>
        Developers start on their own machine, project managers in the
        browser, leads with one question: does it fit us?
      </template>
    </SectionHead>
    <div class="sr dl2 mx-auto grid max-w-[1120px] grid-cols-3 gap-5 max-[860px]:grid-cols-1">
      <div
        v-for="w in ways"
        :key="w.title"
        class="flex flex-col rounded-[18px] border border-white/[.07] bg-[rgba(164,143,255,.04)] px-7 py-7"
      >
        <h3 class="mb-4 text-[19px] font-semibold text-[color:var(--lp-text-1)]">{{ w.title }}</h3>
        <ol class="mb-6 flex-1 space-y-2 text-[15.5px] text-[color:var(--lp-text-2)]">
          <li v-for="(l, i) in w.lines" :key="i" class="flex gap-3">
            <span class="lp-badge-text shrink-0 font-mono text-[13px]">{{ i + 1 }}</span>
            <span>{{ l }}</span>
          </li>
        </ol>
        <PillButton :href="w.href" variant="ghost">{{ w.cta }}</PillButton>
      </div>
    </div>
  </div>
</template>
