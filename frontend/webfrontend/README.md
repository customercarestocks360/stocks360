# Webfrontend — Trading Platform UI

A full-stack React trading website built with **TanStack Start**, **Vite**, and **Tailwind CSS v4**. It uses file-based routing (TanStack Router) and server-side rendering via Nitro.

---

## Prerequisites

- **Node.js** ≥ 18 (recommended: install via [nvm](https://github.com/nvm-sh/nvm#installing-and-updating) or [nvm-windows](https://github.com/coreybutler/nvm-windows))
- **npm** (comes with Node.js)

---

## Getting Started

```sh
# 1. Clone the repository
git clone https://github.com/customercarestocks360/Stocks360.git

# 2. Navigate into the Webfrontend folder (note the capital "W")
cd Stocks360/frontend/Webfrontend

# 3. Install dependencies
npm install

# 4. Start the development server
npm run dev
```

The app will be available at **http://localhost:5173** (or the next available port if 5173 is busy).

> ⚠️ **Important:** Always run commands from inside the `frontend/Webfrontend/` directory (capital **W**), not from the project root or `frontend/`. The `package.json` lives here.
>
> ```
> Stocks360/              ← project root (git repo)
> └── frontend/
>     └── Webfrontend/    ← run npm commands HERE
>         ├── package.json
>         ├── src/
>         └── ...
> ```

---

## Available Scripts

| Command            | Description                                                    |
| ------------------ | -------------------------------------------------------------- |
| `npm run dev`      | Starts the Vite dev server with hot-reload                     |
| `npm run build`    | Creates a production build in `.output/` (or `.vercel/output/` when `VERCEL` is set) |
| `npm run build:dev`| Creates a development-mode build (unminified, with source maps)|
| `npm run preview`  | Serves the production build locally for testing                |
| `npm run start`    | Runs the built server directly: `node .output/server/index.mjs` |
| `npm run lint`     | Runs ESLint across the project                                 |
| `npm run format`   | Formats all files with Prettier                                |

---

## Project Structure

```
webfrontend/
├── public/                  # Static assets served as-is
├── src/
│   ├── components/          # React components
│   │   ├── layout/          # Page layout components (Header, Footer, etc.)
│   │   └── ui/              # Reusable UI primitives (shadcn/ui)
│   ├── hooks/               # Custom React hooks
│   ├── lib/                 # Utility functions and helpers
│   ├── routes/              # File-based route definitions (pages)
│   ├── router.tsx           # TanStack Router configuration
│   ├── routeTree.gen.ts     # Auto-generated route tree (DO NOT EDIT)
│   ├── server.ts            # SSR server entry point
│   ├── start.ts             # TanStack Start middleware setup
│   └── styles.css           # Global styles & Tailwind CSS entry
├── .output/                 # Production build output (git-ignored)
├── dist/                    # Client-side build artifacts (git-ignored)
├── node_modules/            # Installed dependencies (git-ignored)
├── package.json             # Project metadata, scripts & dependencies
├── package-lock.json        # Locked dependency versions
├── vite.config.ts           # Vite bundler configuration
├── tsconfig.json            # TypeScript compiler settings
├── components.json          # shadcn/ui configuration
├── eslint.config.js         # ESLint linting rules
├── .prettierrc              # Prettier formatting rules
├── .prettierignore          # Files excluded from Prettier
├── .gitignore               # Files excluded from Git
└── README.md                # This file
```

---

## Root Files Explained

### `package.json`
Project manifest. Defines the project name, npm scripts (`dev`, `build`, `lint`, etc.), runtime dependencies (React, TanStack, Radix UI, Tailwind, etc.), and dev dependencies (TypeScript, ESLint, Vite).

### `package-lock.json`
Auto-generated lock file that pins exact versions of every installed dependency. Ensures consistent installs across machines. **Do not edit manually** — it updates automatically when you run `npm install`.

### `vite.config.ts`
Configuration for the **Vite** build tool. Registers five plugins:
- **`tanstackStart`** — Enables TanStack Start's SSR and server functions.
- **`react`** — React JSX transform and Fast Refresh for hot-reload.
- **`tailwindcss`** — Tailwind CSS v4 integration via the Vite plugin.
- **`tsconfigPaths`** — Resolves the `@/*` path alias defined in `tsconfig.json`.
- **`nitro`** — Packages the SSR bundle for whatever host it detects. Emits `.vercel/output/`
  on Vercel and `.output/` locally. `environments.ssr` points it at `src/server.ts`.

It also runs `assertDeployConfig()`, which **fails the production build** when
`VITE_API_BASE_URL` is unset. That is what makes a forgotten environment variable stop the
deploy in the build log rather than ship a bundle pointing every visitor at `127.0.0.1`.

### `vercel.json`
Build settings only — no routing. Routing is generated by nitro into
`.vercel/output/config.json`, which owns it on a Build Output API deployment. `framework: null`
stops Vercel applying its own preset on top of that output, and the explicit `npm ci` keeps
installs reproducible from `package-lock.json`.

### `tsconfig.json`
TypeScript compiler configuration. Key settings:
- **Target**: ES2022 with React JSX support.
- **Module**: ESNext with Bundler resolution (for Vite compatibility).
- **Strict mode**: Enabled with additional safety checks.
- **Path alias**: `@/*` maps to `./src/*` so you can import like `import { cn } from "@/lib/utils"`.

### `components.json`
Configuration file for **shadcn/ui** (the UI component library). Defines:
- Component style (`new-york`), icon library (`lucide`), and import aliases.
- Used by the `npx shadcn` CLI to know where to install new UI components.

### `eslint.config.js`
ESLint flat config. Enforces:
- Recommended JS and TypeScript rules.
- React Hooks rules (proper dependency arrays, etc.).
- React Refresh rules (warns about non-exportable components).
- Prettier integration (formatting as lint errors).
- Custom rule blocking `server-only` imports (use TanStack Start's approach instead).

### `.prettierrc`
Prettier code formatter settings:
- 100 character line width, semicolons on, double quotes, trailing commas.

### `.prettierignore`
Files that Prettier skips: `node_modules`, build output, lock files, and the auto-generated route tree.

### `.gitignore`
Files excluded from version control: `node_modules`, build output (`.output`, `dist`, `.vercel`),
`.env`, Cloudflare Wrangler state, editor configs, and log files. It also ignores
`pnpm-lock.yaml` / `yarn.lock` / `bun.lockb`: this project is npm-managed, and a second
lockfile makes Vercel guess the package manager — a stale guess installs the wrong tree.

---

## Source Files Explained (`src/`)

### `src/routes/` — Pages (File-Based Routing)

Each file in this directory becomes a route automatically via TanStack Router:

| File              | URL Path     | Description                                      |
| ----------------- | ------------ | ------------------------------------------------ |
| `__root.tsx`      | (all pages)  | Root layout — wraps every page with HTML shell, theme provider, fonts, and global styles |
| `index.tsx`       | `/`          | Landing / home page                              |
| `login.tsx`       | `/login`     | User login page                                  |
| `signup.tsx`      | `/signup`    | User registration page                           |
| `markets.tsx`     | `/markets`   | Markets overview page                            |
| `stocks.tsx`      | `/stocks`    | Stocks trading page                              |
| `crypto.tsx`      | `/crypto`    | Cryptocurrency trading page                      |
| `README.md`       | —            | TanStack Router's route generation guide         |

### `src/router.tsx` — Router Setup
Creates the TanStack Router instance with the auto-generated route tree, React Query integration, and scroll restoration.

### `src/routeTree.gen.ts` — Auto-Generated Route Tree
**Do not edit this file.** It is automatically generated by the TanStack Router plugin from the files in `src/routes/`. It maps file paths to route definitions.

### `src/server.ts` — SSR Server Entry
The Nitro server entry point for server-side rendering. Handles incoming HTTP requests, delegates to TanStack Start's server entry, and provides a fallback error page for catastrophic SSR failures (including h3 swallowed errors).

### `src/start.ts` — TanStack Start Middleware
Configures TanStack Start with two middleware:
- **Error middleware** — Catches unhandled server errors and returns a styled error page.
- **CSRF middleware** — Protects server functions from cross-site request forgery.

### `src/styles.css` — Global Stylesheet
The main CSS file. Imports Tailwind CSS v4, defines CSS custom properties (colors, radii, etc.) for the design system, and contains global base styles.

### `src/components/layout/` — Layout Components

| File             | Purpose                                                  |
| ---------------- | -------------------------------------------------------- |
| `AppLayout.tsx`  | Main page wrapper — combines Header, page content, and Footer |
| `Header.tsx`     | Top navigation bar with logo, nav links, and auth buttons |
| `Footer.tsx`     | Site footer with links and copyright                     |
| `TickerBar.tsx`  | Scrolling stock/crypto price ticker bar                  |

### `src/components/ui/` — UI Primitives (shadcn/ui)

This directory contains **48 reusable UI components** installed from [shadcn/ui](https://ui.shadcn.com). These are built on top of Radix UI primitives and styled with Tailwind CSS. Examples include `button.tsx`, `card.tsx`, `dialog.tsx`, `input.tsx`, `tabs.tsx`, `tooltip.tsx`, etc.

To add a new UI component:
```sh
npx shadcn@latest add <component-name>
```

### `src/components/ThemeProvider.tsx`
Provides dark/light theme context to the entire app.

### `src/hooks/use-mobile.tsx`
Custom hook that detects whether the viewport is mobile-sized. Used for responsive behavior.

### `src/lib/` — Utilities

| File               | Purpose                                                  |
| ------------------ | -------------------------------------------------------- |
| `config.ts`        | **The only place `import.meta.env` is read.** Resolves `API_BASE_URL` |
| `api.ts`           | Backend HTTP client — bearer tokens, timeouts, `ApiError`, FastAPI error flattening |
| `auth-api.ts`      | Typed wrappers over the backend's `/auth/*` routes        |
| `firebase.ts`      | **The only module that touches the Firebase Web SDK.** Browser-only, loaded dynamically |
| `utils.ts`         | `cn()` helper — merges Tailwind CSS class names with `clsx` + `tailwind-merge` |
| `error-capture.ts` | Captures and stores uncaught errors during SSR for logging |
| `error-page.ts`    | Generates a styled HTML error page for 500 errors        |

---

## Static Assets (`public/`)

| File          | Purpose                               |
| ------------- | ------------------------------------- |
| `mianimg.png` | Main hero/brand image used on pages   |
| `robots.txt`  | Search engine crawler instructions    |

---

## Environment Variables

There is exactly **one** variable, and it is not a secret. See [`.env.example`](.env.example)
for the full reasoning; the short version:

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Yes | Origin of the FastAPI backend, no trailing slash. e.g. `https://api.stocks360.com` |

**Nothing secret can go in a `VITE_` variable.** Vite replaces `import.meta.env.VITE_*` with
literal strings at build time, so every value is compiled into the JavaScript served to every
visitor. Marking it "Sensitive" in a hosting dashboard hides it from the dashboard, not from
the browser.

The two things you might expect here live elsewhere on purpose:

- **Firebase Web SDK config** is fetched at runtime from the backend's `GET /auth/config`, so
  it cannot drift from the project the backend actually verifies tokens against.
- **The Firebase service account and MongoDB URI** are real secrets and exist only in
  `backend/.env`. They have no frontend representation at all.

Locally, copy `.env.example` to `.env`. `.env` is gitignored, so a deployment's configuration
lives in one place: the hosting dashboard.

---

## Deploying to Vercel

Two one-time project settings, then every deploy is just `git push`.

**1. Root Directory → `frontend/webfrontend`**

This is a monorepo, so Vercel has to be told where the app lives (Project → Settings → Build
and Deployment → Root Directory). There is no `vercel.json` key for this — it is the one
setting that must be clicked.

**2. Environment Variables → `VITE_API_BASE_URL`**

Set it to your deployed backend origin, for all environments you want to build (Production,
Preview). If you forget, the build **fails with an explanatory message** instead of deploying
something broken.

Everything else is already in the repo: `vercel.json` pins the install and build commands, and
`npm run build` detects Vercel and emits `.vercel/output/` via nitro's Vercel preset.

### Then, on the backend

Add the Vercel domain to `CORS_ALLOW_ORIGINS` in `backend/.env` and **restart the backend** —
that value is read at import, and `--reload` only watches Python files. Without it every
request from the browser fails CORS preflight:

```
CORS_ALLOW_ORIGINS=https://your-app.vercel.app
```

Preview deployments get their own generated domains, so add those too if you want sign-in to
work on previews.

### Why there are no `rewrites` in `vercel.json`

The "refresh a deep link and get a 404" problem is a *static hosting* problem: the CDN looks
for `/markets/index.html`, finds nothing, and 404s. This app never hits it, because it is
server-rendered. Nitro generates the routing itself, into `.vercel/output/config.json`:

```json
[
  { "src": "/assets/(.*)", "headers": { "cache-control": "public, max-age=31536000, immutable" } },
  { "handle": "filesystem" },
  { "src": "/(.*)", "dest": "/__server" }
]
```

That last rule is the fix: hashed assets are served from the CDN, real files win next, and
**every remaining path goes to the SSR function** — so `/markets`, `/account` and any other
deep link render on a hard refresh. A hand-written `rewrites` block would be redundant at
best; pointed at `/index.html` it would break the site, because this build produces no
`index.html` to rewrite to.

Verified against the production build — every route returns `200` on a cold request, and an
unknown path correctly returns `404` rather than a false `200`.

### Other hosts

Nitro auto-detects most platforms, so the same `npm run build` works elsewhere. Locally, or on
any plain Node host, `.output/` is a self-contained server:

```sh
npm run build
npm run start     # node .output/server/index.mjs
```

---

## Tech Stack

| Technology          | Role                                      |
| ------------------- | ----------------------------------------- |
| React 19            | UI library                                |
| TanStack Start      | Full-stack React framework (SSR + routing)|
| TanStack Router     | File-based routing with type safety       |
| TanStack React Query| Server state management and caching       |
| Vite 8              | Build tool and dev server                 |
| Tailwind CSS v4     | Utility-first CSS framework               |
| shadcn/ui           | Pre-built accessible UI components        |
| Radix UI            | Headless accessible UI primitives         |
| TypeScript          | Static type checking                      |
| ESLint + Prettier   | Code linting and formatting               |
| Nitro               | Server runtime for SSR                    |
| Recharts            | Charting library for data visualizations  |
| Lucide React        | Icon library                              |
