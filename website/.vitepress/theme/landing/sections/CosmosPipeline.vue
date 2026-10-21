<script setup lang="ts">
// c-blackhole + the pipeline c-frame — the canvas black hole whose center
// sits exactly ON the pipeline frame's top border; the lower hemisphere
// renders BEHIND the frame and is frosted by its backdrop-filter
// (Reflect's exact layering). The AGENT/HUMAN state pipeline lives in the
// double glass frame with the light beam on its top edge.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import GlassFrame from '../primitives/GlassFrame.vue'
import { createBlackHole, type BlackHole } from '../blackhole'

const canvas = ref<HTMLCanvasElement>()
const frameWrap = ref<HTMLElement>()
let hole: BlackHole | undefined

const stages = [
  {
    cls: 's1',
    who: 'AGENT',
    human: false,
    name: 'qualification',
    text: 'The agent reads the ticket, classifies it as bug or feature, and publishes a versioned handoff before any work starts.',
  },
  {
    cls: 's2',
    who: 'AGENT',
    human: false,
    name: 'spec',
    text: 'Design decisions, an implementation plan and checkable acceptance criteria. You approve one scope before anything is built.',
  },
  {
    cls: 's3',
    who: 'AGENT',
    human: false,
    name: 'coding',
    text: 'Implemented in an isolated git worktree on its own branch; the acceptance checks run before the agent hands the ticket over.',
  },
  {
    cls: 's4',
    who: 'AGENT + YOU',
    human: true,
    name: 'review',
    text: 'A second agent gives an independent verdict with findings; you confirm it, or send the ticket back with what you expected.',
  },
  {
    cls: 's5',
    who: 'YOU',
    human: true,
    name: 'done ✓',
    text: "You authorize the merge. The ticket closes and its status is mirrored back to the customer's origin issue.",
  },
]

onMounted(() => {
  if (!canvas.value || !frameWrap.value) return
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  hole = createBlackHole(canvas.value, frameWrap.value, reduceMotion)
})
onBeforeUnmount(() => hole?.destroy())
</script>

<style>
/* the light beam on the frame's top edge + the sequential rounded stage
 * highlights — keyframes with per-stage delays, no utility equivalent */
.lp-beam {
  position: absolute;
  top: -1.5px;
  left: 4%;
  right: 4%;
  height: 2.5px;
  border-radius: 3px;
  z-index: 2;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(229, 156, 255, 0.9) 26%,
    #fff 50%,
    rgba(156, 178, 255, 0.9) 74%,
    transparent
  );
  box-shadow:
    0 0 18px rgba(229, 156, 255, 0.95),
    0 0 52px rgba(164, 143, 255, 0.7),
    0 0 120px rgba(164, 143, 255, 0.45);
}
.lp-stage {
  position: relative;
  isolation: isolate;
}
.lp-stage::after {
  content: '';
  position: absolute;
  inset: 8px;
  border-radius: 14px;
  pointer-events: none;
  opacity: 0;
  z-index: -1;
  background: linear-gradient(180deg, rgba(164, 143, 255, 0.16), transparent 80%);
}
.lp-stage.s5::after {
  background: linear-gradient(180deg, rgba(127, 239, 210, 0.14), transparent 80%);
}
@media (prefers-reduced-motion: no-preference) {
  .lp-beam {
    animation: lp-beam 6s ease-in-out infinite alternate;
  }
  @keyframes lp-beam {
    from {
      opacity: 0.85;
    }
    to {
      opacity: 1;
    }
  }
  .lp-stage::after {
    animation: lp-stageglow 14s ease-in-out infinite;
  }
  .lp-stage.s1::after {
    animation-delay: 0s;
  }
  .lp-stage.s2::after {
    animation-delay: 2.6s;
  }
  .lp-stage.s3::after {
    animation-delay: 5.2s;
  }
  .lp-stage.s4::after {
    animation-delay: 7.8s;
  }
  .lp-stage.s5::after {
    animation-delay: 10.4s;
  }
  @keyframes lp-stageglow {
    0% {
      opacity: 0;
    }
    6% {
      opacity: 1;
    }
    20% {
      opacity: 1;
    }
    30% {
      opacity: 0;
    }
    100% {
      opacity: 0;
    }
  }
  .lp-stage.s4 .lp-who {
    animation: lp-humanpulse 14s ease-in-out infinite;
    animation-delay: 7.8s;
  }
  @keyframes lp-humanpulse {
    0%,
    30%,
    100% {
      filter: brightness(1);
    }
    8%,
    20% {
      filter: brightness(1.6);
    }
  }
}
</style>

<template>
  <div class="relative z-[1] -mt-[6px]">
    <canvas
      ref="canvas"
      class="mx-auto block h-[640px] w-full max-w-[1360px] max-[860px]:h-[460px]"
      aria-label="Tickets falling into the bakers.build horizon"
      role="img"
    />
    <div ref="frameWrap" class="relative z-[2] mx-auto -mt-[282px] max-w-[1200px] max-[860px]:-mt-[200px]">
      <GlassFrame>
        <template #chrome>
          <span class="lp-beam" aria-hidden="true" />
        </template>
        <div class="flex items-center gap-2 px-4 pb-3.5 pt-3 text-[13.5px] text-[color:var(--lp-text-3)]">
          <span class="h-[11px] w-[11px] rounded-full bg-white/[.12]" />
          <span class="h-[11px] w-[11px] rounded-full bg-white/[.12]" />
          <span class="h-[11px] w-[11px] rounded-full bg-white/[.12]" />
          &nbsp; a ticket, moving through its states
        </div>
        <div class="flex max-[860px]:flex-col">
          <div
            v-for="(s, i) in stages"
            :key="s.cls"
            class="lp-stage flex-1 border-l border-white/[.06] px-[26px] pb-[30px] pt-[26px] max-[860px]:border-l-0 max-[860px]:border-t max-[860px]:border-white/[.06]"
            :class="[s.cls, { 'border-l-0 max-[860px]:!border-t-0': i === 0 }]"
          >
            <span
              class="lp-who text-[11.5px] font-extrabold tracking-[.08em]"
              :class="s.human ? 'lp-human-text' : 'lp-badge-text'"
              >{{ s.who }}</span
            >
            <h3 class="mb-2 mt-[7px] text-[18px] font-semibold text-[color:var(--lp-text-1)]">{{ s.name }}</h3>
            <p class="text-[14.5px] leading-[1.62] text-[color:var(--lp-text-2)]">{{ s.text }}</p>
          </div>
        </div>
      </GlassFrame>
    </div>
  </div>
</template>
