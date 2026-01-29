// main.ts — Entry point
// Server-authoritative multiplayer with client interpolation

import { initGame, setGameMode, setCallbacks, restoreFromServer, updateOtherPlayer, removeOtherPlayer, syncEnemyFromServer, removeServerEnemy, addServerLoot, removeServerLoot, syncRoom, getCurrentRoom, initServerEnemies, getServerEnemyIds, syncPlayerStats, clientToServerX, clientToServerY } from './game';
import { spacetimeClient } from './spacetime';

const statusDot = document.getElementById('connection-status');

function setStatusDot(connected: boolean) {
  if (statusDot) {
    statusDot.style.background = connected ? '#22c55e' : '#ef4444';
  }
}

let activeDungeonId: bigint | null = null;

async function main() {
  // Try connecting to SpacetimeDB
  console.log('[Main] Attempting SpacetimeDB connection...');
  const connected = await spacetimeClient.connect();

  if (connected) {
    console.log('[Main] Online mode — SpacetimeDB connected');
    setGameMode('online');
    setStatusDot(true);

    // Note: we don't use onDungeonInsert to capture dungeon ID because it fires
    // for all existing rows on initial subscription. Instead, we poll after startDungeon.

    // Co-op: listen for other player positions
    spacetimeClient.onPlayerPositionChange((identity, dungeonId, x, y, fx, fy) => {
      // Use string comparison for bigint
      if (activeDungeonId != null && dungeonId.toString() === activeDungeonId.toString()) {
        updateOtherPlayer(identity, x, y, fx, fy);
      }
    }, (identity) => {
      removeOtherPlayer(identity);
    });

    // Server-authoritative enemies: listen for all enemy position/state updates
    spacetimeClient.onEnemyUpdate((enemy) => {
      syncEnemyFromServer(enemy);
    }, (id) => {
      removeServerEnemy(id);
    });

    // Server-authoritative stats: listen for player HP, XP, level updates
    spacetimeClient.onPlayerUpdate((playerData) => {
      syncPlayerStats(playerData.hp, playerData.maxHp, playerData.xp, playerData.level);
    });

    // Co-op: listen for server loot drops
    spacetimeClient.onLootDropChange((loot) => {
      // Only process loot for current dungeon and room
      if (activeDungeonId == null) return;
      // Use string comparison for bigint
      if (loot.dungeonId.toString() !== activeDungeonId.toString()) return;
      if (loot.roomIndex !== getCurrentRoom()) return;

      if (loot.pickedUp) {
        removeServerLoot(loot.id);
      } else {
        addServerLoot(loot);
      }
    });

    // Co-op: listen for room transitions from other player
    spacetimeClient.onDungeonUpdate((dungeon) => {
      // Use string comparison for bigint
      if (activeDungeonId != null && dungeon.id.toString() === activeDungeonId.toString()) {
        const newRoom = dungeon.currentRoom;
        if (newRoom !== getCurrentRoom()) {
          console.log('[Main] Room sync from server: room', newRoom);
          syncRoom(newRoom);
          // Re-init enemies for new room
          setTimeout(() => {
            if (activeDungeonId != null) {
              const serverEnemies = spacetimeClient.getEnemiesForRoom(activeDungeonId, newRoom);
              initServerEnemies(serverEnemies);
              console.log('[Main] Re-initialized', serverEnemies.length, 'server enemies for room', newRoom);
            }
          }, 500);
        }
      }
    });

    // Set up callbacks for online mode
    setCallbacks({
      onStartDungeon: () => {
        activeDungeonId = null;
        spacetimeClient.startDungeon();
        // For the joining case, the dungeon already exists so onDungeonInsert won't fire.
        // Poll to pick up the active dungeon ID.
        const poll = setInterval(() => {
          const d = spacetimeClient.getActiveDungeon();
          if (d) {
            activeDungeonId = d.id;
            console.log('[Main] Resolved active dungeon ID (poll):', activeDungeonId);
            // Initialize enemies from server (full data for interpolation)
            const serverEnemies = spacetimeClient.getEnemiesForRoom(activeDungeonId, getCurrentRoom());
            initServerEnemies(serverEnemies);
            console.log('[Main] Initialized', serverEnemies.length, 'server enemies for room', getCurrentRoom());
            // Load existing players already in the dungeon
            const existingPlayers = spacetimeClient.getOtherPlayersInDungeon(activeDungeonId);
            existingPlayers.forEach(p => updateOtherPlayer(p.identity, p.x, p.y, p.fx, p.fy));
            console.log('[Main] Loaded', existingPlayers.length, 'existing players in dungeon');
            clearInterval(poll);
          }
        }, 300);
        // Stop polling after 5s
        setTimeout(() => clearInterval(poll), 5000);
      },
      onEnterRoom: (roomIndex) => {
        if (activeDungeonId != null) {
          spacetimeClient.enterRoom(activeDungeonId, roomIndex);
          // Re-init enemies for new room
          setTimeout(() => {
            if (activeDungeonId != null) {
              const serverEnemies = spacetimeClient.getEnemiesForRoom(activeDungeonId, roomIndex);
              initServerEnemies(serverEnemies);
              console.log('[Main] Re-initialized', serverEnemies.length, 'server enemies for room', roomIndex);
            }
          }, 500);
        }
      },
      onPlayerMove: (x, y, facingX, facingY) => {
        if (activeDungeonId != null) {
          // Scale client coords to server coords before sending
          spacetimeClient.updatePosition(activeDungeonId, clientToServerX(x), clientToServerY(y), facingX, facingY);
        }
      },
      onAttack: (enemyIdx) => {
        // Route attack through server for HP sync
        if (activeDungeonId != null) {
          const ids = getServerEnemyIds();
          if (enemyIdx >= 0 && enemyIdx < ids.length) {
            spacetimeClient.attack(activeDungeonId, ids[enemyIdx]);
          }
        }
      },
      onDash: (dirX, dirY) => {
        if (activeDungeonId != null) {
          spacetimeClient.useDash(activeDungeonId, dirX, dirY);
        }
      },
      onPickupLoot: (_lootIdx, itemDataJson, rarity) => {
        if (itemDataJson && rarity) {
          spacetimeClient.addInventoryItem(itemDataJson, rarity);
        }
      },
      onCompleteDungeon: () => {
        if (activeDungeonId != null) {
          spacetimeClient.completeDungeon(activeDungeonId);
          activeDungeonId = null;
        }
      },
    });

    // Listen for connection state changes
    spacetimeClient.onChange((state) => {
      setStatusDot(state.connected);
      if (!state.connected) {
        console.log('[Main] Lost connection to server');
        // Show reconnecting message - game requires server connection
      }
    });

    // Auto-register then login
    try {
      spacetimeClient.registerPlayer('Hero');
    } catch (e) {
      // Already registered, that's fine
    }
    try {
      spacetimeClient.login();
    } catch (e) {
      console.warn('[Main] Login failed:', e);
    }

    // Restore state from server after a short delay (let subscriptions populate)
    setTimeout(() => {
      const playerData = spacetimeClient.getPlayerData();
      if (playerData) {
        const inventory = spacetimeClient.getInventoryItems();
        restoreFromServer({
          gold: playerData.gold,
          level: playerData.level,
          xp: playerData.xp,
          dungeonDepth: playerData.dungeonsCleared + 1,
          inventory,
        });
      }
    }, 1000);
  } else {
    console.error('[Main] Failed to connect to SpacetimeDB server');
    setStatusDot(false);
    // Show connection required message
    alert('Could not connect to game server. Please ensure SpacetimeDB is running.');
    return;
  }

  // Start the game (only if connected)
  initGame();
}

main();
