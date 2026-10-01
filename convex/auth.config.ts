import type { AuthConfig } from "convex/server";

// Set this on the Convex deployment to the Clerk instance's issuer URL.
// No hard-coded account identifiers: self-hosters supply their own issuer.
export default {
  providers: process.env.CLERK_JWT_ISSUER_DOMAIN ? [{
    domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
    applicationID: "convex",
  }] : [],
} satisfies AuthConfig;
