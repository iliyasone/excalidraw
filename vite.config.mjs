import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
  build: { rollupOptions: { input: ["index.html", "login.html"] } }, // login.html — страница входа
});
