<script setup lang="ts">
// c-concepts (ARCHITECTURE) — the concept quartet with the running
// gradient border (featured stronger, others soft), wope hover + in-panel
// stars, and the agent pill strip.
import GradientBorder from '../primitives/GradientBorder.vue'
import MagicalHover from '../primitives/MagicalHover.vue'
import SectionHead from '../primitives/SectionHead.vue'
import StarCanvas from '../primitives/StarCanvas.vue'

const concepts = [
  {
    title: 'Control plane',
    text: 'The shared source of truth for projects, tickets, and runs. Your conductors talk to it over an API; the cockpit UI reads from it live.',
    gb: 'strong' as const,
    sr: 'sr',
  },
  {
    title: 'Conductor',
    text: 'A daemon on any machine you own. It registers itself, claims tickets it can work, creates a git worktree per ticket, and drives the agent.',
    gb: 'soft' as const,
    sr: 'sr dl1',
  },
  {
    title: 'Agents',
    text: 'The AI CLIs doing the work: Claude Code, Codex, Grok, Kimi, OpenCode, Pi. Each is an addon; swapping agents is a config line, not a migration.',
    gb: 'soft' as const,
    sr: 'sr dl2',
  },
  {
    title: 'Skills',
    text: 'The workflow itself, written as versioned skill files in the repo. What "qualify" or "review" means is code-reviewed, not tribal knowledge.',
    gb: 'soft' as const,
    sr: 'sr dl3',
  },
]

const agents = ['Claude Code', 'Codex', 'Kimi', 'OpenCode', 'Pi']
</script>

<template>
  <div class="relative z-[2] px-6 pt-[140px]">
    <SectionHead kicker="ARCHITECTURE">
      <template #title>Four pieces, cleanly separated</template>
      <template #lead>
        A shared control plane, conductors on your machines, the agents you
        already use, and a workflow that lives in your repo.
      </template>
    </SectionHead>
    <div class="mx-auto grid max-w-[1000px] grid-cols-2 gap-[18px] text-left max-[860px]:grid-cols-1">
      <div
        v-for="c in concepts"
        :key="c.title"
        class="group relative rounded-[20px] border border-[color:var(--lp-panel-border)] bg-[linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.014))] px-9 py-[34px] transition-[transform,box-shadow] duration-300 hover:-translate-y-[3px] hover:shadow-[0_16px_44px_rgba(0,0,0,.4)]"
        :class="c.sr"
      >
        <GradientBorder :variant="c.gb" />
        <MagicalHover />
        <StarCanvas :count="45" />
        <h3 class="lp-badge-text relative z-[1] mb-2.5 inline-block text-[20px] font-semibold">{{ c.title }}</h3>
        <p class="relative z-[1] text-[16.5px] leading-[1.6] text-[color:var(--lp-text-2)]">{{ c.text }}</p>
      </div>
    </div>
    <div class="sr dl4 mt-[52px] flex flex-wrap justify-center gap-3">
      <span
        v-for="a in agents"
        :key="a"
        class="rounded-full border border-white/10 bg-white/[.04] px-7 py-3 text-[16px] font-semibold text-[color:var(--lp-text-1)] transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-[2px] hover:border-[rgba(186,156,255,.5)] hover:shadow-[0_0_24px_rgba(164,143,255,.25)]"
        >{{ a }}</span
      >
    </div>
  </div>
</template>
