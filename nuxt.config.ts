// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  mode: "univeral",
  target: "static",
  modules: [
    "@nuxtjs/supabase",
    "@nuxtjs/tailwindcss",
    "nuxt-headlessui",
    "@nuxtjs/robots",
  ],
  supabase: {
    redirect: false,
  },
  robots: {
    UserAgent: "*",
    Disallow: "/",
  },
});
