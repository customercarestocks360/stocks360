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
| `npm run build`    | Creates a production build in `.output/`                       |
| `npm run build:dev`| Creates a development-mode build (unminified, with source maps)|
| `npm run preview`  | Serves the production build locally for testing                |
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
Configuration for the **Vite** build tool. Registers four plugins:
- **`tanstackStart`** — Enables TanStack Start's SSR and server functions, pointing to `server.ts` as the server entry.
- **`react`** — React JSX transform and Fast Refresh for hot-reload.
- **`tailwindcss`** — Tailwind CSS v4 integration via the Vite plugin.
- **`tsconfigPaths`** — Resolves the `@/*` path alias defined in `tsconfig.json`.

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
Files excluded from version control: `node_modules`, build output (`.output`, `dist`), Cloudflare Wrangler state, editor configs, and log files.

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

## Build & Deploy

```sh
# Create a production build
npm run build

# Preview the production build locally
npm run preview
```

The production build outputs to `.output/`. The app uses **Nitro** as its server runtime, which supports deployment to various platforms (Node.js, Cloudflare Workers, etc.).

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
