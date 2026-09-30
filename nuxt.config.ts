// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  modules: ["@nuxtjs/tailwindcss", "nuxt-headlessui", "nuxt-auth-utils"],
  nitro: {
    preset: "aws-lambda",
  },
});
