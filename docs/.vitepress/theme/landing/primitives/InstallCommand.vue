<script setup lang="ts">
// The hero install command as a real code box with the classic copy button
// (prototype iteration 10): clipboard.writeText with execCommand fallback,
// check icon + mint border for 1.6s.
import { onBeforeUnmount, ref } from 'vue'

const props = defineProps<{ command: string }>()

const copied = ref(false)
let tid: ReturnType<typeof setTimeout> | undefined

async function copy() {
  const text = props.command
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  copied.value = true
  clearTimeout(tid)
  tid = setTimeout(() => (copied.value = false), 1600)
}

onBeforeUnmount(() => clearTimeout(tid))
</script>

<template>
  <div
    class="inline-flex items-center gap-3 rounded-xl border border-[rgba(186,156,255,.2)] bg-[rgba(5,4,12,.85)] py-[10px] pl-[22px] pr-3 font-mono text-[15.5px] text-[#DDD6F3] shadow-[0_10px_34px_rgba(0,0,0,.4),inset_0_1px_0_rgba(255,255,255,.05)]"
  >
    <span class="select-none text-[#6E6A8A]">$</span> {{ command }}
    <button
      type="button"
      class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border bg-white/[.05] text-[color:var(--lp-text-2)] transition-colors duration-200 hover:bg-[rgba(164,143,255,.12)] hover:text-white"
      :class="copied ? 'border-[rgba(127,239,210,.45)]' : 'border-white/[.12] hover:border-[rgba(186,156,255,.5)]'"
      aria-label="Copy install command"
      title="Copy"
      @click="copy"
    >
      <svg v-if="!copied" class="block h-[15px] w-[15px]" viewBox="0 0 16 16" fill="none">
        <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4" />
        <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3.5A1.5 1.5 0 0 0 2 3v5.5A1.5 1.5 0 0 0 3.5 10H4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
      <svg v-else class="block h-[15px] w-[15px] text-[color:var(--lp-mint)]" viewBox="0 0 16 16" fill="none">
        <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </div>
</template>
