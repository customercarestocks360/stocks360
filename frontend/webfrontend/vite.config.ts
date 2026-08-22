import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

/**
 * Fail the production build when the backend URL is missing, rather than shipping a bundle
 * that points every visitor's browser at 127.0.0.1.
 *
 * This is the whole reason deploying is "set the env vars and push": a forgotten variable
 * stops the build in the provider's log, where somebody is already looking, instead of
 * producing a green deploy that is broken for every user. `loadEnv` reads the `.env` files
 * *and* any `VITE_`-prefixed variable from the process environment, which is how Vercel's
 * dashboard values arrive.
 */
function assertDeployConfig(mode: string, root: string): void {
  if (mode !== "production") return;
  const env = loadEnv(mode, root, "VITE_");
  // Bracket access: loadEnv returns a plain index-signature record, which
  // noPropertyAccessFromIndexSignature forbids reading with a dot.
  if (!env["VITE_API_BASE_URL"]?.trim()) {
    throw new Error(
      "\n\nVITE_API_BASE_URL is not set, so this build has no backend to talk to." +
        "\nSet it to the FastAPI origin (e.g. https://api.stocks360.com) in your hosting" +
        "\nprovider's environment variables, then redeploy." +
        "\nSee .env.example for the full list.\n",
    );
  }
}

export default defineConfig(({ mode }) => {
  const root = process.cwd();
  assertDeployConfig(mode, root);

  return {
    server: {
      host: "localhost",
      port: 5173,
      strictPort: true,
    },
    resolve: {
      tsconfigPaths: true,
    },
    plugins: [
      tanstackStart(),
      react(),
      tailwindcss(),
      // Last, and after tanstackStart: nitro takes the SSR bundle and packages it for
      // whatever host it detects. On Vercel it emits .vercel/output (Build Output API v3)
      // with its own routing config, which is what makes deploying zero-config. Locally it
      // emits .output/server/index.mjs, runnable with `npm start`.
      nitro(),
    ],
    // Points nitro at the custom server entry, which keeps the h3-swallowed-error handling
    // in src/server.ts on the request path.
    environments: {
      ssr: { build: { rollupOptions: { input: "./src/server.ts" } } },
    },
  };
});
