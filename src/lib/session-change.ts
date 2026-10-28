// A sign-in or a sign-out loads the app afresh in every open tab. Whatever the
// tab holds in memory (the router's loader cache, the query cache, the screen
// itself) belongs to whoever was signed in before, so a full page load drops
// it all instead of each cache being cleared by hand.

const channelName = "rubens-session";

/** Tells the app's other tabs that the session changed, then loads `path` afresh here. */
export function startNewSession(path: string): void {
  const channel = new BroadcastChannel(channelName);
  channel.postMessage("changed");
  channel.close();
  window.location.assign(path);
}

/** Calls `listener` when another tab signs in or out; returns the unsubscribe. */
export function onSessionChange(listener: () => void): () => void {
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = () => listener();
  return () => channel.close();
}
