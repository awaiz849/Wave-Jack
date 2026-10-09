import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    server: {
      allowedHosts: [".trycloudflare.com"],
    },
  },
});
