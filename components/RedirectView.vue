<script lang="ts" setup>
import useExternalRedirect from '@/composables/useExternalRedirect'

const props = defineProps<{
  destination: string
  short: string
}>()

if (props.destination) {
  useExternalRedirect(props.destination)
} else {
  const { params } = useRoute()

  const paramsDepth = Object.keys(params).length

  const short =
    props.short ??
    (() => {
      switch (paramsDepth) {
        case 2:
          return `${params.first}/${params.short}`
        case 3:
          return `${params.first}/${params.second}/${params.short}`
        default:
          return params.short
      }
    })()

  const { link } = await $fetch<{ link: string | null }>('/api/resolve', {
    query: { path: short }
  })

  if (link) {
    useExternalRedirect(link)
  } else {
    useExternalRedirect()
  }
}
</script>

<template lang="pug">
div.flex.justify-center.items-center.h-screen.w-screen.bg-black.text-white.text-2xl
  p Redirecting...
</template>
