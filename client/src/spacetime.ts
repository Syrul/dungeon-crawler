// SpacetimeDB connection layer
import { DbConnection, DbConnectionBuilder } from './module_bindings';
import type { ConnectionState } from './types';

const SPACETIMEDB_URI = 'ws://localhost:3000';
const DB_NAME = 'dungeon-crawler';
const TOKEN_KEY = 'spacetimedb_token';

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
    try {
      const token = localStorage.getItem(TOKEN_KEY) || undefined;

      const conn = await new Promise<DbConnection>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

        const builder = DbConnection.builder()
          .uri(SPACETIMEDB_URI)
          .moduleName(DB_NAME)
          .onConnect((conn, identity, _token) => {
            clearTimeout(timeout);
            console.log('[SpacetimeDB] Connected, identity:', identity.toHexString());
            // Store token for re-auth
            if (_token) {
              localStorage.setItem(TOKEN_KEY, _token);
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
          builder.token(token);
        }

        builder.build();
      });

      this.conn = conn;

      // Subscribe to all relevant tables
      this.subscribeAll();

      return true;
    } catch (err) {
      console.warn('[SpacetimeDB] Failed to connect:', err);
      this._state = { connected: false };
      this.notify();
      return false;
    }
  }

  private subscribeAll() {
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
        ]);
      console.log('[SpacetimeDB] Subscribed to tables');
    } catch (err) {
      console.warn('[SpacetimeDB] Subscription error:', err);
    }
  }

  // --- Reducer calls ---

  registerPlayer(name: string) {
    if (!this.conn) return;
    this.conn.reducers.registerPlayer(name);
  }

  login() {
    if (!this.conn) return;
    this.conn.reducers.login();
  }

  updatePosition(dungeonId: bigint, x: number, y: number, facingX: number, facingY: number) {
    if (!this.conn) return;
    this.conn.reducers.updatePosition(dungeonId, x, y, facingX, facingY);
  }

  attack(dungeonId: bigint, targetEnemyId: bigint) {
    if (!this.conn) return;
    this.conn.reducers.attack(dungeonId, targetEnemyId);
  }

  useDash(dungeonId: bigint, dirX: number, dirY: number) {
    if (!this.conn) return;
    this.conn.reducers.useDash(dungeonId, dirX, dirY);
  }

  pickupLoot(lootId: bigint) {
    if (!this.conn) return;
    this.conn.reducers.pickupLoot(lootId);
  }

  startDungeon() {
    if (!this.conn) return;
    this.conn.reducers.startDungeon();
  }

  enterRoom(dungeonId: bigint, roomIndex: number) {
    if (!this.conn) return;
    this.conn.reducers.enterRoom(dungeonId, roomIndex);
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
