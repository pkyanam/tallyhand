/**
 * Shared constants for the landing-page auth choice (hosted Clerk mode).
 *
 * Pure module — imported by both `middleware.ts` (edge) and the client-side
 * landing choice screen, so it must stay free of server/client-only APIs.
 */

/** Cookie set by the landing page when the user picks "Use locally". */
export const LOCAL_CHOICE_COOKIE = "tallyhand_local";

/** localStorage key remembering the landing choice ("cloud" | "local"). */
export const LANDING_CHOICE_KEY = "tallyhand.landingChoice";

export type LandingChoice = "cloud" | "local";
