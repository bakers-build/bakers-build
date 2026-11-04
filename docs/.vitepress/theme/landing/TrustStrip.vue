<template>
  <ul class="lp-mono m-0 flex list-none flex-wrap justify-center gap-x-[52px] gap-y-3 border-b-[1.5px] border-dashed border-[color:var(--lp-rule)] bg-[color:var(--lp-paper)] p-4 text-[14px] font-medium">
    <li v-for="item in ['Open source', 'Your code stays on your machines', 'Every run recorded']" :key="item" class="flex items-center gap-[10px]">
      <img src="/landing/spark-trust.svg" alt="" width="15" height="15" />
      {{ item }}
    </li>
  </ul>
</template>
