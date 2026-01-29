// Shared types for the dungeon crawler client

export type GameMode = 'offline' | 'online';

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
}

export interface ConnectionState {
  connected: boolean;
  identity?: string;
  playerName?: string;
}
