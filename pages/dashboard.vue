<script lang="ts" setup>
const { loggedIn } = useUserSession()
</script>

<script lang="ts">
const authenticate = async () => {
  await navigateTo('/auth/github', { external: true })
}
</script>

<template lang="pug">
ShortlinkList(v-if="loggedIn")
div.flex.flex-col.items-center.justify-center.h-screen(v-if="!loggedIn")
  button(@click="authenticate") Authenticate with GitHub
</template>
<style lang="scss">
@import '~/assets/dashboard.scss';
</style>
