# AgentID sign-in

Hosted Tallyhand accepts AgentID through Clerk's built-in `oauth_agentid` connection. Agent identities receive their own Clerk user and workspace; the human owner's email is not used to merge accounts or grant access to another workspace.

From the project root, run `npx @agentmail/agentid-cli init`, select the Tallyhand application and the intended Clerk environment, and approve registration in your browser. Run the initializer again with `--enable-sso` to enable sign-up and sign-in without replacing the registered client. Standard `openid email profile` scopes are sufficient; owner scopes are optional and require additional consent and application handling.

The production callback is `https://clerk.tallyhand.xyz/v1/oauth_callback`. The CLI stores credentials in ignored, owner-readable `.env.local` and configures the client secret directly in Clerk. Set `AGENTID_CLIENT_ID` in the web deployment to show the explicit AgentID button on `/login`; the web application does not need the client secret. The existing Clerk widget handles `/login/sso-callback` and any remaining account-creation steps.

Validate with `npx @agentmail/agentid-cli doctor --clerk-app <application-id> --clerk-instance prod`. Confirm the live button reaches AgentID, then complete a sign-in using an agent identity to verify account creation and workspace access. Clerk bot sign-up protection can prevent agents from completing new registrations; check the instance's policy before an automated signup test.

Reference: https://www.agentid.com/docs/clerk
