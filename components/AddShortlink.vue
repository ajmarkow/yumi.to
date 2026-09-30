<script lang="ts" setup>
defineProps<{
  shortlinks: Shortlink[]
}>()

const { loggedIn } = useUserSession()
</script>

<template lang="pug">
li(v-if="loggedIn")#add-shortlink
  button.text-green-500.p-1.w-full.rounded-md(@click="startCreating" v-if="!creating") Create Shortlink
  form(@submit.prevent="addShortlink" v-if="creating")
    input(type="text" v-model="short" class="w-full rounded-md p-2 bg-zinc-700 text-white" placeholder="Short")
    textarea(type="text" v-model="link" class="w-full rounded-md p-2 bg-zinc-700 text-white mt-2" placeholder="Long Link")
    div.flex.flex-row.justify-center
      button.text-gray-400.p-1.rounded-md(@click="cancelCreate") Cancel
      button.text-green-500.p-1.rounded-md(@click="saveCreate") Add Shortlink
</template>
