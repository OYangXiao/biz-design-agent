# Biz Design Agent (v1.5.1)

Multi-role business design workflow plugin for Antigravity, Claude Code / Cowork, Codex, and Cursor. It bundles a zero-dependency Node.js MCP server (18 tools), workflow skills, and the Figma Desktop bridge plugin for PRD authoring, clickable wireframes, visual design specs, developer handoff extraction, and isolated browser QA verification with pixel diffing.

## Quick Install

- **Antigravity (Gemini App / CLI)**: `agy plugin install ./dist/harness-plugin` (or double-click `Install-Mac.command` / `Install-Windows.bat`).
- **Claude Code / Cowork**: Copy this folder to `~/.claude/skills/biz-design-agent/` for automatic loading in every session, or run `claude --plugin-dir ./dist/harness-plugin`.
- **Figma Desktop (One-time Step)**: Ask the agent to run `figma_install_plugin`, then in Figma Desktop choose `Plugins → Development → Import plugin from manifest...` and select `~/Documents/BizDesignAgent-FigmaPlugin/manifest.json`.
