# Dungeon Crawler

A 2D multiplayer dungeon crawler playable in the browser. Fight enemies, collect Diablo/Ragnarok Online-style loot, and explore procedurally generated dungeons — solo offline or co-op online.

## Features

- **Offline-first** — fully playable without a server
- **Co-op multiplayer** — auto-join shared dungeons via SpacetimeDB
- **Loot system** — gear rarities, prefix/suffix affixes, unique items, card mechanics
- **Progression** — XP, leveling, stat growth, deeper dungeons with better drops
- **Mobile support** — touch joystick, ability buttons, haptic feedback

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Client | TypeScript, Vite, Canvas2D |
| Server | Rust, SpacetimeDB |
| Multiplayer | SpacetimeDB SDK (WebSocket) |

## Getting Started

### Client

```bash
cd client
npm install
npm run dev
```

Opens at `http://localhost:5173`. The game works offline by default.

### Server (optional, for multiplayer)

Requires the [SpacetimeDB CLI](https://spacetimedb.com/install).

```bash
spacetimedb publish server
```

The client connects to `ws://localhost:3000` when a server is available.

## Project Structure

```
client/src/
  main.ts             # Entry point, connection setup
  game.ts             # Game engine (rendering, combat, loot, UI)
  spacetime.ts        # SpacetimeDB client wrapper
  types.ts            # Type definitions
  module_bindings/    # Auto-generated SpacetimeDB bindings

server/src/
  lib.rs              # SpacetimeDB module (tables, reducers, enemy AI)
```
