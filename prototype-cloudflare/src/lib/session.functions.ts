import { createServerFn } from "@tanstack/react-start";

import { authMode } from "./identity";

/** Which sign-in the app shows: Clerk's, or the dev one when no Clerk key is set. */
export const getAuthMode = createServerFn({ method: "GET" }).handler(async () => authMode());
