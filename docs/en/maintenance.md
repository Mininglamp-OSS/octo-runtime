# Documentation Maintenance

[简体中文](../zh-CN/maintenance.md) | [Documentation](README.md)

## Content Ownership

docs describes current public interfaces and usage. Each reference topic owns examples, payload definitions and notes; package READMEs introduce responsibilities and minimal usage, then link to the reference. CLI or Electron/app module manifests, factory invocation and internal resource composition belong to host implementation.

Development history, architectural history, migration records, source baselines and dated validation results belong in .octospec rather than user documentation.

## Update Rules

English and Chinese use matching paths and code examples, with shared executable examples in docs/examples. Update both languages, examples, diagrams and navigation when interfaces or behavior change. Keep API names untranslated. Keep standard AgentEnv items in the [standard reference](reference/agent-env-standard.md), and identify the owning Adapter for private fields.

## Local Checks

Run `pnpm build`, then `pnpm docs:check`. These check local links, paired pages and code blocks, JSON structure, standard-item examples, shared example types and test-Adapter calls over local Kernel IPC. They do not establish real Provider or external application availability.

Render modified Mermaid diagrams to check syntax and layout. After changing the shared catalog behind the [startup diagnostic catalog](guides/startup-diagnostics.md), explicitly run `node test/manual/generate-startup-catalog.mjs`, then `node --test test/manual/startup-diagnostics.test.js` after building.

Choose focused local checks for the change and record commands, results and unverified scope in the task validation. Focused checks do not expand default tests or GitHub CI.
