// Shared types for the dungeon crawler client

export type GameMode = 'offline' | 'online';

export interface GameCallbacks {
  // Called by game when player position changes (online mode sends to server)
  onPlayerMove?: (x: number, y: number, facingX: number, facingY: number) => void;
  // Called by game when player attacks (online mode calls reducer)
  onAttack?: (targetEnemyId: number) => void;
  // Called by game when player dashes
  onDash?: (dirX: number, dirY: number) => void;
  // Called by game when player picks up loot
  onPickupLoot?: (lootId: number) => void;
  // Called by game when entering a room
  onEnterRoom?: (roomIndex: number) => void;
  // Called by game when starting a dungeon
  onStartDungeon?: () => void;
}

export interface ConnectionState {
  connected: boolean;
  identity?: string;
  playerName?: string;
}
