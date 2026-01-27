// main.ts — Entry point
// Tries SpacetimeDB connection, falls back to offline mode

import { initGame, setGameMode, setCallbacks, restoreFromServer, updateOtherPlayer, syncEnemyHp, addServerLoot, removeServerLoot, syncRoom, getCurrentRoom, setServerEnemyIds, getServerEnemyIds } from './game';
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
      if (activeDungeonId != null && dungeonId === activeDungeonId) {
        updateOtherPlayer(identity, x, y, fx, fy);
      }
    });

    // Co-op: listen for enemy HP changes from server
    spacetimeClient.onEnemyChange((enemyId, hp, isAlive, _roomIndex) => {
      syncEnemyHp([{id: enemyId, hp, isAlive}]);
    });

    // Co-op: listen for server loot drops
    spacetimeClient.onLootDropChange((loot) => {
      if (loot.pickedUp) {
        removeServerLoot(loot.id);
      } else {
        addServerLoot(loot);
      }
    });

    // Co-op: listen for room transitions from other player
    spacetimeClient.onDungeonUpdate((dungeon) => {
      if (activeDungeonId != null && dungeon.id === activeDungeonId) {
        const newRoom = dungeon.currentRoom;
        if (newRoom !== getCurrentRoom()) {
          console.log('[Main] Room sync from server: room', newRoom);
          syncRoom(newRoom);
          // Re-map enemy IDs for new room
          setTimeout(() => {
            if (activeDungeonId != null) {
              const serverEnemies = spacetimeClient.getEnemiesForRoom(activeDungeonId, newRoom);
              setServerEnemyIds(serverEnemies.map(e => e.id));
              console.log('[Main] Re-mapped', serverEnemies.length, 'server enemy IDs for room', newRoom);
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
            const serverEnemies = spacetimeClient.getEnemiesForRoom(activeDungeonId, getCurrentRoom());
            setServerEnemyIds(serverEnemies.map(e => e.id));
            console.log('[Main] Mapped', serverEnemies.length, 'server enemy IDs for room', getCurrentRoom());
            clearInterval(poll);
          }
        }, 300);
        // Stop polling after 5s
        setTimeout(() => clearInterval(poll), 5000);
      },
      onEnterRoom: (roomIndex) => {
        if (activeDungeonId != null) {
          spacetimeClient.enterRoom(activeDungeonId, roomIndex);
          // Re-map enemy IDs for new room
          setTimeout(() => {
            if (activeDungeonId != null) {
              const serverEnemies = spacetimeClient.getEnemiesForRoom(activeDungeonId, roomIndex);
              setServerEnemyIds(serverEnemies.map(e => e.id));
              console.log('[Main] Re-mapped', serverEnemies.length, 'server enemy IDs for room', roomIndex);
            }
          }, 500);
        }
      },
      onPlayerMove: (x, y, facingX, facingY) => {
        if (activeDungeonId != null) {
          spacetimeClient.updatePosition(activeDungeonId, x, y, facingX, facingY);
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
        console.log('[Main] Lost connection, falling back to offline');
        setGameMode('offline');
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
    console.log('[Main] Offline mode — SpacetimeDB not available');
    setGameMode('offline');
    setStatusDot(false);
  }

  // Start the game regardless
  initGame();
}

main();
