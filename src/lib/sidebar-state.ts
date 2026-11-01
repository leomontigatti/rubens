import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

// The cookie shadcn's `SidebarProvider` writes when the sidebar is toggled, and
// leaves for the app to read: the server must render the sidebar as it was left.
const cookieName = "sidebar_state";

/** Whether the sidebar opens expanded: unless the member collapsed it. */
export const sidebarStartsOpen = createIsomorphicFn()
  .server(() => getCookie(cookieName) !== "false")
  .client(() => !document.cookie.includes(`${cookieName}=false`));
