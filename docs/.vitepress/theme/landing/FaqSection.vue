<script setup lang="ts">
const faqs = [
  ['Does our code leave our machines?', "No. Agents work in git worktrees on your machines, and your repository stays there. If bakers.build hosts it for you, only the control plane runs on our servers. It holds tickets, handoffs and each run's footprint; your code and run transcripts stay with you."],
  ['What does the AI see?', "The ticket and the code it works on. Requests go from your machine straight to your agent's provider, on your own subscription. By default the agent runs in a sandbox and writes only to its own working folder."],
  ['Do I need to install anything?', 'Not if you only write tickets and approve them: you work in the browser or in a chat with Claude. Whoever sets up the line installs the CLI once.'],
  ['Who merges?', 'A person. You confirm the job, approve the plan, confirm the result and authorize the merge.'],
  ['Do I need developers for this?', 'Once, for the setup: a developer sets up the line and the conductor. After that you write tickets and approve them without waiting for free capacity. For more complex changes, you bring in a developer.'],
  ['Which agents can I use?', 'Claude Code, Codex, Grok, Kimi, OpenCode and Pi, on your own subscription. Swappable per project.'],
  ['How is this different from a coding agent in my editor?', 'An editor agent helps one person in one session. bakers.build runs the whole process for a team: tickets queue up centrally, any registered machine can pick them up, every run is recorded, and the process itself is versioned.'],
  ['Does it fit our stack?', 'Yes. Drupal with DDEV and documentation come with ready skills. For another stack, a developer writes a skill once. Until then, documentation tickets and anything without build checks already run.'],
  ['What does it cost?', "Nothing for now. The core is open source, and self-hosted and hosted are both free. Add-ons such as time tracking extend the line; their prices aren't set yet."],
]
</script>

<template>
  <section class="border-t border-[#d9cfbf]">
    <div class="lp-wrap flex flex-col gap-12 py-[88px] lg:flex-row lg:gap-20">
      <div class="flex flex-col gap-5 lg:w-[420px] lg:shrink-0">
        <p class="lp-mono m-0 text-[13px] font-medium text-[color:var(--lp-ink-3)]">Questions</p>
        <h2 class="lp-display m-0 text-[38px] font-extrabold leading-[0.98] tracking-[-1.1px] md:text-[44px]">What people ask first.</h2>
        <p class="m-0 text-[17px] leading-[1.5] text-[color:var(--lp-ink-2)]">The full answer on privacy and security is in the docs.</p>
      </div>
      <dl class="m-0 min-w-0 flex-1">
        <div
          v-for="([q, a], i) in faqs"
          :key="q"
          class="flex flex-col gap-2 border-[color:var(--lp-ink)] py-[22px]"
          :class="i === 0 ? 'border-t-2' : 'border-t border-dashed'"
        >
          <dt class="lp-title text-[22px] leading-[1.25]">{{ q }}</dt>
          <dd class="m-0 text-[16.5px] leading-[1.5] text-[color:var(--lp-ink-2)]">{{ a }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>
