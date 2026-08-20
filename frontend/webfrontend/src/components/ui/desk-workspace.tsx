/**
 * The desk's three-pane workspace, with panes the user can resize.
 *
 * Desktop gets draggable separators whose widths persist to `localStorage`, so a trader who
 * wants a narrow watchlist and a wide chart sets it once. Below `lg` the panes stack and the
 * separators go away: dragging a 3-column split on a phone is not a feature, and a persisted
 * desktop width applied to a 390px viewport would be a bug.
 *
 * The two branches are separate trees rather than the same tree restyled, because `Group`
 * measures its own children — it cannot be told to stop being a group at a breakpoint. The
 * panes themselves are passed in as nodes, so neither branch duplicates their content.
 */
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { useMinWidth } from "@/hooks/useBreakpoint";

/** Tailwind's `lg`. Matches the class-based breakpoints used everywhere else on the desk. */
const LG = 1024;
const LAYOUT_ID = "stocks360:desk-panes";

/**
 * `useDefaultLayout` reads its saved layout eagerly, including during the server render, where
 * `localStorage` does not exist — and the resulting throw aborted SSR for the whole route,
 * dropping it to client-only rendering (React #419). This adapter answers "nothing saved" on
 * the server so the server render gets the default layout and the client restores the real one.
 * Module scope keeps the reference stable across renders.
 */
const ssrSafeStorage = {
  getItem: (key: string) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
  setItem: (key: string, value: string) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
};

/** Grab handle: a hairline that thickens and picks up the accent while dragged. */
function Handle({ orientation }: { orientation: "horizontal" | "vertical" }) {
  const vertical = orientation === "horizontal"; // a horizontal group has vertical separators
  return (
    <Separator
      className={`group relative shrink-0 bg-overlay-border transition-colors data-[state=dragging]:bg-primary ${
        vertical ? "w-px cursor-col-resize hover:bg-primary/60" : "h-px cursor-row-resize hover:bg-primary/60"
      }`}
    >
      {/* The hit area is deliberately larger than the visible line — a 1px target is unusable. */}
      <span
        className={`absolute ${
          vertical ? "inset-y-0 -left-1 -right-1" : "inset-x-0 -top-1 -bottom-1"
        }`}
      />
    </Separator>
  );
}

export function DeskWorkspace({
  watchlist,
  chart,
  rail,
  dock,
}: {
  watchlist: React.ReactNode;
  chart: React.ReactNode;
  rail: React.ReactNode;
  dock: React.ReactNode;
}) {
  const wide = useMinWidth(LG);
  const panes = useDefaultLayout({
    id: LAYOUT_ID,
    panelIds: ["watchlist", "chart", "rail"],
    storage: ssrSafeStorage,
  });
  const rows = useDefaultLayout({
    id: `${LAYOUT_ID}:rows`,
    panelIds: ["work", "dock"],
    storage: ssrSafeStorage,
  });

  if (!wide) {
    // Stacked, in reading order: what to trade, the chart, then the ticket and book.
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {watchlist}
        {chart}
        {rail}
        {dock}
      </div>
    );
  }

  return (
    <Group
      orientation="vertical"
      className="flex min-h-0 flex-1 flex-col"
      defaultLayout={rows.defaultLayout}
      onLayoutChanged={rows.onLayoutChanged}
    >
      <Panel id="work" defaultSize="72%" minSize="35%" className="flex min-h-0 flex-col">
        <Group
          orientation="horizontal"
          className="flex min-h-0 flex-1"
          defaultLayout={panes.defaultLayout}
          onLayoutChanged={panes.onLayoutChanged}
        >
          <Panel
            id="watchlist"
            defaultSize="17%"
            minSize="12%"
            maxSize="34%"
            className="flex min-h-0 flex-col"
          >
            {watchlist}
          </Panel>
          <Handle orientation="horizontal" />
          <Panel id="chart" defaultSize="58%" minSize="30%" className="flex min-w-0 flex-col">
            {chart}
          </Panel>
          <Handle orientation="horizontal" />
          <Panel
            id="rail"
            defaultSize="25%"
            minSize="16%"
            maxSize="40%"
            className="flex min-h-0 flex-col"
          >
            {rail}
          </Panel>
        </Group>
      </Panel>
      <Handle orientation="vertical" />
      <Panel id="dock" defaultSize="28%" minSize="8%" className="flex min-h-0 flex-col">
        {dock}
      </Panel>
    </Group>
  );
}

/** Clears saved pane sizes so the desk returns to its default proportions on next paint. */
export function resetDeskLayout() {
  if (typeof window === "undefined") return;
  for (const key of Object.keys(window.localStorage)) {
    if (key.includes(LAYOUT_ID)) window.localStorage.removeItem(key);
  }
  window.location.reload();
}
