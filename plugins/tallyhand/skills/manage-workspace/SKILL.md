---
name: manage-workspace
description: "Manage Tallyhand settings, cloud backups/import/reset, public shares and secure account controls; diagnose connection and validation errors."
---

# Manage the workspace

Use get_profile to identify the connected account and get_workspace_capabilities before provider-specific operations. Read settings before changing them; validate update_settings with dryRun=true. Field-level errors identify the exact patch property to correct. Do not drop unrelated valid changes silently.

For cloud import/reset, export_workspace_backup first, save the returned bundle in the user's chosen safe location, and retain its revision. Explain replacement and share-link revocation. Obtain explicit approval, then use the exact required confirmation phrase and expectedRevision. A revision conflict means export and review again; never force or blindly retry. Hosted tools cannot read an older offline browser's local storage. Use get_control_link for that browser's export instructions.

Use OAuth in the host or tally login locally. Never request passwords, API keys or OAuth codes in tool arguments. If a tool reports insufficient_scope, ask for the host's targeted consent upgrade. A 503 auth_temporarily_unavailable is retryable and does not require reconnecting. Genuine invalid/expired credentials may require reconnecting. Never claim authentication is stable from one successful call.

Account credentials, user roles, payment authorization, browser notifications and PWA installation stay in their secure UIs via get_control_link. Do not invent automation, permissions or unsupported payment capabilities.
