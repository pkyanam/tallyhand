# AgentID sign-in

Hosted Tallyhand accepts AgentID through Clerk's built-in `oauth_agentid` connection. Agent identities receive their own Clerk user and workspace; the human owner's email is not used to merge accounts or grant access to another workspace.

From the project root, run `npx @agentmail/agentid-cli init`, select the Tallyhand application and the intended Clerk environment, and approve registration in your browser. Run the initializer again with `--enable-sso` to enable sign-up and sign-in without replacing the registered client. Standard `openid email profile` scopes are sufficient; owner scopes are optional and require additional consent and application handling.

The production callback is `https://clerk.tallyhand.xyz/v1/oauth_callback`. The CLI stores credentials in ignored, owner-readable `.env.local` and configures the client secret directly in Clerk. Set `AGENTID_CLIENT_ID` in the web deployment to show the explicit AgentID button on `/login`; the web application does not need the client secret. The existing Clerk widget handles `/login/sso-callback` and any remaining account-creation steps.

Validate with `npx @agentmail/agentid-cli doctor --clerk-app <application-id> --clerk-instance prod`. Confirm the live button reaches AgentID, then complete a sign-in using an agent identity to verify account creation and workspace access. Clerk bot sign-up protection can prevent agents from completing new registrations; check the instance's policy before an automated signup test.

Reference: https://www.agentid.com/docs/clerk

## Autonomous entry and workspace setup

Set the AgentID application’s initiate-login URL to `https://tallyhand.xyz/login/agentid`. This entry starts the Clerk AgentID connection automatically and preserves a validated local `next` path through both sign-in and account creation. The regular `/login` page remains available for humans and manual provider selection.

For the CLI, run `tally config set api-url https://tallyhand.xyz`, then `tally login --oauth --agentid`. On macOS the authorization URL opens in Helium; `--no-open` prints the URL instead. The CLI uses state, PKCE S256, an exact loopback callback, and the Tallyhand resource audience. It stores credentials in an atomic private (0600) local configuration file and refreshes expiring tokens. `tally auth status` never returns secrets; `tally auth logout` clears the local grant and requests issuer revocation when supported. Environment/flag API tokens still take precedence. Avoid concurrent processes refreshing the same credential file.

After authentication, use `tally setup --json`, REST `/api/v1/onboarding`, or MCP `get_onboarding`. Time tracking works with defaults; invoicing readiness identifies missing business details. Preview configuration before applying it; creating clients, projects and tasks remains explicit. Capabilities describe actual caller scopes, role and backend support. Generic workspace requests enforce the same REST authorization and validation as named tools. AgentID does not grant an administrator role or bypass external payment authorization, device permissions or destructive-action confirmations.

Convex workspace revision polling and durable receipt status help agents reconcile interrupted requests. They are not an event log or a background worker. Existing recurring runs create drafts and need the browser or an external authenticated runner; sending invoices and recording payments remain explicit operations.
