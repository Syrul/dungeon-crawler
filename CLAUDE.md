# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

### Client (TypeScript/Vite)
```bash
cd client
npm run dev        # Dev server on :5173
npm run build      # TypeScript compile + Vite bundle → dist/
npm run preview    # Preview production build
```

### Server (Rust/SpacetimeDB)
The server compiles to WebAssembly via SpacetimeDB CLI. There is no in-repo build script; use `spacetimedb publish` to deploy the server module.

No test suite exists in this project.

## Architecture

**Offline-first multiplayer dungeon crawler.** The game is fully playable offline in the browser; online co-op is layered on top via SpacetimeDB.

### Client (`client/src/`)
- **`main.ts`** — Entry point: SpacetimeDB connection setup, event routing between online/offline modes
- **`game.ts`** — Monolithic game engine (~103KB): canvas rendering, enemy AI, combat, loot/gear system (Diablo/RO-style affixes, uniques, cards), UI (inventory, stats, tooltips, joystick), dungeon generation. Contains both offline logic and hooks for online sync
- **`spacetime.ts`** — SpacetimeDB WebSocket client wrapper: connection management, pub/sub callbacks for multiplayer state sync
- **`types.ts`** — Shared type definitions
- **`module_bindings/`** — Auto-generated SpacetimeDB TypeScript bindings (do not edit manually)

### Server (`server/src/lib.rs`)
Single Rust file SpacetimeDB module. Key concepts:
- **Tables:** `player`, `active_dungeon`, `dungeon_enemy`, `player_position`, `loot_drop`, `inventory_item`, `dungeon_participant`, `enemy_tick_schedule`
- **Reducers:** `register_player`, `login`, `start_dungeon`, `complete_dungeon`, `attack`, `use_dash`, `enter_room`, `update_position`, `tick_enemies`, `pickup_loot`, `equip_item`, `discard_item`
- Enemy AI runs via scheduled `tick_enemies` reducer
- Co-op: players auto-join shared dungeon instances; positions, enemies, and loot are synchronized

### Key Design Patterns
- **Server-authoritative multiplayer** with client-side offline fallback
- **Gear system:** rarities (common→legendary), prefixes/suffixes with stat affixes, card items with unique effects
- **Canvas2D rendering** with touch joystick and ability buttons for mobile
- **SpacetimeDB SDK** (`@clockworklabs/spacetimedb-sdk`) handles WebSocket connection and auto-generated bindings for type-safe client↔server communication
