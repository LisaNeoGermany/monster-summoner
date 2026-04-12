# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Foundry VTT module** (Monster Summoner) that allows Game Masters to summon monsters from organized folders with optional sound effects and JB2A animations. Written in vanilla JavaScript (ES6 modules) with no build system.

- **Compatibility**: Foundry VTT v10-13
- **Language**: German (all UI strings, settings, and comments)

## Development

**No build/test/lint commands** - This is a pure Foundry module with direct file delivery. Changes are reflected immediately upon Foundry reload.

**To develop:**
1. Edit files directly in this directory
2. Reload Foundry VTT world to see changes (or use Foundry's module hot-reload if available)

## Architecture

### File Structure

- `module.json` - Foundry module manifest
- `scripts/main.js` - All module logic (~310 lines)
- `templates/summon-dialog.html` - Handlebars UI template
- `styles/style.css` - CSS styling

### Core Patterns

**Hook-based lifecycle:**
- `Hooks.once("init")` - Register settings
- `Hooks.once("ready")` - Set up keybinding and cleanup
- `Hooks.on("deleteToken")` - Auto-cleanup temporary actors

**Public API:**
```javascript
game.monsterSummoner.openSummonDialog(startFolderId?, breadcrumbs?)
```

**Key Classes:**
- `SummonMonsterDialog extends HandlebarsApplicationMixin(ApplicationV2)` - Main UI dialog using V2 Application API

**ApplicationV2 Patterns:**
- `static DEFAULT_OPTIONS` - Configuration (window, position, form handler, actions)
- `static PARTS` - Template configuration
- `_prepareContext()` - Data preparation for rendering
- Actions system with `data-action` attributes in templates
- Form handler as static method with `formData.object` for expanded data

### Data Conventions

- Temporary summoned actors are flagged with `flag("monster-summoner", "temp")`
- Internal functions prefixed with `_ms` (e.g., `_msCleanupSummonedActors`)
- Actors sorted by Challenge Rating using `parseCR()` helper

### Dependencies

- **Required**: Foundry VTT core
- **Optional**: JB2A (Jinx's Animated Spell Effects) - checked via `typeof Sequence !== "undefined"`

Sound playback uses Foundry's socket system to broadcast to all clients.

## Settings

Three world-scope settings configured in German:
- `monsterSubfolders` - Allowed actor folder IDs (comma-separated)
- `summonSound` - Sound effect path
- `summonAnimation` - Animation effect path (JB2A)
