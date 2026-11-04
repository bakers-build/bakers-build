<script setup lang="ts">
// c-faq — six styled details/summary items before the final CTA.
import SectionHead from '../primitives/SectionHead.vue'

const items = [
  {
    q: 'Which agents does bakers.build support?',
    a: 'Claude Code, Codex, Grok, Kimi, OpenCode and Pi ship as addons today, each running on your own subscription. An agent is a plugin, so adding another CLI is an addon package, not a fork, and choosing the agent for a machine is one line in its machine config.',
  },
  {
    q: 'Do I need to host something?',
    a: 'Like GitLab, you choose. Use a hosted bakers.build server and get an account there, or run your own: one server, the control plane, that holds projects, tickets and runs. Either way conductors and agents run on your own machines and connect outward to it.',
  },
  {
    q: 'Does my code leave my machines?',
    a: 'No. Conductors work in local git worktrees on hardware you own, and agents talk to their model providers under your own keys. The server stores tickets, states, handoff comments and each run\'s footprint. A self-run server also keeps run transcripts, unless you turn that off per conductor; hosted bakers.build keeps handoffs and footprint only.',
  },
  {
    q: 'Can a human own a workflow state?',
    a: 'Any state can be owned by a human or an agent, and you change it per state in WORKFLOW.md. The shipped setup lets agents qualify, spec, code and review; you confirm the plan, the result and the verdict, and you authorize the merge.',
  },
  {
    q: 'How is this different from a coding agent in my editor?',
    a: 'An editor agent helps one person in one session. bakers.build runs the whole lifecycle across a team: tickets queue up centrally, any registered machine picks them up, every run is recorded with its transcript and footprint, and the process itself is versioned in the repo.',
  },
  {
    q: 'What does it cost?',
    a: "bakers.build is MIT licensed and free. You pay only what you already pay: your own infrastructure and your agents' model usage. Every run shows its tokens, turns and tool calls on the ticket.",
  },
  {
    q: 'Our stack is not Drupal. Does bakers.build still fit?',
    a: 'Yes. bakers.build does not care about your stack; step skills do. Drupal with DDEV and documentation ship today, and a developer writes a step skill for another stack once. Until then, documentation tickets and anything without build checks already run.',
  },
  {
    q: 'What if nothing starts?',
    a: 'Check three things on the ticket page: it names your conductor and that conductor is online, no blocking ticket is still open, and the header shows no reason such as frozen or failing. The first-ticket guide walks you through it.',
  },
  {
    q: 'How do I answer the agent when it asks me something?',
    a: 'In its terminal tab on the machine that runs the ticket; your workspace manager opens one per ticket. A comment on the ticket page reaches the next step instead.',
  },
]
</script>

<template>
  <div class="relative z-[2] px-6 pt-[140px]">
    <SectionHead kicker="FAQ">
      <template #title>Questions, answered</template>
    </SectionHead>
    <div class="sr dl2 mx-auto max-w-[800px]">
      <details
        v-for="it in items"
        :key="it.q"
        class="group mb-3 rounded-2xl border border-[color:var(--lp-panel-border)] bg-[linear-gradient(180deg,rgba(255,255,255,.028),rgba(255,255,255,.012))] transition-colors duration-300 open:border-[rgba(186,156,255,.35)] hover:border-[rgba(186,156,255,.35)]"
      >
        <summary
          class="flex cursor-pointer list-none items-center justify-between gap-4 px-[26px] py-[22px] text-[18px] font-semibold [&::-webkit-details-marker]:hidden"
        >
          {{ it.q }}
          <span
            class="flex-none text-[15px] text-[color:var(--lp-text-3)] transition-transform duration-300 group-open:rotate-90 group-open:text-[#BA9CFF]"
            aria-hidden="true"
            >›</span
          >
        </summary>
        <div class="max-w-[68ch] px-[26px] pb-6 text-[16px] leading-[1.65] text-[color:var(--lp-text-2)]">{{ it.a }}</div>
      </details>
    </div>
  </div>
</template>
