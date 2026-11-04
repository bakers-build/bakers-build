<script setup lang="ts">
// Three entry situations, each leading directly to its setup task.
import PillButton from '../primitives/PillButton.vue'
import SectionHead from '../primitives/SectionHead.vue'

const ways = [
  {
    title: 'Work through chat',
    lines: [
      'Project managers and customers connect their own chat account.',
      'Create and plan tickets with the connector.',
      'Follow results on the web while your team runs the work.',
    ],
    href: '/get-started/connector',
    cta: 'Set up a connector',
  },
  {
    title: 'Prepare your first machine',
    lines: [
      'Install the skills and let your AI guide machine setup.',
      'Set up the worker once, then connect the first project.',
      'Run a small ticket and verify its first summary.',
    ],
    href: '/get-started/machine',
    cta: 'Set up a machine',
  },
  {
    title: 'Add a project to your machine',
    lines: [
      'Developers reuse a working machine and connection.',
      'Choose its TUI, development environment and workflow.',
      'Go straight to the first-ticket check.',
    ],
    href: '/get-started/connect-a-project',
    cta: 'Set up a project',
  },
]
</script>

<template>
  <div class="relative z-[2] px-6 pt-[140px]">
    <SectionHead kicker="THREE WAYS IN">
      <template #title>Start where you are</template>
      <template #lead>
        Connect your chat, prepare a developer machine, or add a project to a
        machine that already works.
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
