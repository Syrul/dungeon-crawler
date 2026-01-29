// main.ts — Entry point
// Server-authoritative multiplayer with client interpolation

import { initGame, setGameMode, setCallbacks, restoreFromServer, updateOtherPlayer, removeOtherPlayer, syncEnemyFromServer, removeServerEnemy, addServerLoot, removeServerLoot, syncRoom, getCurrentRoom, initServerEnemies, getServerEnemyIds, syncPlayerStats, clientToServerX, clientToServerY, getEquippedIcons, receiveMessage } from './game';
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
    spacetimeClient.onPlayerPositionChange((identity, dungeonId, x, y, fx, fy, name, level, weaponIcon, armorIcon, accessoryIcon) => {
      // Use string comparison for bigint
      if (activeDungeonId != null && dungeonId.toString() === activeDungeonId.toString()) {
        updateOtherPlayer(identity, x, y, fx, fy, name, level, weaponIcon, armorIcon, accessoryIcon);
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

    // Co-op: listen for player messages (emotes and chat)
    spacetimeClient.onMessageReceived((msg) => {
      // Only process messages for current dungeon
      if (activeDungeonId == null) return;
      if (msg.dungeonId.toString() !== activeDungeonId.toString()) return;

      receiveMessage(msg.senderIdentity, msg.senderName, msg.messageType, msg.content);
    });

    // Store identity for local player message display
    spacetimeClient.getIdentity().then(identity => {
      if (identity) {
        (window as any).__spacetimeIdentity = identity;
      }
    });

    // Start subscription AFTER all listeners are registered
    spacetimeClient.startSubscription();

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
            console.log('[Main] Resolved active dungeon ID (poll):', activeDungeonId, 'server room:', d.currentRoom);
            // Sync to server's room if different from client
            const clientRoom = getCurrentRoom();
            if (d.currentRoom !== clientRoom) {
              console.log('[Main] Syncing room from server:', d.currentRoom);
              syncRoom(d.currentRoom);
            }
            // Initialize enemies from server's room (not client's room)
            const serverEnemies = spacetimeClient.getEnemiesForRoom(activeDungeonId, d.currentRoom);
            initServerEnemies(serverEnemies);
            console.log('[Main] Initialized', serverEnemies.length, 'server enemies for room', d.currentRoom);
            // Load existing players already in the dungeon
            const existingPlayers = spacetimeClient.getOtherPlayersInDungeon(activeDungeonId);
            existingPlayers.forEach(p => updateOtherPlayer(p.identity, p.x, p.y, p.fx, p.fy, p.name, p.level, p.weaponIcon, p.armorIcon, p.accessoryIcon));
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
          // Scale client coords to server coords before sending, include equipment icons
          const eq = getEquippedIcons();
          spacetimeClient.updatePosition(activeDungeonId, clientToServerX(x), clientToServerY(y), facingX, facingY, eq.weapon, eq.armor, eq.accessory);
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
      onSendEmote: (content) => {
        if (activeDungeonId != null) {
          spacetimeClient.sendEmote(activeDungeonId, content);
        }
      },
      onSendChat: (text) => {
        if (activeDungeonId != null) {
          spacetimeClient.sendChat(activeDungeonId, text);
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
