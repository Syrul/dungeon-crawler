// Shared types for the dungeon crawler client

export type GameMode = 'offline' | 'online';

// Active game mode (what the player is currently doing)
export type ActiveGameMode = 'hub' | 'open_world' | 'dungeon' | 'raid';

// Dungeon tier configuration
export interface DungeonTier {
  tier: number;
  name: string;
  description: string;
  levelRange: [number, number];
  icon: string;
}

export const DUNGEON_TIERS: DungeonTier[] = [
  { tier: 1, name: 'Training Grounds', description: 'Basic enemies for new adventurers', levelRange: [1, 5], icon: '🌱' },
  { tier: 2, name: 'Tactical Chamber', description: 'Archers, chargers, and a mini-boss', levelRange: [6, 10], icon: '⚔️' },
  { tier: 3, name: 'The Gauntlet', description: 'Wolf packs, bombers, and necromancers', levelRange: [11, 15], icon: '💀' },
];

// Open World zone info
export interface OpenWorldZone {
  levelRange: [number, number];
  color: string;
}

export const OPEN_WORLD_ZONES: Record<string, OpenWorldZone> = {
  center: { levelRange: [1, 5], color: '#22c55e' },   // Green - safe
  mid: { levelRange: [6, 15], color: '#fbbf24' },     // Yellow - medium
  outer: { levelRange: [16, 25], color: '#ef4444' },  // Red - dangerous
};

// Player class type for the holy trinity system
export type PlayerClass = 'tank' | 'healer' | 'dps';

// Class stat multipliers
export const CLASS_STATS: Record<PlayerClass, { hp: number; atk: number; def: number; speed: number; description: string; icon: string; color: string }> = {
  tank: {
    hp: 1.3,
    atk: 0.8,
    def: 1.3,
    speed: 0.8,
    description: 'High HP & DEF. Taunt enemies and protect allies.',
    icon: '🛡️',
    color: '#3b82f6', // blue
  },
  healer: {
    hp: 1.0,
    atk: 0.9,
    def: 1.0,
    speed: 1.0,
    description: 'Heal allies with auras and zones.',
    icon: '💚',
    color: '#22c55e', // green
  },
  dps: {
    hp: 0.8,
    atk: 1.2,
    def: 0.7,
    speed: 1.2,
    description: 'Fast attacks. Backstab and dash bonuses.',
    icon: '⚔️',
    color: '#ef4444', // red
  },
};

export interface GameCallbacks {
  // Called by game when player position changes (online mode sends to server)
  onPlayerMove?: (x: number, y: number, facingX: number, facingY: number) => void;
  // Called by game when player attacks (online mode calls reducer)
  onAttack?: (targetEnemyId: number) => void;
  // Called by game when player dashes
  onDash?: (dirX: number, dirY: number) => void;
  // Called by game when player picks up loot (passes serialized item JSON and rarity)
  onPickupLoot?: (lootId: number, itemDataJson?: string, rarity?: string) => void;
  // Called by game when entering a room
  onEnterRoom?: (roomIndex: number) => void;
  // Called by game when starting a dungeon
  onStartDungeon?: () => void;
  // Called by game when dungeon is completed (boss killed)
  onCompleteDungeon?: () => void;
  // Called by game when player sends an emote
  onSendEmote?: (content: string) => void;
  // Called by game when player sends a chat message
  onSendChat?: (text: string) => void;
  // Tank ability: taunt an enemy
  onTaunt?: (targetEnemyId: number) => void;
  // Tank ability: knockback nearby enemies
  onKnockback?: () => void;
  // Healer ability: place healing zone at position
  onPlaceHealingZone?: (x: number, y: number) => void;

  // Game mode callbacks
  // Called when entering open world
  onEnterOpenWorld?: () => void;
  // Called when leaving open world (return to hub)
  onLeaveOpenWorld?: () => void;
  // Called when moving in open world
  onOpenWorldMove?: (roomX: number, roomY: number, x: number, y: number, facingX: number, facingY: number) => void;
  // Called when attacking in open world
  onOpenWorldAttack?: (enemyId: bigint) => void;
  // Called when changing rooms in open world
  onOpenWorldRoomChange?: (roomX: number, roomY: number) => void;
  // Called when queueing for dungeon
  onQueueDungeon?: (tier: number, difficulty: number) => void;
  // Called when starting solo dungeon
  onStartDungeonSolo?: (tier: number, difficulty: number) => void;
  // Called when queueing for raid
  onQueueRaid?: () => void;
  // Called when canceling queue
  onCancelQueue?: () => void;
  // Called when returning to hub
  onReturnToHub?: () => void;
}

export interface ConnectionState {
  connected: boolean;
  identity?: string;
  playerName?: string;
}
