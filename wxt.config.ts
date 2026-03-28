import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "React Dev Toolkit",
    description: "Developer toolkit for inspecting and debugging React applications",
    version: "0.1.0",
    permissions: ["storage"],
    devtools_page: "devtools.html",
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
