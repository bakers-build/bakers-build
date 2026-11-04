<script setup lang="ts">
// The install command box with its copy control (Figma "Install-Befehl · kopierbar"),
// optionally under a mono label. `tall` is the CTA groups' 47 px box beside the button.
import { ref } from 'vue'
import { INSTALL, type Copy } from './copy'

defineProps<{ t: Copy['copy']; label?: string; tall?: boolean; small?: boolean }>()
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(INSTALL)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // No clipboard access (insecure context, denied permission): the command stays selectable.
  }
}
</script>

<template>
  <div class="max-w-full">
    <p v-if="label" data-install-label class="lp-mono m-0 text-[13px] font-medium leading-[18.2px] text-[color:var(--lp-ink-2)]">{{ label }}</p>
    <div
      data-install
      class="flex w-fit max-w-full items-center gap-3 rounded-[8px] border-[1.5px] border-[color:var(--lp-ink)] bg-[color:var(--lp-paper)] pl-3 pr-2"
      :class="[label ? 'mt-[6px]' : '', tall ? 'h-[47px]' : 'py-[5.5px] pl-[13.5px]']"
    >
      <code
        class="lp-mono min-w-0 overflow-x-auto whitespace-nowrap font-medium"
        :class="small ? 'text-[13px] leading-[18.2px] text-[color:var(--lp-ink-2)]' : 'text-[14px] leading-[19.6px]'"
      >{{ INSTALL }}</code>
      <button
        type="button"
        data-copy
        class="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] hover:bg-[color:var(--lp-flour)]"
        :aria-label="t.label"
        :title="t.label"
        @click="copy"
      >
        <img src="/landing/icon-copy.svg" alt="" width="14" height="14" />
      </button>
      <span class="sr-only" role="status">{{ copied ? t.done : '' }}</span>
    </div>
  </div>
</template>
