<script setup lang="ts">
// c-buttons — .btn-brand / .btn-ghost as one primitive.
withDefaults(defineProps<{ href: string; variant?: 'brand' | 'ghost' }>(), {
  variant: 'brand',
})
</script>

<template>
  <a
    :href="href"
    class="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border px-[30px] py-[14px] text-[16px] font-semibold transition-[transform,background,border-color,box-shadow] duration-[250ms] ease-out active:translate-y-px active:scale-[.98]"
    :class="
      variant === 'brand'
        ? 'border-transparent bg-[linear-gradient(115deg,#7C5CFF,#A48FFF)] text-white shadow-[0_0_28px_rgba(164,143,255,.35),inset_0_1px_0_rgba(255,255,255,.25)] hover:-translate-y-px hover:shadow-[0_0_44px_rgba(164,143,255,.55),inset_0_1px_0_rgba(255,255,255,.25)]'
        : 'border-white/[.12] bg-white/[.04] text-[color:var(--lp-text-1)] hover:-translate-y-px hover:border-[rgba(186,156,255,.45)]'
    "
  >
    <slot />
  </a>
</template>
