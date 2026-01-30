// main.ts — Entry point
// Server-authoritative multiplayer with client interpolation

import { initGame, setGameMode, setCallbacks, restoreFromServer, updateOtherPlayer, removeOtherPlayer, syncEnemyFromServer, removeServerEnemy, addServerLoot, removeServerLoot, syncRoom, getCurrentRoom, initServerEnemies, getServerEnemyIds, syncPlayerStats, clientToServerX, clientToServerY, getEquippedIcons, receiveMessage, setPlayerClass, getPlayerClass, returnToHub, onMatchFound, getActiveGameMode, getOpenWorldRoom } from './game';
import { spacetimeClient } from './spacetime';
import type { PlayerClass, ActiveGameMode } from './types';
import { CLASS_STATS } from './types';

const statusDot = document.getElementById('connection-status');

function setStatusDot(connected: boolean) {
  if (statusDot) {
    statusDot.style.background = connected ? '#22c55e' : '#ef4444';
  }
}

let activeDungeonId: bigint | null = null;
let activeRaidId: bigint | null = null;
let openWorldInstanceId: bigint | null = null;

// Class selection UI
function showClassSelection() {
  const overlay = document.createElement('div');
  overlay.id = 'class-selection-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(10, 10, 20, 0.95);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 20px;
  `;

  overlay.innerHTML = `
    <h1 style="color: #fbbf24; font-size: 28px; margin-bottom: 10px; text-shadow: 0 0 20px #fbbf24;">Choose Your Class</h1>
    <p style="color: #94a3b8; margin-bottom: 30px; text-align: center;">Select a class for your hero. This choice is permanent!</p>
    <div style="display: flex; gap: 15px; flex-wrap: wrap; justify-content: center; max-width: 600px;">
      ${(['tank', 'healer', 'dps'] as PlayerClass[]).map(cls => {
        const stats = CLASS_STATS[cls];
        return `
          <div class="class-card" data-class="${cls}" style="
            background: linear-gradient(135deg, ${stats.color}22, ${stats.color}11);
            border: 2px solid ${stats.color};
            border-radius: 12px;
            padding: 20px;
            width: 160px;
            cursor: pointer;
            transition: all 0.2s;
            text-align: center;
          ">
            <div style="font-size: 40px; margin-bottom: 10px;">${stats.icon}</div>
            <div style="color: ${stats.color}; font-size: 18px; font-weight: bold; text-transform: uppercase;">${cls}</div>
            <div style="color: #94a3b8; font-size: 12px; margin-top: 8px; line-height: 1.4;">${stats.description}</div>
            <div style="color: #64748b; font-size: 11px; margin-top: 10px;">
              HP: ${Math.round(stats.hp * 100)}% | ATK: ${Math.round(stats.atk * 100)}%<br>
              DEF: ${Math.round(stats.def * 100)}% | SPD: ${Math.round(stats.speed * 100)}%
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  document.body.appendChild(overlay);

  // Add hover effects
  overlay.querySelectorAll('.class-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
      (card as HTMLElement).style.transform = 'scale(1.05)';
      (card as HTMLElement).style.boxShadow = '0 0 30px ' + CLASS_STATS[(card as HTMLElement).dataset.class as PlayerClass].color + '44';
    });
    card.addEventListener('mouseleave', () => {
      (card as HTMLElement).style.transform = 'scale(1)';
      (card as HTMLElement).style.boxShadow = 'none';
    });
    card.addEventListener('click', () => {
      const selectedClass = (card as HTMLElement).dataset.class as PlayerClass;
      setPlayerClass(selectedClass);
      spacetimeClient.registerPlayer('Hero', selectedClass);
      overlay.remove();
      console.log('[Main] Registered player with class:', selectedClass);
    });
  });
}

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
    spacetimeClient.onPlayerPositionChange((identity, dungeonId, x, y, fx, fy, name, level, playerClass, weaponIcon, armorIcon, accessoryIcon) => {
      // Use string comparison for bigint
      if (activeDungeonId != null && dungeonId.toString() === activeDungeonId.toString()) {
        updateOtherPlayer(identity, x, y, fx, fy, name, level, playerClass, weaponIcon, armorIcon, accessoryIcon);
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
            existingPlayers.forEach(p => updateOtherPlayer(p.identity, p.x, p.y, p.fx, p.fy, p.name, p.level, p.playerClass, p.weaponIcon, p.armorIcon, p.accessoryIcon));
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
      onTaunt: (targetEnemyId) => {
        if (activeDungeonId != null) {
          const ids = getServerEnemyIds();
          if (targetEnemyId >= 0 && targetEnemyId < ids.length) {
            spacetimeClient.useTaunt(activeDungeonId, ids[targetEnemyId]);
          }
        }
      },
      onKnockback: () => {
        if (activeDungeonId != null) {
          spacetimeClient.useKnockback(activeDungeonId);
        }
      },
      onPlaceHealingZone: (x, y) => {
        if (activeDungeonId != null) {
          spacetimeClient.placeHealingZone(activeDungeonId, clientToServerX(x), clientToServerY(y));
        }
      },
      // New game mode callbacks
      onEnterOpenWorld: () => {
        spacetimeClient.enterOpenWorld().then(instanceId => {
          if (instanceId) {
            openWorldInstanceId = instanceId;
            console.log('[Main] Entered Open World instance:', instanceId);
          }
        }).catch(err => {
          console.error('[Main] Failed to enter Open World:', err);
        });
      },
      onLeaveOpenWorld: () => {
        spacetimeClient.leaveOpenWorld().then(() => {
          openWorldInstanceId = null;
          console.log('[Main] Left Open World');
        }).catch(err => {
          console.error('[Main] Failed to leave Open World:', err);
        });
      },
      onOpenWorldMove: (roomX, roomY, x, y, facingX, facingY) => {
        const eq = getEquippedIcons();
        spacetimeClient.updateOpenWorldPosition(
          roomX, roomY, x, y, facingX, facingY,
          eq.weapon, eq.armor, eq.accessory
        );
      },
      onOpenWorldAttack: (enemyId) => {
        spacetimeClient.attackOpenWorld(enemyId);
      },
      onQueueDungeon: (tier, difficulty) => {
        spacetimeClient.queueDungeon(tier, difficulty);
      },
      onStartDungeonSolo: (tier, difficulty) => {
        spacetimeClient.startDungeonSolo(tier, difficulty).then(dungeonId => {
          if (dungeonId) {
            activeDungeonId = dungeonId;
            console.log('[Main] Started solo dungeon:', dungeonId);
            // Initialize enemies
            setTimeout(() => {
              if (activeDungeonId != null) {
                const serverEnemies = spacetimeClient.getEnemiesForRoom(activeDungeonId, 0);
                initServerEnemies(serverEnemies);
                console.log('[Main] Initialized', serverEnemies.length, 'enemies for solo dungeon');
              }
            }, 500);
          }
        }).catch(err => {
          console.error('[Main] Failed to start solo dungeon:', err);
        });
      },
      onQueueRaid: () => {
        spacetimeClient.queueRaid();
      },
      onCancelQueue: () => {
        spacetimeClient.cancelQueue();
      },
      onReturnToHub: () => {
        activeDungeonId = null;
        activeRaidId = null;
        openWorldInstanceId = null;
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

    // Check if player already exists
    let playerExists = false;
    setTimeout(() => {
      const playerData = spacetimeClient.getPlayerData();
      if (playerData) {
        playerExists = true;
        const inventory = spacetimeClient.getInventoryItems();
        restoreFromServer({
          gold: playerData.gold,
          level: playerData.level,
          xp: playerData.xp,
          dungeonDepth: playerData.dungeonsCleared + 1,
          playerClass: playerData.playerClass,
          inventory,
        });
        console.log('[Main] Player exists, restored from server');
      } else {
        // New player - show class selection
        console.log('[Main] New player, showing class selection');
        showClassSelection();
      }
    }, 1000);

    // Try login (will work if player exists)
    try {
      spacetimeClient.login();
    } catch (e) {
      console.warn('[Main] Login failed:', e);
    }
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
