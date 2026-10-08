# Agent instructions

This file is the shared source of project instructions for Codex and other coding agents. Follow the user's current instructions and the host's tool and permission rules.

## Skill routing

When the user's request matches an available gstack skill, use that skill. Use the host's skill invocation tool when available; otherwise read and follow the installed skill's `SKILL.md`. Do not assume a particular agent, model, or provider is required. Honor the user's preference for proactive suggestions.

Key routing rules:

- Product ideas and brainstorming → `/office-hours`
- Strategy and scope → `/plan-ceo-review`
- Architecture → `/plan-eng-review`
- Design system and plan review → `/design-consultation` or `/plan-design-review`
- Full review pipeline → `/autoplan`
- Bugs and errors → `/investigate`
- QA and behavior checks → `/qa` or `/qa-only`
- Code review and diff checks → `/review`
- Visual polish → `/design-review`
- Shipping, deployment, and pull requests → `/ship` or `/land-and-deploy`
- Save progress → `/context-save`
- Resume context → `/context-restore`
- Backlog-ready specifications and issues → `/spec`

If a required skill is unavailable, report that limitation and continue with the best available workflow within the user's scope. An explicit user request for a specific skill takes precedence over these routing defaults.
