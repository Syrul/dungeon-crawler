// SpacetimeDB connection layer
import { DbConnection, DbConnectionBuilder } from './module_bindings';
import type { ConnectionState } from './types';

const SPACETIMEDB_URI = 'wss://maincloud.spacetimedb.com';
const DB_NAME = 'dungeon-crawler-dev';
// Token key includes URI to avoid using localhost token on maincloud
const TOKEN_KEY = `spacetimedb_token_${DB_NAME}`;

type StateChangeCallback = (state: ConnectionState) => void;

class SpacetimeClient {
  private conn: DbConnection | null = null;
  private _state: ConnectionState = { connected: false };
  private listeners: StateChangeCallback[] = [];

  get state(): ConnectionState {
    return this._state;
  }

  get connection(): DbConnection | null {
    return this.conn;
  }

  onChange(cb: StateChangeCallback) {
    this.listeners.push(cb);
  }

  private notify() {
    this.listeners.forEach(cb => cb(this._state));
  }

  async connect(): Promise<boolean> {
    return this._connectWithRetry(true);
  }

  private async _connectWithRetry(useToken: boolean): Promise<boolean> {
    try {
      const token = useToken ? (sessionStorage.getItem(TOKEN_KEY) || undefined) : undefined;

      const conn = await new Promise<DbConnection>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

        let builder = DbConnection.builder()
          .withUri(SPACETIMEDB_URI)
          .withModuleName(DB_NAME)
          .onConnect((conn, identity, _token) => {
            clearTimeout(timeout);
            console.log('[SpacetimeDB] Connected, identity:', identity.toHexString());
            // Store token for re-auth
            if (_token) {
              sessionStorage.setItem(TOKEN_KEY, _token);
            }
            this._state = { connected: true, identity: identity.toHexString() };
            this.notify();
            resolve(conn);
          })
          .onConnectError((_conn, err) => {
            clearTimeout(timeout);
            console.error('[SpacetimeDB] Connection error:', err);
            reject(err);
          })
          .onDisconnect(() => {
            console.log('[SpacetimeDB] Disconnected');
            this._state = { connected: false };
            this.notify();
          });

        if (token) {
          builder = builder.withToken(token);
        }

        builder.build();
      });

      this.conn = conn;

      // NOTE: Don't subscribe here - wait for listeners to be registered first
      // subscribeAll() will be called explicitly via startSubscription()

      return true;
    } catch (err) {
      // If we used a token and got an error, clear it and retry without token
      if (useToken && sessionStorage.getItem(TOKEN_KEY)) {
        console.warn('[SpacetimeDB] Token rejected, clearing and retrying...');
        sessionStorage.removeItem(TOKEN_KEY);
        return this._connectWithRetry(false);
      }
      console.warn('[SpacetimeDB] Failed to connect:', err);
      this._state = { connected: false };
      this.notify();
      return false;
    }
  }

  /** Start subscriptions - call this AFTER registering all listeners */
  startSubscription() {
    if (!this.conn) return;

    try {
      this.conn.subscriptionBuilder()
        .subscribe([
          'SELECT * FROM player',
          'SELECT * FROM active_dungeon',
          'SELECT * FROM dungeon_enemy',
          'SELECT * FROM player_position',
          'SELECT * FROM loot_drop',
          'SELECT * FROM inventory_item',
          'SELECT * FROM dungeon_participant',
          'SELECT * FROM player_message',
          'SELECT * FROM threat_entry',
          'SELECT * FROM player_ability_state',
          'SELECT * FROM active_healing_zone',
        ]);
      console.log('[SpacetimeDB] Subscribed to tables');
    } catch (err) {
      console.warn('[SpacetimeDB] Subscription error:', err);
    }
  }

  // --- Reducer calls ---

  registerPlayer(name: string, playerClass: string = 'healer') {
    if (!this.conn) return;
    // Note: The server now accepts playerClass parameter
    (this.conn.reducers as any).registerPlayer({ name, playerClass });
  }

  login() {
    if (!this.conn) return;
    this.conn.reducers.login({});
  }

  updatePosition(dungeonId: bigint, x: number, y: number, facingX: number, facingY: number, weaponIcon: string = '', armorIcon: string = '', accessoryIcon: string = '') {
    if (!this.conn) return;
    this.conn.reducers.updatePosition({ dungeonId, x, y, facingX, facingY, weaponIcon, armorIcon, accessoryIcon });
  }

  attack(dungeonId: bigint, targetEnemyId: bigint) {
    if (!this.conn) return;
    this.conn.reducers.attack({ dungeonId, targetEnemyId });
  }

  useDash(dungeonId: bigint, dirX: number, dirY: number) {
    if (!this.conn) return;
    this.conn.reducers.useDash({ dungeonId, dirX, dirY });
  }

  pickupLoot(lootId: bigint) {
    if (!this.conn) return;
    this.conn.reducers.pickupLoot({ lootId });
  }

  addInventoryItem(itemDataJson: string, rarity: string) {
    if (!this.conn) return;
    this.conn.reducers.addInventoryItem({ itemDataJson, rarity });
  }

  completeDungeon(dungeonId: bigint, clientGold?: bigint, clientXp?: bigint) {
    if (!this.conn) return;
    this.conn.reducers.completeDungeon({ dungeonId, clientGold: clientGold ?? null, clientXp: clientXp ?? null });
  }

  sendEmote(dungeonId: bigint, emoteContent: string) {
    if (!this.conn) return;
    this.conn.reducers.sendEmote({ dungeonId, emoteContent });
  }

  sendChat(dungeonId: bigint, text: string) {
    if (!this.conn) return;
    this.conn.reducers.sendChat({ dungeonId, text });
  }

  // Class ability reducers
  // Note: These require module bindings to be regenerated after server publish
  useTaunt(dungeonId: bigint, targetEnemyId: bigint) {
    if (!this.conn) return;
    try {
      (this.conn.reducers as any).useTaunt({ dungeonId, targetEnemyId });
    } catch (e) {
      console.warn('[SpacetimeDB] useTaunt not available:', e);
    }
  }

  useKnockback(dungeonId: bigint) {
    if (!this.conn) return;
    try {
      (this.conn.reducers as any).useKnockback({ dungeonId });
    } catch (e) {
      console.warn('[SpacetimeDB] useKnockback not available:', e);
    }
  }

  placeHealingZone(dungeonId: bigint, x: number, y: number) {
    if (!this.conn) return;
    try {
      (this.conn.reducers as any).placeHealingZone({ dungeonId, x, y });
    } catch (e) {
      console.warn('[SpacetimeDB] placeHealingZone not available:', e);
    }
  }

  async getIdentity(): Promise<string | null> {
    if (!this.conn) return null;
    try {
      return this.conn.identity.toHexString();
    } catch (e) {
      return null;
    }
  }

  /** Read current player data from subscribed tables */
  getPlayerData(): { gold: number; level: number; xp: number; dungeonsCleared: number; playerClass: string } | null {
    if (!this.conn || !this._state.identity) return null;
    try {
      const players = (this.conn.db as any).player.iter();
      for (const p of players) {
        if (p.identity.toHexString() === this._state.identity) {
          return {
            gold: Number(p.gold),
            level: Number(p.level),
            xp: Number(p.xp),
            dungeonsCleared: Number(p.dungeonsCleared),
            playerClass: p.playerClass || 'healer',
          };
        }
      }
    } catch (e) {
      console.warn('[SpacetimeDB] Failed to read player data:', e);
    }
    return null;
  }

  /** Read inventory items for current player */
  getInventoryItems(): Array<{ itemDataJson: string; equippedSlot: string | null; cardDataJson: string | null }> {
    if (!this.conn || !this._state.identity) return [];
    try {
      const items: Array<{ itemDataJson: string; equippedSlot: string | null; cardDataJson: string | null }> = [];
      const iter = (this.conn.db as any).inventoryItem.iter();
      for (const item of iter) {
        if (item.ownerIdentity.toHexString() === this._state.identity) {
          items.push({
            itemDataJson: item.itemDataJson,
            equippedSlot: item.equippedSlot ?? null,
            cardDataJson: item.cardDataJson ?? null,
          });
        }
      }
      return items;
    } catch (e) {
      console.warn('[SpacetimeDB] Failed to read inventory:', e);
      return [];
    }
  }

  /** Get all other players currently participating in a dungeon */
  getOtherPlayersInDungeon(dungeonId: bigint): Array<{identity: string, x: number, y: number, fx: number, fy: number, name: string, level: number, playerClass: string, weaponIcon: string, armorIcon: string, accessoryIcon: string}> {
    if (!this.conn || !this._state.identity) return [];
    try {
      const targetDungeonId = dungeonId.toString();
      // Build set of active participant identities for this dungeon
      const participants = new Set<string>();
      for (const p of (this.conn.db as any).dungeonParticipant.iter()) {
        if (p.dungeonId.toString() === targetDungeonId) {
          participants.add(p.playerIdentity.toHexString());
        }
      }

      const result: Array<{identity: string, x: number, y: number, fx: number, fy: number, name: string, level: number, playerClass: string, weaponIcon: string, armorIcon: string, accessoryIcon: string}> = [];
      for (const pos of (this.conn.db as any).playerPosition.iter()) {
        const id = pos.identity.toHexString();
        if (id !== this._state.identity && pos.dungeonId.toString() === targetDungeonId && participants.has(id)) {
          result.push({ identity: id, x: pos.x, y: pos.y, fx: pos.facingX, fy: pos.facingY, name: pos.name || 'Player', level: pos.level || 1, playerClass: pos.playerClass || 'healer', weaponIcon: pos.weaponIcon || '', armorIcon: pos.armorIcon || '', accessoryIcon: pos.accessoryIcon || '' });
        }
      }
      return result;
    } catch (e) {
      console.warn('[SpacetimeDB] Failed to read other players:', e);
      return [];
    }
  }

  /** Listen for active_dungeon table inserts */
  onDungeonInsert(cb: (dungeon: { id: bigint; ownerIdentity: string }) => void) {
    if (!this.conn) return;
    try {
      (this.conn.db as any).activeDungeon.onInsert((ctx: any, row: any) => {
        cb({ id: row.id, ownerIdentity: row.ownerIdentity.toHexString() });
      });
    } catch (e) {
      console.warn('[SpacetimeDB] Failed to register dungeon insert listener:', e);
    }
  }

  startDungeon() {
    if (!this.conn) return;
    this.conn.reducers.startDungeon({});
  }

  enterRoom(dungeonId: bigint, roomIndex: number) {
    if (!this.conn) return;
    this.conn.reducers.enterRoom({ dungeonId, roomIndex });
  }

  // --- Co-op listeners ---

  /** Listen for other players' position changes */
  onPlayerPositionChange(cb: (identity: string, dungeonId: bigint, x: number, y: number, fx: number, fy: number, name: string, level: number, playerClass: string, weaponIcon: string, armorIcon: string, accessoryIcon: string) => void, onDelete?: (identity: string) => void) {
    if (!this.conn) return;
    try {
      const self = this._state.identity;
      const handler = (_ctx: any, row: any) => {
        const id = row.identity.toHexString();
        if (id === self) return;
        cb(id, row.dungeonId, row.x, row.y, row.facingX, row.facingY, row.name || 'Player', row.level || 1, row.playerClass || 'healer', row.weaponIcon || '', row.armorIcon || '', row.accessoryIcon || '');
      };
      (this.conn.db as any).playerPosition.onInsert(handler);
      (this.conn.db as any).playerPosition.onUpdate((_ctx: any, _old: any, row: any) => {
        const id = row.identity.toHexString();
        if (id === self) return;
        cb(id, row.dungeonId, row.x, row.y, row.facingX, row.facingY, row.name || 'Player', row.level || 1, row.playerClass || 'healer', row.weaponIcon || '', row.armorIcon || '', row.accessoryIcon || '');
      });
      if (onDelete) {
        (this.conn.db as any).playerPosition.onDelete((_ctx: any, row: any) => {
          const id = row.identity.toHexString();
          if (id === self) return;
          onDelete(id);
        });
      }
    } catch (e) {
      console.warn('[SpacetimeDB] Failed to register player position listener:', e);
    }
  }

  /** Listen for enemy position and state changes (for server-authoritative AI) */
  onEnemyUpdate(cb: (enemy: {
    id: bigint,
    x: number,
    y: number,
    hp: number,
    maxHp: number,
    isAlive: boolean,
    roomIndex: number,
    enemyType: string,
    aiState: string,
    stateTimer: number,
    targetX: number,
    targetY: number,
    facingAngle: number,
    packId: bigint | null,
  }) => void, onDelete?: (id: bigint) => void) {
    if (!this.conn) return;
    try {
      const mapRow = (row: any) => ({
        id: row.id,
        x: row.x,
        y: row.y,
        hp: row.hp,
        maxHp: row.maxHp,
        isAlive: row.isAlive,
        roomIndex: row.roomIndex,
        enemyType: row.enemyType,
        aiState: row.aiState,
        stateTimer: row.stateTimer,
        targetX: row.targetX,
        targetY: row.targetY,
        facingAngle: row.facingAngle,
        packId: row.packId ?? null,
      });
      (this.conn.db as any).dungeonEnemy.onInsert((_ctx: any, row: any) => {
        cb(mapRow(row));
      });
      (this.conn.db as any).dungeonEnemy.onUpdate((_ctx: any, _old: any, row: any) => {
        cb(mapRow(row));
      });
      if (onDelete) {
        (this.conn.db as any).dungeonEnemy.onDelete((_ctx: any, row: any) => {
          onDelete(row.id);
        });
      }
    } catch (e) {
      console.warn('[SpacetimeDB] Failed to register enemy update listener:', e);
    }
  }

  /** Legacy: Listen for enemy HP changes (backwards compatible) */
  onEnemyChange(cb: (enemyId: bigint, hp: number, isAlive: boolean, roomIndex: number) => void) {
    if (!this.conn) return;
    try {
      (this.conn.db as any).dungeonEnemy.onUpdate((_ctx: any, _old: any, row: any) => {
        cb(row.id, row.hp, row.isAlive, row.roomIndex);
      });
    } catch (e) {
      console.warn('[SpacetimeDB] Failed to register enemy change listener:', e);
    }
  }

  /** Listen for loot drop inserts and updates */
  onLootDropChange(cb: (loot: { id: bigint, dungeonId: bigint, roomIndex: number, x: number, y: number, itemDataJson: string, rarity: string, pickedUp: boolean }) => void) {
    if (!this.conn) return;
    try {
      const mapRow = (row: any) => ({
        id: row.id,
        dungeonId: row.dungeonId,
        roomIndex: row.roomIndex,
        x: row.x,
        y: row.y,
        itemDataJson: row.itemDataJson,
        rarity: row.rarity,
        pickedUp: row.pickedUp,
      });
      (this.conn.db as any).lootDrop.onInsert((_ctx: any, row: any) => {
        cb(mapRow(row));
      });
      (this.conn.db as any).lootDrop.onUpdate((_ctx: any, _old: any, row: any) => {
        cb(mapRow(row));
      });
    } catch (e) {
      console.warn('[SpacetimeDB] Failed to register loot drop listener:', e);
    }
  }

  /** Listen for player stats updates (HP, XP, level changes from server) */
  onPlayerUpdate(cb: (player: { hp: number, maxHp: number, xp: number, level: number }) => void) {
    if (!this.conn || !this._state.identity) return;
    try {
      const self = this._state.identity;
      console.log('[SpacetimeDB] Registering player update listener for identity:', self);

      // Track player stat changes via onUpdate - compare oldRow vs newRow directly
      (this.conn.db as any).player.onUpdate((_ctx: any, oldRow: any, newRow: any) => {
        const rowIdentity = newRow.identity.toHexString();
        // Only listen for our own player updates
        if (rowIdentity === self) {
          // Fire callback if HP, XP, or level changed
          const hpChanged = newRow.hp !== oldRow.hp;
          const xpChanged = Number(newRow.xp) !== Number(oldRow.xp);
          const levelChanged = newRow.level !== oldRow.level;

          if (hpChanged || xpChanged || levelChanged) {
            console.log('[SpacetimeDB] Player sync:', {
              hp: hpChanged ? `${oldRow.hp} -> ${newRow.hp}` : newRow.hp,
              xp: xpChanged ? `${oldRow.xp} -> ${newRow.xp}` : newRow.xp,
              level: levelChanged ? `${oldRow.level} -> ${newRow.level}` : newRow.level
            });
            cb({ hp: newRow.hp, maxHp: newRow.maxHp, xp: Number(newRow.xp), level: newRow.level });
          }
        }
      });
    } catch (e) {
      console.warn('[SpacetimeDB] Failed to register player update listener:', e);
    }
  }

  /** Listen for active_dungeon updates (room changes from other player) */
  onDungeonUpdate(cb: (dungeon: { id: bigint, currentRoom: number, seed: bigint, depth: number, totalRooms: number }) => void) {
    if (!this.conn) return;
    try {
      (this.conn.db as any).activeDungeon.onUpdate((_ctx: any, _old: any, row: any) => {
        cb({ id: row.id, currentRoom: row.currentRoom, seed: row.seed, depth: row.depth, totalRooms: row.totalRooms });
      });
    } catch (e) {
      console.warn('[SpacetimeDB] Failed to register dungeon update listener:', e);
    }
  }

  /** Listen for player messages (emotes and chat) */
  onMessageReceived(cb: (message: {
    id: bigint,
    dungeonId: bigint,
    senderIdentity: string,
    senderName: string,
    messageType: string,
    content: string,
    createdAt: number
  }) => void) {
    if (!this.conn) return;
    try {
      const mapRow = (row: any) => ({
        id: row.id,
        dungeonId: row.dungeonId,
        senderIdentity: row.senderIdentity.toHexString(),
        senderName: row.senderName,
        messageType: row.messageType,
        content: row.content,
        createdAt: Number(row.createdAt),
      });
      (this.conn.db as any).playerMessage.onInsert((_ctx: any, row: any) => {
        cb(mapRow(row));
      });
    } catch (e) {
      console.warn('[SpacetimeDB] Failed to register message listener:', e);
    }
  }

  /** Get server enemies for a dungeon+room, sorted by id (full data for interpolation) */
  getEnemiesForRoom(dungeonId: bigint, roomIndex: number): Array<{
    id: bigint,
    x: number,
    y: number,
    hp: number,
    maxHp: number,
    isAlive: boolean,
    enemyType: string,
    aiState: string,
    stateTimer: number,
    targetX: number,
    targetY: number,
    facingAngle: number,
    packId: bigint | null,
  }> {
    if (!this.conn) return [];
    try {
      const result: Array<{
        id: bigint,
        x: number,
        y: number,
        hp: number,
        maxHp: number,
        isAlive: boolean,
        enemyType: string,
        aiState: string,
        stateTimer: number,
        targetX: number,
        targetY: number,
        facingAngle: number,
        packId: bigint | null,
      }> = [];
      const targetDungeonId = dungeonId.toString();
      for (const e of (this.conn.db as any).dungeonEnemy.iter()) {
        // Compare as strings to handle BigInt comparison issues
        if (e.dungeonId.toString() === targetDungeonId && e.roomIndex === roomIndex) {
          result.push({
            id: e.id,
            x: e.x,
            y: e.y,
            hp: e.hp,
            maxHp: e.maxHp,
            isAlive: e.isAlive,
            enemyType: e.enemyType,
            aiState: e.aiState,
            stateTimer: e.stateTimer,
            targetX: e.targetX,
            targetY: e.targetY,
            facingAngle: e.facingAngle,
            packId: e.packId ?? null,
          });
        }
      }
      result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return result;
    } catch (e) {
      console.warn('[SpacetimeDB] Failed to get enemies for room:', e);
      return [];
    }
  }

  /** Get the active dungeon (latest/highest ID) */
  getActiveDungeon(): { id: bigint, currentRoom: number, seed: bigint, depth: number, totalRooms: number, ownerIdentity: string } | null {
    if (!this.conn) return null;
    try {
      let latest: any = null;
      for (const d of (this.conn.db as any).activeDungeon.iter()) {
        if (!latest || d.id > latest.id) latest = d;
      }
      if (latest) {
        return {
          id: latest.id,
          currentRoom: latest.currentRoom,
          seed: latest.seed,
          depth: latest.depth,
          totalRooms: latest.totalRooms,
          ownerIdentity: latest.ownerIdentity.toHexString(),
        };
      }
    } catch (e) {
      console.warn('[SpacetimeDB] Failed to get active dungeon:', e);
    }
    return null;
  }

  disconnect() {
    if (this.conn) {
      this.conn.disconnect();
      this.conn = null;
    }
    this._state = { connected: false };
    this.notify();
  }
}

// Singleton
export const spacetimeClient = new SpacetimeClient();
