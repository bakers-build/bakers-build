<script setup lang="ts">
// c-chat (CONDUCTORS) — the run showcase as a fixed-height chat window:
// the ticket + live state chip pinned ABOVE the feed, bottom-anchored feed
// pushing the oldest messages up through the top fade mask with a FLIP
// push-up (feed offset by the incoming message's measured height, eased
// back). 14 bakers.build-true steps; play-once with the returning replay button.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import GlassFrame from '../primitives/GlassFrame.vue'
import MagicButton from '../primitives/MagicButton.vue'
import SectionHead from '../primitives/SectionHead.vue'

type Step =
  | { kind: 'sys'; mark: 'ok' | 'back'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'human'; text: string }
  | { kind: 'mr' }

const steps: Step[] = [
  { kind: 'sys', mark: 'ok', text: 'conductor studio-m1 claimed BB-142 · worktree feat/bb-142' },
  { kind: 'agent', text: 'Run intake: loading @bakers-build/implement-ticket, reading the spec handoff and the acceptance criteria.' },
  { kind: 'agent', text: 'Implementation complete in the worktree. Running the acceptance validation before handoff.' },
  { kind: 'sys', mark: 'ok', text: 'playwright · 12 passed, 0 failed · login-redirect.feature' },
  { kind: 'agent', text: 'Verification summary published to the ticket. Writing the next state.' },
  { kind: 'sys', mark: 'ok', text: 'state written: review · run retired by the server' },
  { kind: 'human', text: 'The redirect works, but keep the return URL after login. Sending it back.' },
  { kind: 'sys', mark: 'back', text: 'state written: coding · changes requested' },
  { kind: 'agent', text: 'Preserving the return URL now, regression scenario added to the feature file.' },
  { kind: 'sys', mark: 'ok', text: 'playwright · 13 passed, 0 failed · keeps return URL after login' },
  { kind: 'sys', mark: 'ok', text: 'state written: review' },
  { kind: 'human', text: 'Review is OK. Merge it.' },
  { kind: 'sys', mark: 'ok', text: 'merge authorized by you · merging !241' },
  { kind: 'mr' },
]

const GAP = 13
const feed = ref<HTMLElement>()
const runState = ref('coding')
const runStateCls = ref('')
const mrMerged = ref(false)
const overlayHidden = ref(false)
const playLabel = ref('Play the run')

let playing = false
let timers: ReturnType<typeof setTimeout>[] = []
let reduceMotion = false

function setState(name: string, cls: string) {
  runState.value = name
  runStateCls.value = cls
}
function stepEls(): HTMLElement[] {
  return Array.from(feed.value?.querySelectorAll<HTMLElement>('.lp-step') ?? [])
}
function reset() {
  timers.forEach(clearTimeout)
  timers = []
  stepEls().forEach((s) => {
    s.classList.remove('show', 'enter')
    s.style.visibility = ''
  })
  if (feed.value) {
    feed.value.style.transition = 'none'
    feed.value.style.transform = 'none'
  }
  setState('coding', '')
  mrMerged.value = false
}
function showStep(item: HTMLElement) {
  if (reduceMotion) {
    item.classList.add('show')
    return
  }
  /* FLIP push-up: offset the feed by the incoming message's measured
   * height, then ease back, so older messages glide instead of jump */
  item.style.visibility = 'hidden'
  item.classList.add('show')
  const h = item.offsetHeight + GAP
  const f = feed.value!
  f.style.transition = 'none'
  f.style.transform = `translateY(${h}px)`
  void f.offsetHeight
  item.style.visibility = ''
  item.classList.add('enter')
  f.style.transition = 'transform .62s cubic-bezier(.22,1,.36,1)'
  f.style.transform = 'translateY(0)'
}
function play() {
  if (playing) return
  playing = true
  reset()
  overlayHidden.value = true
  const els = stepEls()
  const gap = reduceMotion ? 60 : 1800
  els.forEach((s, i) =>
    timers.push(
      setTimeout(() => {
        showStep(s)
        if (i === 5) setState('review', 'review')
        if (i === 7) setState('coding', '')
        if (i === 10) setState('review', 'review')
      }, 500 + i * gap),
    ),
  )
  const end = 500 + els.length * gap
  timers.push(
    setTimeout(() => {
      setState('done ✓', 'done')
      mrMerged.value = true
    }, end + 900),
  )
  timers.push(
    setTimeout(() => {
      playLabel.value = 'Replay the run'
      overlayHidden.value = false
      playing = false
    }, end + 2600),
  )
}

onMounted(() => {
  reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  /* &reveal=all renders the played-out state (screenshots, prototype parity) */
  if (new URLSearchParams(location.search).get('reveal') === 'all') {
    stepEls().forEach((s) => s.classList.add('show'))
    setState('done ✓', 'done')
    mrMerged.value = true
    overlayHidden.value = true
  }
})
onBeforeUnmount(() => timers.forEach(clearTimeout))
</script>

<style>
/* steps are display-toggled + class-animated imperatively (FLIP timeline),
 * so their state classes live here rather than in the template */
.lp-step {
  display: none;
}
.lp-step.show {
  display: block;
}
@media (prefers-reduced-motion: no-preference) {
  .lp-step.enter {
    animation: lp-stepin 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes lp-stepin {
    from {
      opacity: 0;
    }
    40% {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
}
</style>

<template>
  <div class="relative z-[2] px-6 pt-[140px]">
    <SectionHead kicker="CONDUCTORS">
      <template #title>Runs where your code runs</template>
      <template #lead>
        A conductor is a daemon on any machine you own. It registers itself,
        claims tickets it can work, creates a git worktree per ticket, and
        drives the agent to the next state.
      </template>
    </SectionHead>
    <GlassFrame class="sr dl2 mx-auto max-w-[780px]">
      <div class="px-[30px] pb-[30px] pt-7 max-[860px]:px-[18px] max-[860px]:pb-6 max-[860px]:pt-[22px]">
        <div class="mb-1.5 text-[22px] font-bold text-[color:var(--lp-text-1)]">Watch a ticket get worked</div>
        <div class="mb-[22px] text-[16px] text-[color:var(--lp-text-3)]">
          A real run, condensed: coding, tests, review, a change request, and the merge.
        </div>
        <div
          class="mb-3.5 flex items-center justify-between gap-3 rounded-xl border border-white/[.12] bg-white/[.04] px-4 py-3 text-[15px] font-semibold"
        >
          <span>BB-142 · Fix login redirect</span>
          <span
            class="rounded-full px-3 py-1 text-[12.5px] font-extrabold tracking-[.06em] transition-colors duration-[400ms]"
            :class="
              runStateCls === 'review'
                ? 'bg-[rgba(255,201,143,.14)] text-[color:var(--lp-human)]'
                : runStateCls === 'done'
                  ? 'bg-[rgba(127,239,210,.14)] text-[color:var(--lp-mint)]'
                  : 'bg-[rgba(164,143,255,.16)] text-[#D3C4FF]'
            "
            >{{ runState }}</span
          >
        </div>
        <div class="relative">
          <div
            class="relative h-[380px] overflow-hidden max-[860px]:h-[340px] [-webkit-mask-image:linear-gradient(180deg,transparent_0,#000_72px)] [mask-image:linear-gradient(180deg,transparent_0,#000_72px)]"
          >
            <div ref="feed" class="absolute bottom-0 left-0 right-0 flex flex-col justify-end gap-[13px] will-change-transform">
              <div v-for="(s, i) in steps" :key="i" class="lp-step">
                <div v-if="s.kind === 'sys'" class="pl-[2px] font-mono text-[14.5px] text-[color:var(--lp-text-2)]">
                  <span :class="s.mark === 'ok' ? 'text-[color:var(--lp-mint)]' : 'text-[color:var(--lp-human)]'">{{
                    s.mark === 'ok' ? '✓' : '↺'
                  }}</span>
                  {{ s.text }}
                </div>
                <div
                  v-else-if="s.kind === 'agent'"
                  class="max-w-[86%] rounded-[14px] border border-[rgba(186,156,255,.26)] bg-[linear-gradient(180deg,rgba(164,143,255,.1),rgba(164,143,255,.04))] px-[18px] py-3.5 text-[16px] leading-[1.55] max-[860px]:max-w-full"
                >
                  <span class="lp-badge-text mb-1.5 block text-[11.5px] font-extrabold tracking-[.08em]">AGENT · CLAUDE</span>
                  {{ s.text }}
                </div>
                <div
                  v-else-if="s.kind === 'human'"
                  class="ml-auto max-w-[86%] rounded-[14px] border border-[rgba(255,201,143,.28)] bg-[linear-gradient(180deg,rgba(255,201,143,.09),rgba(255,201,143,.03))] px-[18px] py-3.5 text-[16px] leading-[1.55] max-[860px]:max-w-full"
                >
                  <span class="lp-human-text mb-1.5 block text-[11.5px] font-extrabold tracking-[.08em]">HUMAN · REVIEWER</span>
                  {{ s.text }}
                </div>
                <div
                  v-else
                  class="flex flex-wrap items-center justify-between gap-3.5 rounded-[14px] border border-[rgba(186,156,255,.3)] bg-[linear-gradient(180deg,rgba(164,143,255,.08),rgba(164,143,255,.02))] px-5 py-4"
                >
                  <div>
                    <div class="text-[15.5px] font-bold">!241 · Fix login redirect</div>
                    <div class="mt-[3px] font-mono text-[13px] text-[color:var(--lp-text-3)]">feat/bb-142 → develop</div>
                  </div>
                  <span
                    class="rounded-full px-3.5 py-[5px] text-[12.5px] font-extrabold tracking-[.05em] transition-colors duration-[400ms]"
                    :class="mrMerged ? 'bg-[rgba(127,239,210,.15)] text-[color:var(--lp-mint)]' : 'bg-[rgba(164,143,255,.18)] text-[#D3C4FF]'"
                    >{{ mrMerged ? 'merged' : 'open' }}</span
                  >
                </div>
              </div>
            </div>
          </div>
          <div
            class="absolute inset-0 z-[3] flex items-center justify-center rounded-[14px] bg-[rgba(8,7,17,.55)] backdrop-blur-[5px] transition-opacity duration-[450ms]"
            :class="{ 'pointer-events-none opacity-0': overlayHidden }"
          >
            <MagicButton :label="playLabel" @click="play" />
          </div>
        </div>
      </div>
    </GlassFrame>
  </div>
</template>
