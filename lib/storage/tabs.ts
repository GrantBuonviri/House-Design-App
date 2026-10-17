/** The channel every tab of the app talks on, to notice a house open in two tabs. */
export const TABS_CHANNEL = "house-design-app/tabs";

type TabMessage = { type: "open" | "here" | "closed"; houseId: string; tab: string };

/**
 * Tell other tabs this house is open here, and call `onChange` with how many
 * other tabs have it open, now and whenever that changes. A tab that opens it
 * says "open", tabs that already have it answer "here", and a tab that closes
 * it (or goes away) says "closed". Returns the stop function, which says
 * "closed". Does nothing where the browser has no BroadcastChannel.
 */
export function watchOtherTabs(houseId: string, onChange: (others: number) => void, makeChannel = defaultChannel): () => void {
  const channel = makeChannel();
  if (!channel) return () => {};
  const tab = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
  const others = new Set<string>();
  const post = (type: TabMessage["type"]) => channel.postMessage({ type, houseId, tab } satisfies TabMessage);
  channel.onmessage = (e: MessageEvent) => {
    const m = e.data as Partial<TabMessage> | null;
    if (!m || m.houseId !== houseId || typeof m.tab !== "string" || m.tab === tab) return;
    const before = others.size;
    if (m.type === "closed") others.delete(m.tab);
    else others.add(m.tab);
    if (m.type === "open") post("here");
    if (others.size !== before) onChange(others.size);
  };
  // A tab that goes away (closed, reloaded) without unmounting still says so.
  const onHide = () => post("closed");
  // Coming back from the back/forward cache: say hello again.
  const onShow = (e: PageTransitionEvent) => {
    if (!e.persisted) return;
    if (others.size) onChange(0);
    others.clear();
    post("open");
  };
  const win = typeof window !== "undefined" ? window : null;
  win?.addEventListener("pagehide", onHide);
  win?.addEventListener("pageshow", onShow);
  post("open");
  return () => {
    win?.removeEventListener("pagehide", onHide);
    win?.removeEventListener("pageshow", onShow);
    post("closed");
    channel.close();
  };
}

function defaultChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(TABS_CHANNEL);
}
