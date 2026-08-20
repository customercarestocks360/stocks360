import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Retired. FX is a class on the one desk at `/trade`, not a page of its own.
 *
 * This stays as a redirect rather than being deleted outright: the landing page, the wallet
 * and any bookmark or shared link still point at `/forex`, and a 404 for them would be a
 * worse outcome than one line of forwarding. `?symbol=` is carried through so a deep link
 * still opens on its pair.
 */
export const Route = createFileRoute("/forex")({
  beforeLoad: ({ search }) => {
    const symbol = (search as { symbol?: unknown }).symbol;
    throw redirect({
      to: "/trade",
      search: {
        class: "forex" as const,
        ...(typeof symbol === "string" && symbol ? { symbol } : {}),
      },
      replace: true,
    });
  },
});
