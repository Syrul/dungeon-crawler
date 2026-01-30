//! SpacetimeDB server module for Dungeon Crawler
//! Handles server-authoritative game state: players, dungeons, enemies, loot, inventory.

use spacetimedb::{table, reducer, Table, ReducerContext, Identity, ScheduleAt, TimeDuration};

// ─── Tables ────────────────────────────────────────────────────────────────────

/// Persistent player account
#[table(name = player, public)]
pub struct Player {
    #[primary_key]
    identity: Identity,
    name: String,
    player_class: String,  // "tank", "healer", or "dps"
    level: u32,
    xp: u64,
    hp: i32,
    max_hp: i32,
    atk: i32,
    def: i32,
    speed: i32,
    gold: u64,
    dungeons_cleared: u32,
}

/// An active dungeon instance
#[table(name = active_dungeon, public)]
pub struct ActiveDungeon {
    #[primary_key]
    #[auto_inc]
    id: u64,
    owner_identity: Identity,
    depth: u32,
    current_room: u32,
    total_rooms: u32,
    seed: u64,
}

/// An enemy inside an active dungeon room
#[derive(Clone)]
#[table(name = dungeon_enemy, public)]
pub struct DungeonEnemy {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub dungeon_id: u64,
    pub room_index: u32,
    pub enemy_type: String,
    pub x: f32,
    pub y: f32,
    pub hp: i32,
    pub max_hp: i32,
    pub atk: i32,
    pub is_alive: bool,

    // AI state for server-authoritative enemy behavior
    pub ai_state: String,     // "idle", "chase", "telegraph", "charge", "stunned", "orbit", "flee", "fuse", "explode"
    pub state_timer: f32,     // Seconds remaining in current state
    pub target_x: f32,        // Charge destination, orbit center, etc.
    pub target_y: f32,
    pub facing_angle: f32,    // For directional attacks
    pub pack_id: Option<u64>, // For wolf pack coordination

    // Threat/aggro system
    pub current_target: Option<String>,  // Identity hex string of current target player (None = nearest)
    pub is_taunted: bool,
    pub taunted_by: Option<String>,      // Identity hex string of taunting player
    pub taunt_timer: f32,                // Seconds remaining on taunt

    // Boss-specific fields
    pub is_boss: bool,
    pub boss_phase: u32,                 // 1, 2, or 3
}

/// Real-time player position in a dungeon
#[table(name = player_position, public)]
pub struct PlayerPosition {
    #[primary_key]
    identity: Identity,
    dungeon_id: u64,
    x: f32,
    y: f32,
    facing_x: f32,
    facing_y: f32,
    // Visual appearance data for other players to render
    name: String,
    level: u32,
    player_class: String,  // "tank", "healer", or "dps"
    // Equipped item icons (emoji strings, empty if not equipped)
    weapon_icon: String,
    armor_icon: String,
    accessory_icon: String,
}

/// Loot dropped on the ground
#[table(name = loot_drop, public)]
pub struct LootDrop {
    #[primary_key]
    #[auto_inc]
    id: u64,
    dungeon_id: u64,
    room_index: u32,
    x: f32,
    y: f32,
    item_data_json: String,
    rarity: String,
    picked_up: bool,
}

/// Player inventory item
#[table(name = inventory_item, public)]
pub struct InventoryItem {
    #[primary_key]
    #[auto_inc]
    id: u64,
    owner_identity: Identity,
    item_data_json: String,
    equipped_slot: Option<String>,
    card_data_json: Option<String>,
}

/// Tracks which players are participating in a dungeon
#[table(name = dungeon_participant, public)]
pub struct DungeonParticipant {
    #[primary_key]
    #[auto_inc]
    id: u64,
    dungeon_id: u64,
    player_identity: Identity,
}

/// Scheduler table for enemy AI ticks
#[table(name = enemy_tick_schedule, scheduled(tick_enemies))]
pub struct EnemyTickSchedule {
    #[primary_key]
    #[auto_inc]
    scheduled_id: u64,
    scheduled_at: ScheduleAt,
}

/// Player messages (emotes and chat) for co-op communication
#[table(name = player_message, public)]
pub struct PlayerMessage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub dungeon_id: u64,
    pub sender_identity: Identity,
    pub sender_name: String,
    pub message_type: String,  // "emote" or "chat"
    pub content: String,
    pub created_at: u64,
}

/// Threat table for tank aggro mechanics
/// Tracks how much threat each player has generated against each enemy
#[table(name = threat_entry, public)]
pub struct ThreatEntry {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub dungeon_id: u64,
    pub enemy_id: u64,
    pub player_identity: Identity,
    pub threat_value: i32,
}

/// Player ability cooldowns and state
#[derive(Clone)]
#[table(name = player_ability_state, public)]
pub struct PlayerAbilityState {
    #[primary_key]
    identity: Identity,
    dungeon_id: u64,
    // Cooldowns (in seconds remaining)
    taunt_cd: f32,
    knockback_cd: f32,
    healing_zone_cd: f32,
    dash_cd: f32,
    // DPS post-dash bonus timer
    post_dash_bonus_timer: f32,
}

/// Active healing zones placed by healers
#[table(name = active_healing_zone, public)]
pub struct ActiveHealingZone {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub dungeon_id: u64,
    pub owner_identity: Identity,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    pub heal_per_tick: i32,
    pub duration_remaining: f32,
}

// ─── Game Mode Tables ────────────────────────────────────────────────────────────

/// Current game mode for a player
#[table(name = player_game_mode, public)]
pub struct PlayerGameMode {
    #[primary_key]
    identity: Identity,
    pub mode: String,  // "hub", "open_world", "dungeon", "raid"
    pub instance_id: Option<u64>,
}

/// Open World instance (persistent shared world, sharded)
#[table(name = open_world_instance, public)]
pub struct OpenWorldInstance {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub created_at: u64,
    pub player_count: u32,
}

/// Enemy in Open World (fixed spawn points with respawn timers)
#[derive(Clone)]
#[table(name = open_world_enemy, public)]
pub struct OpenWorldEnemy {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub instance_id: u64,
    pub room_x: i32,
    pub room_y: i32,
    pub spawn_point_idx: u32,
    pub enemy_type: String,
    pub hp: i32,
    pub max_hp: i32,
    pub atk: i32,
    pub x: f32,
    pub y: f32,
    pub is_alive: bool,
    pub respawn_at: u64,  // Unix timestamp in ms for respawn (0 if alive)
    pub ai_state: String,
    pub state_timer: f32,
    pub target_x: f32,
    pub target_y: f32,
    pub facing_angle: f32,
}

/// Player position in Open World
#[table(name = open_world_player, public)]
pub struct OpenWorldPlayer {
    #[primary_key]
    identity: Identity,
    pub instance_id: u64,
    pub room_x: i32,
    pub room_y: i32,
    pub x: f32,
    pub y: f32,
    pub facing_x: f32,
    pub facing_y: f32,
    pub name: String,
    pub level: u32,
    pub player_class: String,
    pub weapon_icon: String,
    pub armor_icon: String,
    pub accessory_icon: String,
}

/// Dungeon queue for co-op matchmaking
#[table(name = dungeon_queue, public)]
pub struct DungeonQueue {
    #[primary_key]
    identity: Identity,
    pub dungeon_tier: u32,  // 1, 2, or 3
    pub difficulty: u32,    // Star rating 1-5
    pub queued_at: u64,     // Unix timestamp in ms
}

/// Raid queue for role-based matchmaking
#[table(name = raid_queue, public)]
pub struct RaidQueue {
    #[primary_key]
    identity: Identity,
    pub player_class: String,  // "tank", "healer", or "dps"
    pub queued_at: u64,
}

/// Active raid instance
#[table(name = raid_instance, public)]
pub struct RaidInstance {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub started_at: u64,
    pub boss_hp: i32,
    pub boss_max_hp: i32,
    pub boss_phase: u32,
    pub wipe_count: u32,
}

/// Raid participant (links player to raid instance)
#[table(name = raid_participant, public)]
pub struct RaidParticipant {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub raid_id: u64,
    pub player_identity: Identity,
    pub player_class: String,
    pub disconnected_at: Option<u64>,  // For reconnect window
}

/// Player raid cooldown (2 min after wipe)
#[table(name = raid_cooldown, public)]
pub struct RaidCooldown {
    #[primary_key]
    identity: Identity,
    pub cooldown_until: u64,  // Unix timestamp in ms
}

/// Daily raid clear tracking (for legendary drop)
#[table(name = daily_raid_clear, public)]
pub struct DailyRaidClear {
    #[primary_key]
    identity: Identity,
    pub last_clear_day: u32,  // Day number since epoch
}

/// Scheduler table for matchmaking ticks
#[table(name = matchmaking_tick_schedule, scheduled(tick_matchmaking))]
pub struct MatchmakingTickSchedule {
    #[primary_key]
    #[auto_inc]
    scheduled_id: u64,
    scheduled_at: ScheduleAt,
}

/// Scheduler table for open world respawns
#[table(name = open_world_tick_schedule, scheduled(tick_open_world))]
pub struct OpenWorldTickSchedule {
    #[primary_key]
    #[auto_inc]
    scheduled_id: u64,
    scheduled_at: ScheduleAt,
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const ATTACK_RANGE: f32 = 100.0;
const ENEMY_ATTACK_RANGE: f32 = 40.0;
const ENEMY_MOVE_SPEED: f32 = 2.0;
const LOOT_PICKUP_RANGE: f32 = 50.0;
const BASE_XP_PER_LEVEL: u64 = 100;

// AI tick rate: 50ms = 0.05 seconds
const AI_DT: f32 = 0.05;

// Room bounds (in pixels, matching client TILE=36, ROOM_W=15, ROOM_H=20)
const TILE_SIZE: f32 = 36.0;
const ROOM_W: f32 = 15.0 * TILE_SIZE; // 540
const ROOM_H: f32 = 20.0 * TILE_SIZE; // 720

// Charger AI
const CHARGER_TELEGRAPH_TIME: f32 = 0.8;
const CHARGER_CHARGE_SPEED_MULT: f32 = 5.0;
const CHARGER_CHARGE_DURATION: f32 = 1.5;
const CHARGER_STUN_TIME: f32 = 1.0;
const CHARGER_DETECT_RANGE: f32 = 200.0;

// Wolf AI
const WOLF_ORBIT_RADIUS: f32 = 50.0;
#[allow(dead_code)]
const WOLF_PACK_ATTACK_CD: f32 = 1.0;

// Bomber AI
const BOMBER_FUSE_TIME: f32 = 1.5;
const BOMBER_EXPLOSION_RADIUS: f32 = 80.0;
const BOMBER_TRIGGER_RANGE: f32 = 60.0;

// Necromancer AI
const NECRO_FLEE_DISTANCE: f32 = 80.0;
const NECRO_TELEPORT_CD: f32 = 3.0;
#[allow(dead_code)]
const NECRO_SUMMON_CD: f32 = 5.0;

// Shield Knight AI
const SHIELD_BASH_CD: f32 = 4.0;
const SHIELD_RECOVER_TIME: f32 = 0.5;

// Archer AI
const ARCHER_KITE_DISTANCE: f32 = 120.0;
const ARCHER_SHOOT_CD: f32 = 2.0;
const ARCHER_SHOOT_RANGE: f32 = 180.0;

// Open World Constants
const OPEN_WORLD_SIZE: i32 = 10;  // 10x10 grid of rooms
const OPEN_WORLD_SPAWN_POINTS_PER_ROOM: u32 = 10;  // 8-12 fixed spawn points per room
const OPEN_WORLD_BASE_RESPAWN_MS: u64 = 45000;  // 45 second base respawn
const OPEN_WORLD_HOTSPOT_RESPAWN_MS: u64 = 20000;  // 20 second respawn at hotspots
const OPEN_WORLD_MAX_PLAYERS_PER_SHARD: u32 = 50;

// Dungeon tier levels
const DUNGEON_TIER_1_MAX_LEVEL: u32 = 5;
const DUNGEON_TIER_2_MAX_LEVEL: u32 = 10;
const DUNGEON_TIER_3_MAX_LEVEL: u32 = 15;

// Raid constants
const RAID_RECONNECT_WINDOW_MS: u64 = 60000;  // 60 seconds
const RAID_WIPE_COOLDOWN_MS: u64 = 120000;  // 2 minutes

// ─── Account Reducers ──────────────────────────────────────────────────────────

/// Get base stats for a player class
fn get_class_stats(player_class: &str) -> (i32, i32, i32, i32) {
    // Returns (max_hp, atk, def, speed) with class multipliers applied to base stats
    // Base stats: HP=100, ATK=10, DEF=5, Speed=5
    match player_class {
        "tank" => {
            // HP×1.3, ATK×0.8, DEF×1.3, Speed×0.8
            (130, 8, 7, 4)
        }
        "healer" => {
            // HP×1.0, ATK×0.9, DEF×1.0, Speed×1.0
            (100, 9, 5, 5)
        }
        "dps" => {
            // HP×0.8, ATK×1.2, DEF×0.7, Speed×1.2
            (80, 12, 4, 6)
        }
        _ => {
            // Default (same as healer for backwards compat)
            (100, 10, 5, 5)
        }
    }
}

/// Add threat from a player attacking an enemy
fn add_threat(ctx: &ReducerContext, dungeon_id: u64, enemy_id: u64, player_identity: Identity, amount: i32) {
    // Find existing threat entry for this player-enemy pair
    for entry in ctx.db.threat_entry().iter() {
        if entry.dungeon_id == dungeon_id
            && entry.enemy_id == enemy_id
            && entry.player_identity == player_identity
        {
            // Update existing entry
            ctx.db.threat_entry().id().update(ThreatEntry {
                threat_value: entry.threat_value + amount,
                ..entry
            });
            return;
        }
    }

    // Create new entry
    ctx.db.threat_entry().insert(ThreatEntry {
        id: 0,
        dungeon_id,
        enemy_id,
        player_identity,
        threat_value: amount,
    });
}

/// Get the highest-threat player for an enemy
fn get_highest_threat_player(ctx: &ReducerContext, dungeon_id: u64, enemy_id: u64) -> Option<Identity> {
    let mut highest_threat = 0;
    let mut highest_player: Option<Identity> = None;

    for entry in ctx.db.threat_entry().iter() {
        if entry.dungeon_id == dungeon_id && entry.enemy_id == enemy_id {
            if entry.threat_value > highest_threat {
                highest_threat = entry.threat_value;
                highest_player = Some(entry.player_identity);
            }
        }
    }

    highest_player
}

/// Tick ability cooldowns for all players
fn tick_ability_cooldowns(ctx: &ReducerContext, dt: f32) {
    let states: Vec<PlayerAbilityState> = ctx.db.player_ability_state().iter().collect();
    for state in states {
        let mut updated = state.clone();
        updated.taunt_cd = (updated.taunt_cd - dt).max(0.0);
        updated.knockback_cd = (updated.knockback_cd - dt).max(0.0);
        updated.healing_zone_cd = (updated.healing_zone_cd - dt).max(0.0);
        updated.dash_cd = (updated.dash_cd - dt).max(0.0);
        updated.post_dash_bonus_timer = (updated.post_dash_bonus_timer - dt).max(0.0);
        ctx.db.player_ability_state().identity().update(updated);
    }
}

/// Tick healing zones (heal players inside, decrement duration)
fn tick_healing_zones(ctx: &ReducerContext, dt: f32) {
    let zones: Vec<ActiveHealingZone> = ctx.db.active_healing_zone().iter().collect();
    let positions: Vec<PlayerPosition> = ctx.db.player_position().iter().collect();

    for zone in zones {
        if zone.duration_remaining <= 0.0 {
            ctx.db.active_healing_zone().id().delete(zone.id);
            continue;
        }

        // Heal players inside the zone
        for pos in &positions {
            if pos.dungeon_id != zone.dungeon_id {
                continue;
            }
            let dist = ((pos.x - zone.x).powi(2) + (pos.y - zone.y).powi(2)).sqrt();
            if dist <= zone.radius {
                if let Some(player) = ctx.db.player().identity().find(pos.identity) {
                    let heal = (zone.heal_per_tick as f32 * dt) as i32;
                    let new_hp = (player.hp + heal).min(player.max_hp);
                    ctx.db.player().identity().update(Player {
                        hp: new_hp,
                        ..player
                    });
                }
            }
        }

        // Decrement duration
        ctx.db.active_healing_zone().id().update(ActiveHealingZone {
            duration_remaining: zone.duration_remaining - dt,
            ..zone
        });
    }

    // Healer passive aura: heal nearby allies (40px radius, 5 HP/sec)
    for pos in &positions {
        if pos.player_class != "healer" {
            continue;
        }
        // Heal all other players within 40px
        for other_pos in &positions {
            if other_pos.identity == pos.identity || other_pos.dungeon_id != pos.dungeon_id {
                continue;
            }
            let dist = ((other_pos.x - pos.x).powi(2) + (other_pos.y - pos.y).powi(2)).sqrt();
            if dist <= 40.0 {
                if let Some(player) = ctx.db.player().identity().find(other_pos.identity) {
                    let heal = (5.0 * dt) as i32;
                    let new_hp = (player.hp + heal).min(player.max_hp);
                    ctx.db.player().identity().update(Player {
                        hp: new_hp,
                        ..player
                    });
                }
            }
        }
    }
}

/// Register a new player account
#[reducer]
pub fn register_player(ctx: &ReducerContext, name: String, player_class: String) -> Result<(), String> {
    if name.is_empty() {
        return Err("Name must not be empty".into());
    }
    if ctx.db.player().identity().find(ctx.sender).is_some() {
        return Err("Player already registered".into());
    }

    // Validate class
    let valid_classes = ["tank", "healer", "dps"];
    let class_lower = player_class.to_lowercase();
    if !valid_classes.contains(&class_lower.as_str()) {
        return Err("Invalid class. Must be 'tank', 'healer', or 'dps'".into());
    }

    let (max_hp, atk, def, speed) = get_class_stats(&class_lower);

    ctx.db.player().insert(Player {
        identity: ctx.sender,
        name,
        player_class: class_lower,
        level: 1,
        xp: 0,
        hp: max_hp,
        max_hp,
        atk,
        def,
        speed,
        gold: 0,
        dungeons_cleared: 0,
    });
    log::info!("Player registered: {:?}", ctx.sender);
    Ok(())
}

/// Login — just verifies the player exists (client subscribes to their row)
#[reducer]
pub fn login(ctx: &ReducerContext) -> Result<(), String> {
    if ctx.db.player().identity().find(ctx.sender).is_none() {
        return Err("Player not found — register first".into());
    }
    log::info!("Player logged in: {:?}", ctx.sender);
    Ok(())
}

// ─── Dungeon Lifecycle ─────────────────────────────────────────────────────────

/// Start a new dungeon run, or join an existing one if another player already started.
#[reducer]
pub fn start_dungeon(ctx: &ReducerContext) -> Result<(), String> {
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;

    // Check if player was dead (respawning) - if so, clean up their old dungeon
    let was_dead = player.hp <= 0;

    // Reset player HP to full when starting/joining a dungeon
    if player.hp < player.max_hp {
        ctx.db.player().identity().update(Player {
            hp: player.max_hp,
            ..player
        });
    }

    // If player was dead, clean up any dungeon they were in
    if was_dead {
        // Find and clean up dungeons where this player was the only participant
        let my_participations: Vec<u64> = ctx.db.dungeon_participant().iter()
            .filter(|p| p.player_identity == ctx.sender)
            .map(|p| p.dungeon_id)
            .collect();

        for dungeon_id in my_participations {
            // Check if this player is the only participant
            let participant_count = ctx.db.dungeon_participant().iter()
                .filter(|p| p.dungeon_id == dungeon_id)
                .count();

            if participant_count <= 1 {
                // Only participant, clean up the whole dungeon
                cleanup_dungeon(ctx, dungeon_id);
                if let Some(_) = ctx.db.active_dungeon().id().find(dungeon_id) {
                    ctx.db.active_dungeon().id().delete(dungeon_id);
                }
            } else {
                // Other participants, just remove self
                let my_part_id = ctx.db.dungeon_participant().iter()
                    .find(|p| p.dungeon_id == dungeon_id && p.player_identity == ctx.sender)
                    .map(|p| p.id);
                if let Some(id) = my_part_id {
                    ctx.db.dungeon_participant().id().delete(id);
                }
            }
        }
        log::info!("Cleaned up old dungeon for respawning player {:?}", ctx.sender);
    }

    // Check if an active dungeon with OTHER participants exists — join it
    // (After cleanup, respawning players can join other players' dungeons)
    let latest = ctx.db.active_dungeon().iter().max_by_key(|d| d.id);
    if let Some(existing) = latest {
        let dungeon_id = existing.id;
        let has_other_participants = ctx.db.dungeon_participant().iter()
            .any(|p| p.dungeon_id == dungeon_id && p.player_identity != ctx.sender);
        if has_other_participants {
            // Check not already a participant
            let already_joined = ctx.db.dungeon_participant().iter()
                .any(|p| p.dungeon_id == dungeon_id && p.player_identity == ctx.sender);
            if !already_joined {
                ctx.db.dungeon_participant().insert(DungeonParticipant {
                    id: 0,
                    dungeon_id,
                    player_identity: ctx.sender,
                });
            }

            // Get player data for visual appearance
            let player_for_pos = ctx.db.player().identity().find(ctx.sender)
                .ok_or("Player not found")?;

            // Initialize player position in the existing dungeon
            if let Some(old_pos) = ctx.db.player_position().identity().find(ctx.sender) {
                ctx.db.player_position().identity().update(PlayerPosition {
                    identity: ctx.sender,
                    dungeon_id,
                    x: 270.0,  // Center of room
                    y: 360.0,
                    facing_x: 1.0,
                    facing_y: 0.0,
                    name: player_for_pos.name.clone(),
                    level: player_for_pos.level,
                    player_class: player_for_pos.player_class.clone(),
                    weapon_icon: old_pos.weapon_icon,
                    armor_icon: old_pos.armor_icon,
                    accessory_icon: old_pos.accessory_icon,
                });
            } else {
                ctx.db.player_position().insert(PlayerPosition {
                    identity: ctx.sender,
                    dungeon_id,
                    x: 270.0,  // Center of room
                    y: 360.0,
                    facing_x: 1.0,
                    facing_y: 0.0,
                    name: player_for_pos.name.clone(),
                    level: player_for_pos.level,
                    player_class: player_for_pos.player_class.clone(),
                    weapon_icon: String::new(),
                    armor_icon: String::new(),
                    accessory_icon: String::new(),
                });
            }

            log::info!("Player {:?} joined existing dungeon {}", ctx.sender, dungeon_id);
            return Ok(());
        }
    }

    // No existing dungeon — create a new one
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;

    let seed = ctx.timestamp.to_duration_since_unix_epoch()
        .unwrap_or_default().as_micros() as u64;
    let total_rooms = 4; // Fixed 4-room structure: Basic, Tactical, Complex, Raid
    let depth = player.dungeons_cleared + 1;

    let dungeon = ctx.db.active_dungeon().insert(ActiveDungeon {
        id: 0,
        owner_identity: ctx.sender,
        depth,
        current_room: 0,
        total_rooms,
        seed,
    });

    // Add owner as participant
    ctx.db.dungeon_participant().insert(DungeonParticipant {
        id: 0,
        dungeon_id: dungeon.id,
        player_identity: ctx.sender,
    });

    spawn_enemies_for_room(ctx, dungeon.id, 0, depth, seed);

    // Start the enemy AI tick scheduler (only if not already running)
    if ctx.db.enemy_tick_schedule().iter().count() == 0 {
        schedule_enemy_tick(ctx);
        log::info!("Started enemy AI tick scheduler");
    }

    // Initialize player position (player variable is from line ~309)
    if let Some(old_pos) = ctx.db.player_position().identity().find(ctx.sender) {
        ctx.db.player_position().identity().update(PlayerPosition {
            identity: ctx.sender,
            dungeon_id: dungeon.id,
            x: 270.0,  // Center of room
            y: 360.0,
            facing_x: 1.0,
            facing_y: 0.0,
            name: player.name.clone(),
            level: player.level,
            player_class: player.player_class.clone(),
            weapon_icon: old_pos.weapon_icon,
            armor_icon: old_pos.armor_icon,
            accessory_icon: old_pos.accessory_icon,
        });
    } else {
        ctx.db.player_position().insert(PlayerPosition {
            identity: ctx.sender,
            dungeon_id: dungeon.id,
            x: 270.0,  // Center of room
            y: 360.0,
            facing_x: 1.0,
            facing_y: 0.0,
            name: player.name.clone(),
            level: player.level,
            player_class: player.player_class.clone(),
            weapon_icon: String::new(),
            armor_icon: String::new(),
            accessory_icon: String::new(),
        });
    }

    log::info!("Dungeon started: id={}, depth={}, rooms={}", dungeon.id, depth, total_rooms);
    Ok(())
}

/// Enter a new room in the dungeon, spawning its enemies.
#[reducer]
pub fn enter_room(ctx: &ReducerContext, dungeon_id: u64, room_index: u32) -> Result<(), String> {
    let dungeon = ctx.db.active_dungeon().id().find(dungeon_id)
        .ok_or("Dungeon not found")?;
    let is_participant = ctx.db.dungeon_participant().iter()
        .any(|p| p.dungeon_id == dungeon_id && p.player_identity == ctx.sender);
    if !is_participant {
        return Err("Not a participant in this dungeon".into());
    }
    if room_index >= dungeon.total_rooms {
        return Err("Room index out of bounds".into());
    }

    // Update current room
    ctx.db.active_dungeon().id().update(ActiveDungeon {
        current_room: room_index,
        ..dungeon
    });

    // Only spawn enemies if none exist for this room yet
    let enemies_exist = ctx.db.dungeon_enemy().iter()
        .any(|e| e.dungeon_id == dungeon_id && e.room_index == room_index);
    if !enemies_exist {
        spawn_enemies_for_room(ctx, dungeon_id, room_index, dungeon.depth, dungeon.seed);
    }

    // Reset all participants' positions for new room
    let participant_ids: Vec<Identity> = ctx.db.dungeon_participant().iter()
        .filter(|p| p.dungeon_id == dungeon_id)
        .map(|p| p.player_identity)
        .collect();
    for pid in participant_ids {
        if let Some(pos) = ctx.db.player_position().identity().find(pid) {
            ctx.db.player_position().identity().update(PlayerPosition {
                identity: pid,
                dungeon_id: pos.dungeon_id,
                x: 270.0,  // Center of room
                y: 360.0,
                facing_x: pos.facing_x,
                facing_y: pos.facing_y,
                name: pos.name.clone(),
                level: pos.level,
                player_class: pos.player_class.clone(),
                weapon_icon: pos.weapon_icon.clone(),
                armor_icon: pos.armor_icon.clone(),
                accessory_icon: pos.accessory_icon.clone(),
            });
        }
    }

    log::info!("Entered room {} in dungeon {}", room_index, dungeon_id);
    Ok(())
}

/// Complete a dungeon. Award XP and gold, increment dungeons_cleared.
#[reducer]
pub fn complete_dungeon(ctx: &ReducerContext, dungeon_id: u64, client_gold: Option<u64>, client_xp: Option<u64>) -> Result<(), String> {
    let dungeon = ctx.db.active_dungeon().id().find(dungeon_id)
        .ok_or("Dungeon not found")?;
    let is_participant = ctx.db.dungeon_participant().iter()
        .any(|p| p.dungeon_id == dungeon_id && p.player_identity == ctx.sender);
    if !is_participant {
        return Err("Not a participant in this dungeon".into());
    }

    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;

    let xp_reward = client_xp.unwrap_or(50 * dungeon.depth as u64);
    let gold_reward = client_gold.unwrap_or(20 * dungeon.depth as u64);
    let new_xp = player.xp + xp_reward;
    let new_gold = player.gold + gold_reward;
    let new_cleared = player.dungeons_cleared + 1;

    // Check for level up
    let (new_level, new_max_hp, new_atk, new_def) = check_level_up(
        player.level, new_xp, player.max_hp, player.atk, player.def,
    );

    ctx.db.player().identity().update(Player {
        xp: new_xp,
        gold: new_gold,
        dungeons_cleared: new_cleared,
        level: new_level,
        max_hp: new_max_hp,
        hp: new_max_hp, // full heal on dungeon complete
        atk: new_atk,
        def: new_def,
        ..player
    });

    // Clean up dungeon data
    cleanup_dungeon(ctx, dungeon_id);
    ctx.db.active_dungeon().id().delete(dungeon_id);

    log::info!("Dungeon {} completed! +{}xp +{}gold", dungeon_id, xp_reward, gold_reward);
    Ok(())
}

// ─── Real-time Gameplay Reducers ───────────────────────────────────────────────

/// Update player position (called frequently by client)
#[reducer]
pub fn update_position(
    ctx: &ReducerContext,
    dungeon_id: u64,
    x: f32,
    y: f32,
    facing_x: f32,
    facing_y: f32,
    weapon_icon: String,
    armor_icon: String,
    accessory_icon: String,
) -> Result<(), String> {
    if let Some(pos) = ctx.db.player_position().identity().find(ctx.sender) {
        // Preserve name/level/class from existing position, update equipment
        ctx.db.player_position().identity().update(PlayerPosition {
            identity: ctx.sender,
            dungeon_id,
            x,
            y,
            facing_x,
            facing_y,
            name: pos.name.clone(),
            level: pos.level,
            player_class: pos.player_class.clone(),
            weapon_icon,
            armor_icon,
            accessory_icon,
        });
    } else {
        // Fetch player for visual data
        let player = ctx.db.player().identity().find(ctx.sender)
            .ok_or("Player not found")?;
        ctx.db.player_position().insert(PlayerPosition {
            identity: ctx.sender,
            dungeon_id,
            x,
            y,
            facing_x,
            facing_y,
            name: player.name.clone(),
            level: player.level,
            player_class: player.player_class.clone(),
            weapon_icon,
            armor_icon,
            accessory_icon,
        });
    }
    Ok(())
}

/// Player attacks an enemy. Server validates range and applies damage.
#[reducer]
pub fn attack(ctx: &ReducerContext, dungeon_id: u64, target_enemy_id: u64) -> Result<(), String> {
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;
    let pos = ctx.db.player_position().identity().find(ctx.sender)
        .ok_or("Position not found")?;
    let enemy = ctx.db.dungeon_enemy().id().find(target_enemy_id)
        .ok_or("Enemy not found")?;

    if enemy.dungeon_id != dungeon_id || !enemy.is_alive {
        return Err("Invalid target".into());
    }

    // Range check
    let dx = pos.x - enemy.x;
    let dy = pos.y - enemy.y;
    let dist = (dx * dx + dy * dy).sqrt();
    if dist > ATTACK_RANGE {
        return Err("Target out of range".into());
    }

    // Calculate damage with class bonuses
    let mut damage = player.atk.max(1);

    // DPS backstab bonus: +50% damage when hitting from behind (>120° from enemy facing)
    if player.player_class == "dps" {
        let attack_angle = (pos.y - enemy.y).atan2(pos.x - enemy.x);
        let mut angle_diff = (attack_angle - enemy.facing_angle).abs();
        if angle_diff > std::f32::consts::PI {
            angle_diff = 2.0 * std::f32::consts::PI - angle_diff;
        }
        // Backstab: attack from behind (angle_diff > 2π/3 ≈ 120°)
        if angle_diff > std::f32::consts::PI * 2.0 / 3.0 {
            damage = (damage as f32 * 1.5) as i32;
        }
    }

    // Check for DPS post-dash bonus: +25% damage for 0.5s after dash
    if player.player_class == "dps" {
        if let Some(ability_state) = ctx.db.player_ability_state().identity().find(ctx.sender) {
            if ability_state.post_dash_bonus_timer > 0.0 {
                damage = (damage as f32 * 1.25) as i32;
            }
        }
    }

    let new_hp = enemy.hp - damage;

    // Generate threat: tanks generate 2x threat, others 1x
    let threat_mult = if player.player_class == "tank" { 2 } else { 1 };
    let threat_generated = damage * threat_mult;
    add_threat(ctx, dungeon_id, target_enemy_id, ctx.sender, threat_generated);

    if new_hp <= 0 {
        // Enemy dies — capture loot info before moving
        let enemy_type = enemy.enemy_type.clone();
        let e_dungeon_id = enemy.dungeon_id;
        let e_room_index = enemy.room_index;
        let e_x = enemy.x;
        let e_y = enemy.y;
        let e_atk = enemy.atk;
        let e_max_hp = enemy.max_hp;
        ctx.db.dungeon_enemy().id().update(DungeonEnemy {
            hp: 0,
            is_alive: false,
            ..enemy
        });
        // Drop loot
        drop_loot_for_dead_enemy(ctx, &enemy_type, e_dungeon_id, e_room_index, e_x, e_y, e_atk, e_max_hp);

        // Award XP for kill
        let xp_reward = get_enemy_xp(&enemy_type);
        let new_xp = player.xp + xp_reward;
        let (new_level, new_max_hp, new_atk, new_def) = check_level_up(
            player.level, new_xp, player.max_hp, player.atk, player.def,
        );
        ctx.db.player().identity().update(Player {
            xp: new_xp,
            level: new_level,
            max_hp: new_max_hp,
            atk: new_atk,
            def: new_def,
            ..player
        });

        log::info!("Enemy {} killed in dungeon {}, +{}xp", target_enemy_id, dungeon_id, xp_reward);
    } else {
        ctx.db.dungeon_enemy().id().update(DungeonEnemy {
            hp: new_hp,
            ..enemy
        });
    }

    Ok(())
}

/// Player uses dash ability. Server validates cooldown (simplified: always allow for now).
#[reducer]
pub fn use_dash(
    ctx: &ReducerContext,
    dungeon_id: u64,
    dir_x: f32,
    dir_y: f32,
) -> Result<(), String> {
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;
    let pos = ctx.db.player_position().identity().find(ctx.sender)
        .ok_or("Position not found")?;

    let dash_distance = 150.0;
    let new_x = pos.x + dir_x * dash_distance;
    let new_y = pos.y + dir_y * dash_distance;

    ctx.db.player_position().identity().update(PlayerPosition {
        identity: ctx.sender,
        dungeon_id: pos.dungeon_id,
        x: new_x,
        y: new_y,
        facing_x: dir_x,
        facing_y: dir_y,
        name: pos.name.clone(),
        level: pos.level,
        player_class: pos.player_class.clone(),
        weapon_icon: pos.weapon_icon.clone(),
        armor_icon: pos.armor_icon.clone(),
        accessory_icon: pos.accessory_icon.clone(),
    });

    // DPS gets post-dash damage bonus (0.5s window for +25% damage)
    if player.player_class == "dps" {
        ensure_ability_state(ctx, dungeon_id);
        if let Some(state) = ctx.db.player_ability_state().identity().find(ctx.sender) {
            ctx.db.player_ability_state().identity().update(PlayerAbilityState {
                post_dash_bonus_timer: 0.5,
                ..state
            });
        }
    }

    log::info!("Player dashed in dungeon {}", dungeon_id);
    Ok(())
}

/// Ensure a player has an ability state record
fn ensure_ability_state(ctx: &ReducerContext, dungeon_id: u64) {
    if ctx.db.player_ability_state().identity().find(ctx.sender).is_none() {
        ctx.db.player_ability_state().insert(PlayerAbilityState {
            identity: ctx.sender,
            dungeon_id,
            taunt_cd: 0.0,
            knockback_cd: 0.0,
            healing_zone_cd: 0.0,
            dash_cd: 0.0,
            post_dash_bonus_timer: 0.0,
        });
    }
}

/// Tank ability: Taunt a single enemy to force it to attack the tank for 4 seconds
#[reducer]
pub fn use_taunt(ctx: &ReducerContext, dungeon_id: u64, target_enemy_id: u64) -> Result<(), String> {
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;

    if player.player_class != "tank" {
        return Err("Only tanks can use Taunt".into());
    }

    ensure_ability_state(ctx, dungeon_id);
    let state = ctx.db.player_ability_state().identity().find(ctx.sender)
        .ok_or("Ability state not found")?;

    if state.taunt_cd > 0.0 {
        return Err("Taunt is on cooldown".into());
    }

    let enemy = ctx.db.dungeon_enemy().id().find(target_enemy_id)
        .ok_or("Enemy not found")?;

    if enemy.dungeon_id != dungeon_id || !enemy.is_alive {
        return Err("Invalid target".into());
    }

    // Apply taunt effect (4 second duration)
    ctx.db.dungeon_enemy().id().update(DungeonEnemy {
        is_taunted: true,
        taunted_by: Some(ctx.sender.to_string()),
        taunt_timer: 4.0,
        current_target: Some(ctx.sender.to_string()),
        ..enemy
    });

    // Set cooldown (8 seconds)
    ctx.db.player_ability_state().identity().update(PlayerAbilityState {
        taunt_cd: 8.0,
        ..state
    });

    // Generate bonus threat
    add_threat(ctx, dungeon_id, target_enemy_id, ctx.sender, 100);

    log::info!("Tank taunted enemy {} in dungeon {}", target_enemy_id, dungeon_id);
    Ok(())
}

/// Tank ability: Knockback all enemies within 60px, pushing them back 100px
#[reducer]
pub fn use_knockback(ctx: &ReducerContext, dungeon_id: u64) -> Result<(), String> {
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;
    let pos = ctx.db.player_position().identity().find(ctx.sender)
        .ok_or("Position not found")?;

    if player.player_class != "tank" {
        return Err("Only tanks can use Knockback".into());
    }

    ensure_ability_state(ctx, dungeon_id);
    let state = ctx.db.player_ability_state().identity().find(ctx.sender)
        .ok_or("Ability state not found")?;

    if state.knockback_cd > 0.0 {
        return Err("Knockback is on cooldown".into());
    }

    // Push all enemies within 60px back by 100px
    let knockback_radius = 60.0;
    let knockback_distance = 100.0;

    let enemies: Vec<DungeonEnemy> = ctx.db.dungeon_enemy().iter()
        .filter(|e| e.dungeon_id == dungeon_id && e.is_alive)
        .collect();

    for enemy in enemies {
        let dx = enemy.x - pos.x;
        let dy = enemy.y - pos.y;
        let dist = (dx * dx + dy * dy).sqrt();

        if dist <= knockback_radius && dist > 0.1 {
            let nx = dx / dist;
            let ny = dy / dist;
            let new_x = (enemy.x + nx * knockback_distance).clamp(TILE_SIZE, ROOM_W - TILE_SIZE);
            let new_y = (enemy.y + ny * knockback_distance).clamp(TILE_SIZE, ROOM_H - TILE_SIZE);

            ctx.db.dungeon_enemy().id().update(DungeonEnemy {
                x: new_x,
                y: new_y,
                ai_state: "stunned".to_string(),
                state_timer: 0.5, // Stunned briefly
                ..enemy
            });
        }
    }

    // Set cooldown (12 seconds)
    ctx.db.player_ability_state().identity().update(PlayerAbilityState {
        knockback_cd: 12.0,
        ..state
    });

    log::info!("Tank used knockback in dungeon {}", dungeon_id);
    Ok(())
}

/// Healer ability: Place a healing zone at position (60px radius, heals for 8 seconds)
#[reducer]
pub fn place_healing_zone(ctx: &ReducerContext, dungeon_id: u64, x: f32, y: f32) -> Result<(), String> {
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;

    if player.player_class != "healer" {
        return Err("Only healers can place healing zones".into());
    }

    ensure_ability_state(ctx, dungeon_id);
    let state = ctx.db.player_ability_state().identity().find(ctx.sender)
        .ok_or("Ability state not found")?;

    if state.healing_zone_cd > 0.0 {
        return Err("Healing zone is on cooldown".into());
    }

    // Create healing zone (60px radius, 5 HP/sec heal, 8 second duration)
    ctx.db.active_healing_zone().insert(ActiveHealingZone {
        id: 0,
        dungeon_id,
        owner_identity: ctx.sender,
        x,
        y,
        radius: 60.0,
        heal_per_tick: 5,
        duration_remaining: 8.0,
    });

    // Set cooldown (15 seconds)
    ctx.db.player_ability_state().identity().update(PlayerAbilityState {
        healing_zone_cd: 15.0,
        ..state
    });

    log::info!("Healer placed healing zone in dungeon {} at ({}, {})", dungeon_id, x, y);
    Ok(())
}

// ─── Loot & Inventory Reducers ─────────────────────────────────────────────────

/// Pick up a loot drop. Validates proximity, adds to inventory.
#[reducer]
pub fn pickup_loot(ctx: &ReducerContext, loot_id: u64) -> Result<(), String> {
    let pos = ctx.db.player_position().identity().find(ctx.sender)
        .ok_or("Position not found")?;
    let loot = ctx.db.loot_drop().id().find(loot_id)
        .ok_or("Loot not found")?;

    if loot.picked_up {
        return Err("Already picked up".into());
    }

    // Range check
    let dx = pos.x - loot.x;
    let dy = pos.y - loot.y;
    let dist = (dx * dx + dy * dy).sqrt();
    if dist > LOOT_PICKUP_RANGE {
        return Err("Too far away".into());
    }

    // Capture before move
    let item_data = loot.item_data_json.clone();

    // Mark as picked up
    ctx.db.loot_drop().id().update(LootDrop {
        picked_up: true,
        ..loot
    });

    // Add to inventory
    ctx.db.inventory_item().insert(InventoryItem {
        id: 0, // auto_inc
        owner_identity: ctx.sender,
        item_data_json: item_data,
        equipped_slot: None,
        card_data_json: None,
    });

    log::info!("Loot {} picked up by {:?}", loot_id, ctx.sender);
    Ok(())
}

/// Add an inventory item directly (client-authoritative loot)
#[reducer]
pub fn add_inventory_item(ctx: &ReducerContext, item_data_json: String, rarity: String) -> Result<(), String> {
    if ctx.db.player().identity().find(ctx.sender).is_none() {
        return Err("Player not found".into());
    }
    ctx.db.inventory_item().insert(InventoryItem {
        id: 0,
        owner_identity: ctx.sender,
        item_data_json,
        equipped_slot: None,
        card_data_json: None,
    });
    log::info!("Inventory item added for {:?} (rarity: {})", ctx.sender, rarity);
    Ok(())
}

/// Equip an inventory item to a slot
#[reducer]
pub fn equip_item(ctx: &ReducerContext, item_id: u64, slot: String) -> Result<(), String> {
    let item = ctx.db.inventory_item().id().find(item_id)
        .ok_or("Item not found")?;
    if item.owner_identity != ctx.sender {
        return Err("Not your item".into());
    }

    // Unequip anything currently in that slot
    for existing in ctx.db.inventory_item().iter() {
        if existing.owner_identity == ctx.sender && existing.equipped_slot.as_deref() == Some(&slot) {
            ctx.db.inventory_item().id().update(InventoryItem {
                equipped_slot: None,
                ..existing
            });
        }
    }

    ctx.db.inventory_item().id().update(InventoryItem {
        equipped_slot: Some(slot),
        ..item
    });
    Ok(())
}

/// Unequip an item
#[reducer]
pub fn unequip_item(ctx: &ReducerContext, item_id: u64) -> Result<(), String> {
    let item = ctx.db.inventory_item().id().find(item_id)
        .ok_or("Item not found")?;
    if item.owner_identity != ctx.sender {
        return Err("Not your item".into());
    }
    ctx.db.inventory_item().id().update(InventoryItem {
        equipped_slot: None,
        ..item
    });
    Ok(())
}

/// Discard (delete) an inventory item
#[reducer]
pub fn discard_item(ctx: &ReducerContext, item_id: u64) -> Result<(), String> {
    let item = ctx.db.inventory_item().id().find(item_id)
        .ok_or("Item not found")?;
    if item.owner_identity != ctx.sender {
        return Err("Not your item".into());
    }
    ctx.db.inventory_item().id().delete(item_id);
    Ok(())
}

// ─── Player Communication Reducers ──────────────────────────────────────────

/// Send an emote message (quick phrase/emoji)
#[reducer]
pub fn send_emote(ctx: &ReducerContext, dungeon_id: u64, emote_content: String) -> Result<(), String> {
    // Validate player is in dungeon
    let is_participant = ctx.db.dungeon_participant().iter()
        .any(|p| p.dungeon_id == dungeon_id && p.player_identity == ctx.sender);
    if !is_participant {
        return Err("Not a participant in this dungeon".into());
    }

    // Get player name
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;

    // Insert message
    let timestamp = ctx.timestamp.to_duration_since_unix_epoch()
        .unwrap_or_default().as_millis() as u64;

    ctx.db.player_message().insert(PlayerMessage {
        id: 0,
        dungeon_id,
        sender_identity: ctx.sender,
        sender_name: player.name,
        message_type: "emote".to_string(),
        content: emote_content,
        created_at: timestamp,
    });

    Ok(())
}

/// Send a chat message (typed text)
#[reducer]
pub fn send_chat(ctx: &ReducerContext, dungeon_id: u64, text: String) -> Result<(), String> {
    // Validate player is in dungeon
    let is_participant = ctx.db.dungeon_participant().iter()
        .any(|p| p.dungeon_id == dungeon_id && p.player_identity == ctx.sender);
    if !is_participant {
        return Err("Not a participant in this dungeon".into());
    }

    // Limit message length
    if text.len() > 100 {
        return Err("Message too long (max 100 characters)".into());
    }

    // Get player name
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;

    // Insert message
    let timestamp = ctx.timestamp.to_duration_since_unix_epoch()
        .unwrap_or_default().as_millis() as u64;

    ctx.db.player_message().insert(PlayerMessage {
        id: 0,
        dungeon_id,
        sender_identity: ctx.sender,
        sender_name: player.name,
        message_type: "chat".to_string(),
        content: text,
        created_at: timestamp,
    });

    Ok(())
}

// ─── Enemy AI Tick (Scheduled Reducer) ─────────────────────────────────────────

/// Scheduled reducer: ticks all alive enemies at 20Hz with full AI behavior.
#[reducer]
pub fn tick_enemies(ctx: &ReducerContext, _arg: EnemyTickSchedule) {
    let dt = AI_DT;

    // Collect all player positions
    let positions: Vec<PlayerPosition> = ctx.db.player_position().iter().collect();

    // Collect all enemies for pack coordination
    let all_enemies: Vec<DungeonEnemy> = ctx.db.dungeon_enemy().iter().collect();

    // Tick ability cooldowns for all players
    tick_ability_cooldowns(ctx, dt);

    // Tick healing zones
    tick_healing_zones(ctx, dt);

    // Process each alive enemy
    for enemy in ctx.db.dungeon_enemy().iter() {
        if !enemy.is_alive {
            continue;
        }

        // Clone for modification
        let mut e = enemy.clone();

        // Update taunt timer
        if e.is_taunted && e.taunt_timer > 0.0 {
            e.taunt_timer -= dt;
            if e.taunt_timer <= 0.0 {
                e.is_taunted = false;
                e.taunted_by = None;
            }
        }

        // Determine target based on: taunt > threat > nearest
        let target = if e.is_taunted {
            // Force target the taunting player
            e.taunted_by.as_ref()
                .and_then(|hex| positions.iter().find(|p| p.identity.to_string() == *hex))
        } else if let Some(threat_target) = get_highest_threat_player(ctx, e.dungeon_id, e.id) {
            // Target highest threat player
            positions.iter().find(|p| p.identity == threat_target)
        } else {
            None
        };

        // Fall back to nearest player if no threat/taunt target
        let target = target.or_else(|| {
            positions.iter()
                .filter(|p| p.dungeon_id == e.dungeon_id)
                .min_by(|a, b| {
                    let da = (a.x - e.x).powi(2) + (a.y - e.y).powi(2);
                    let db = (b.x - e.x).powi(2) + (b.y - e.y).powi(2);
                    da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
                })
        });

        let Some(target) = target else {
            ctx.db.dungeon_enemy().id().update(e);
            continue;
        };

        // Store current target identity for rendering
        e.current_target = Some(target.identity.to_string());

        // Tank slow aura: enemies within 50px of any tank move at 70% speed
        let tank_nearby = positions.iter().any(|p| {
            if p.dungeon_id != e.dungeon_id || p.player_class != "tank" {
                return false;
            }
            let dist = ((p.x - e.x).powi(2) + (p.y - e.y).powi(2)).sqrt();
            dist <= 50.0
        });
        let speed_mult = if tank_nearby { 0.7 } else { 1.0 };

        let dx = target.x - e.x;
        let dy = target.y - e.y;
        let dist = (dx * dx + dy * dy).sqrt();
        let (nx, ny) = if dist > 0.1 { (dx / dist, dy / dist) } else { (0.0, 0.0) };

        match e.enemy_type.as_str() {
            "charger" => ai_charger(&mut e, target, dx, dy, dist, nx, ny, dt * speed_mult, ctx),
            "wolf" => ai_wolf(&mut e, target, dx, dy, dist, dt * speed_mult, &all_enemies, ctx),
            "necromancer" => ai_necromancer(&mut e, target, dx, dy, dist, nx, ny, dt),
            "bomber" => ai_bomber(&mut e, target, dx, dy, dist, nx, ny, dt * speed_mult, ctx),
            "shield_knight" => ai_shield_knight(&mut e, target, dx, dy, dist, nx, ny, dt * speed_mult, ctx),
            "archer" => ai_archer(&mut e, target, dx, dy, dist, nx, ny, dt, ctx),
            "raid_boss" => ai_raid_boss(&mut e, target, dx, dy, dist, nx, ny, dt, ctx, &positions),
            _ => ai_basic_melee(&mut e, target, dx, dy, dist, nx, ny, dt * speed_mult, ctx),
        }

        // Clamp position to room bounds
        e.x = e.x.clamp(TILE_SIZE, ROOM_W - TILE_SIZE);
        e.y = e.y.clamp(TILE_SIZE, ROOM_H - TILE_SIZE);

        // Update the enemy in the database
        ctx.db.dungeon_enemy().id().update(e);
    }
    // Note: No need to reschedule - ScheduleAt::Interval auto-repeats
}

// ─── AI Functions ──────────────────────────────────────────────────────────────

/// Basic melee AI (skeleton, slime, bat): chase → attack → chase
fn ai_basic_melee(e: &mut DungeonEnemy, target: &PlayerPosition, _dx: f32, _dy: f32, dist: f32, nx: f32, ny: f32, dt: f32, ctx: &ReducerContext) {
    let speed = get_enemy_speed(&e.enemy_type) * dt * 60.0; // Scale to 60fps equivalent

    // Update facing
    e.facing_angle = ny.atan2(nx);

    // Timer counts down for attack cooldown
    if e.state_timer > 0.0 {
        e.state_timer -= dt;
    }

    if dist <= ENEMY_ATTACK_RANGE {
        // Attack if cooldown ready
        if e.state_timer <= 0.0 {
            e.state_timer = 1.2; // Attack cooldown
            e.ai_state = "attack".to_string();

            // Deal damage to player
            if let Some(player) = ctx.db.player().identity().find(target.identity) {
                let damage = (e.atk - player.def / 2).max(1);
                let new_hp = player.hp - damage;
                ctx.db.player().identity().update(Player {
                    hp: new_hp.max(0),
                    ..player
                });
            }
        }
    } else {
        // Chase
        e.ai_state = "chase".to_string();
        e.x += nx * speed;
        e.y += ny * speed;
    }
}

/// Charger AI: chase → telegraph → charge → stunned
fn ai_charger(e: &mut DungeonEnemy, target: &PlayerPosition, dx: f32, dy: f32, dist: f32, nx: f32, ny: f32, dt: f32, ctx: &ReducerContext) {
    let base_speed = get_enemy_speed(&e.enemy_type) * dt * 60.0;

    match e.ai_state.as_str() {
        "stunned" => {
            e.state_timer -= dt;
            if e.state_timer <= 0.0 {
                e.ai_state = "idle".to_string();
                e.state_timer = 0.0;
            }
        }
        "telegraph" => {
            e.state_timer -= dt;
            // Lock charge direction at the start
            if e.state_timer > CHARGER_TELEGRAPH_TIME - 0.1 {
                e.target_x = dx;
                e.target_y = dy;
                let mag = (dx * dx + dy * dy).sqrt();
                if mag > 0.1 {
                    e.target_x /= mag;
                    e.target_y /= mag;
                }
                e.facing_angle = e.target_y.atan2(e.target_x);
            }
            if e.state_timer <= 0.0 {
                e.ai_state = "charge".to_string();
                e.state_timer = CHARGER_CHARGE_DURATION;
            }
        }
        "charge" => {
            e.state_timer -= dt;
            let charge_speed = base_speed * CHARGER_CHARGE_SPEED_MULT;
            let new_x = e.x + e.target_x * charge_speed;
            let new_y = e.y + e.target_y * charge_speed;

            // Check wall collision (simple bounds check)
            if new_x < TILE_SIZE || new_x > ROOM_W - TILE_SIZE ||
               new_y < TILE_SIZE || new_y > ROOM_H - TILE_SIZE {
                // Hit wall → stunned
                e.ai_state = "stunned".to_string();
                e.state_timer = CHARGER_STUN_TIME;
            } else {
                e.x = new_x;
                e.y = new_y;

                // Hit player while charging - deal damage!
                let player_dist = ((target.x - e.x).powi(2) + (target.y - e.y).powi(2)).sqrt();
                if player_dist < 30.0 {
                    e.ai_state = "stunned".to_string();
                    e.state_timer = CHARGER_STUN_TIME;
                    // Deal charge damage to player
                    if let Some(player) = ctx.db.player().identity().find(target.identity) {
                        let damage = ((e.atk as f32 * 1.5) as i32 - player.def / 2).max(1);
                        ctx.db.player().identity().update(Player {
                            hp: (player.hp - damage).max(0),
                            ..player
                        });
                    }
                }
            }

            if e.state_timer <= 0.0 {
                e.ai_state = "idle".to_string();
                e.state_timer = 0.0;
            }
        }
        _ => {
            // "idle" or default - wander toward player, initiate charge when close
            e.facing_angle = ny.atan2(nx);

            if dist > 60.0 {
                e.x += nx * base_speed * 0.5;
                e.y += ny * base_speed * 0.5;
            }

            e.state_timer -= dt;
            if e.state_timer <= 0.0 && dist < CHARGER_DETECT_RANGE {
                e.ai_state = "telegraph".to_string();
                e.state_timer = CHARGER_TELEGRAPH_TIME;
            }
        }
    }
}

/// Wolf AI: orbit around player in pack formation, attack together
fn ai_wolf(e: &mut DungeonEnemy, target: &PlayerPosition, _dx: f32, _dy: f32, dist: f32, dt: f32, all_enemies: &[DungeonEnemy], ctx: &ReducerContext) {
    let speed = get_enemy_speed(&e.enemy_type) * dt * 60.0;

    // Count pack members
    let pack_members: Vec<&DungeonEnemy> = all_enemies.iter()
        .filter(|o| o.is_alive && o.enemy_type == "wolf" && o.pack_id == e.pack_id && o.dungeon_id == e.dungeon_id)
        .collect();
    let pack_size = pack_members.len().max(1);
    let my_idx = pack_members.iter().position(|o| o.id == e.id).unwrap_or(0);

    // Time-based orbit
    let time_factor = e.state_timer;
    e.state_timer += dt;

    // Calculate orbit position
    let angle = (std::f32::consts::TAU / pack_size as f32) * my_idx as f32 + time_factor;
    let orbit_x = target.x + angle.cos() * WOLF_ORBIT_RADIUS;
    let orbit_y = target.y + angle.sin() * WOLF_ORBIT_RADIUS;

    // Move toward orbit position
    let tdx = orbit_x - e.x;
    let tdy = orbit_y - e.y;
    let tdist = (tdx * tdx + tdy * tdy).sqrt();

    if tdist > 5.0 {
        e.x += (tdx / tdist) * speed;
        e.y += (tdy / tdist) * speed;
    }

    // Face the player
    e.facing_angle = (target.y - e.y).atan2(target.x - e.x);

    // Pack attack bonus - wolves close together attack faster
    let close_wolves = pack_members.iter()
        .filter(|w| {
            let d = ((target.x - w.x).powi(2) + (target.y - w.y).powi(2)).sqrt();
            d < 60.0
        })
        .count();

    // Attack when close enough to player
    if dist < 40.0 {
        e.ai_state = if close_wolves >= 2 { "pack_attack" } else { "attack" }.to_string();
        // Deal damage on attack (timer based)
        if e.target_x <= 0.0 {
            // target_x is used as attack cooldown for wolf
            e.target_x = 1.5; // Attack cooldown
            if let Some(player) = ctx.db.player().identity().find(target.identity) {
                let damage = (e.atk - player.def / 2).max(1);
                ctx.db.player().identity().update(Player {
                    hp: (player.hp - damage).max(0),
                    ..player
                });
            }
        } else {
            e.target_x -= dt;
        }
    } else {
        e.ai_state = "orbit".to_string();
    }
}

/// Necromancer AI: flee → teleport → summon
fn ai_necromancer(e: &mut DungeonEnemy, _target: &PlayerPosition, _dx: f32, _dy: f32, dist: f32, nx: f32, ny: f32, dt: f32) {
    let speed = get_enemy_speed(&e.enemy_type) * dt * 60.0;

    e.facing_angle = ny.atan2(nx);
    e.state_timer -= dt;

    if dist < NECRO_FLEE_DISTANCE {
        // Too close - flee or teleport
        if e.state_timer <= 0.0 {
            // Teleport to random position away from player
            e.target_x = TILE_SIZE * 2.0 + (e.id as f32 * 1.7).sin().abs() * (ROOM_W - TILE_SIZE * 4.0);
            e.target_y = TILE_SIZE * 3.0 + (e.id as f32 * 2.3).cos().abs() * (ROOM_H - TILE_SIZE * 6.0);
            e.x = e.target_x;
            e.y = e.target_y;
            e.ai_state = "teleport".to_string();
            e.state_timer = NECRO_TELEPORT_CD;
        } else {
            // Move away from player
            e.ai_state = "flee".to_string();
            e.x -= nx * speed;
            e.y -= ny * speed;
        }
    } else if dist < 150.0 {
        // Maintain distance - move away slowly
        e.ai_state = "flee".to_string();
        e.x -= nx * speed * 0.5;
        e.y -= ny * speed * 0.5;
    } else {
        // Safe distance - can summon
        e.ai_state = "summon".to_string();
    }
}

/// Bomber AI: chase → fuse → explode
fn ai_bomber(e: &mut DungeonEnemy, _target: &PlayerPosition, _dx: f32, _dy: f32, dist: f32, nx: f32, ny: f32, dt: f32, ctx: &ReducerContext) {
    let speed = get_enemy_speed(&e.enemy_type) * dt * 60.0;

    e.facing_angle = ny.atan2(nx);

    match e.ai_state.as_str() {
        "fuse" => {
            e.state_timer -= dt;
            if e.state_timer <= 0.0 {
                // EXPLODE - damage nearby players
                e.ai_state = "explode".to_string();

                // Damage all players in explosion radius
                for pos in ctx.db.player_position().iter() {
                    if pos.dungeon_id == e.dungeon_id {
                        let exp_dist = ((pos.x - e.x).powi(2) + (pos.y - e.y).powi(2)).sqrt();
                        if exp_dist < BOMBER_EXPLOSION_RADIUS {
                            if let Some(player) = ctx.db.player().identity().find(pos.identity) {
                                let damage = (e.atk - player.def / 2).max(1);
                                let new_hp = player.hp - damage;
                                ctx.db.player().identity().update(Player {
                                    hp: new_hp.max(0),
                                    ..player
                                });
                            }
                        }
                    }
                }

                // Kill self (mark for death, will be processed separately)
                e.hp = 0;
                e.is_alive = false;
            }
        }
        "explode" => {
            // Already exploded, do nothing
        }
        _ => {
            // Chase until close enough to start fuse
            if dist < BOMBER_TRIGGER_RANGE {
                e.ai_state = "fuse".to_string();
                e.state_timer = BOMBER_FUSE_TIME;
            } else {
                e.ai_state = "chase".to_string();
                e.x += nx * speed;
                e.y += ny * speed;
            }
        }
    }
}

/// Shield Knight AI: advance → shield_bash → recover
fn ai_shield_knight(e: &mut DungeonEnemy, target: &PlayerPosition, _dx: f32, _dy: f32, dist: f32, nx: f32, ny: f32, dt: f32, ctx: &ReducerContext) {
    let speed = get_enemy_speed(&e.enemy_type) * dt * 60.0;

    // Shield always faces player
    e.facing_angle = ny.atan2(nx);
    e.state_timer -= dt;

    match e.ai_state.as_str() {
        "shield_bash" => {
            if e.state_timer <= 0.0 {
                // Bash complete, recover
                e.ai_state = "recover".to_string();
                e.state_timer = SHIELD_RECOVER_TIME;

                // Damage player if in range
                if dist < 50.0 {
                    if let Some(player) = ctx.db.player().identity().find(target.identity) {
                        let damage = ((e.atk as f32 * 0.5) as i32 - player.def / 2).max(1);
                        let new_hp = player.hp - damage;
                        ctx.db.player().identity().update(Player {
                            hp: new_hp.max(0),
                            ..player
                        });
                    }
                }
            }
        }
        "recover" => {
            if e.state_timer <= 0.0 {
                e.ai_state = "advance".to_string();
                e.state_timer = SHIELD_BASH_CD;
            }
        }
        _ => {
            // Advance toward player
            if dist > ENEMY_ATTACK_RANGE {
                e.x += nx * speed;
                e.y += ny * speed;
            }

            // Start bash if cooldown ready and in range
            if e.state_timer <= 0.0 && dist < 50.0 {
                e.ai_state = "shield_bash".to_string();
                e.state_timer = 0.3; // Bash wind-up
            }

            // Regular attack
            if dist < ENEMY_ATTACK_RANGE && e.state_timer <= -1.0 {
                e.state_timer = -2.5; // Attack cooldown (negative to distinguish from bash)
                if let Some(player) = ctx.db.player().identity().find(target.identity) {
                    let damage = (e.atk - player.def / 2).max(1);
                    let new_hp = player.hp - damage;
                    ctx.db.player().identity().update(Player {
                        hp: new_hp.max(0),
                        ..player
                    });
                }
            }
        }
    }
}

/// Archer AI: kite → shoot → kite
fn ai_archer(e: &mut DungeonEnemy, target: &PlayerPosition, _dx: f32, _dy: f32, dist: f32, nx: f32, ny: f32, dt: f32, ctx: &ReducerContext) {
    let speed = get_enemy_speed(&e.enemy_type) * dt * 60.0;

    e.facing_angle = ny.atan2(nx);
    e.state_timer -= dt;

    // Kite - maintain distance
    if dist < ARCHER_KITE_DISTANCE {
        e.ai_state = "kite".to_string();
        e.x -= nx * speed;
        e.y -= ny * speed;
    } else if dist < ARCHER_SHOOT_RANGE {
        // In shoot range
        if e.state_timer <= 0.0 {
            e.ai_state = "shoot".to_string();
            e.state_timer = ARCHER_SHOOT_CD;
            // Store target position for projectile (client will render)
            e.target_x = target.x;
            e.target_y = target.y;
            // Deal arrow damage (instant hit for simplicity)
            if let Some(player) = ctx.db.player().identity().find(target.identity) {
                let damage = (e.atk - player.def / 2).max(1);
                ctx.db.player().identity().update(Player {
                    hp: (player.hp - damage).max(0),
                    ..player
                });
            }
        } else {
            e.ai_state = "kite".to_string();
        }
    } else {
        // Too far, approach
        e.ai_state = "chase".to_string();
        e.x += nx * speed * 0.5;
        e.y += ny * speed * 0.5;
    }
}

/// Raid Boss AI: 3-phase boss fight
/// Phase 1 (100-60% HP): Attack highest threat, tank check
/// Phase 2 (60-30% HP): Teleport center, spawn adds every 6s
/// Phase 3 (<30% HP): Enrage (+50% ATK), raid-wide AoE every 4s
fn ai_raid_boss(e: &mut DungeonEnemy, target: &PlayerPosition, _dx: f32, _dy: f32, dist: f32, nx: f32, ny: f32, dt: f32, ctx: &ReducerContext, all_positions: &[PlayerPosition]) {
    let speed = 40.0 * dt * 60.0; // Slow but menacing

    e.facing_angle = ny.atan2(nx);
    e.state_timer -= dt;

    // Calculate current phase based on HP percentage
    let hp_pct = e.hp as f32 / e.max_hp as f32;
    let new_phase = if hp_pct > 0.6 { 1 } else if hp_pct > 0.3 { 2 } else { 3 };

    // Phase transition
    if new_phase != e.boss_phase {
        e.boss_phase = new_phase;
        e.state_timer = 0.5; // Brief pause during transition
        match new_phase {
            2 => {
                // Teleport to center
                e.x = 270.0;
                e.y = 360.0;
                e.ai_state = "phase2".to_string();
            }
            3 => {
                // Enrage
                e.atk = (e.atk as f32 * 1.5) as i32;
                e.ai_state = "enrage".to_string();
            }
            _ => {}
        }
    }

    match e.boss_phase {
        1 => {
            // Phase 1: Chase and attack highest threat
            if dist <= ENEMY_ATTACK_RANGE + 15.0 {
                if e.state_timer <= 0.0 {
                    e.state_timer = 1.0;
                    e.ai_state = "attack".to_string();
                    // Deal damage to target
                    if let Some(player) = ctx.db.player().identity().find(target.identity) {
                        let damage = (e.atk - player.def / 2).max(1);
                        ctx.db.player().identity().update(Player {
                            hp: (player.hp - damage).max(0),
                            ..player
                        });
                    }
                }
            } else {
                e.ai_state = "chase".to_string();
                e.x += nx * speed;
                e.y += ny * speed;
            }
        }
        2 => {
            // Phase 2: Spawn adds every 6 seconds, chase between spawns
            if e.state_timer <= 0.0 {
                e.state_timer = 6.0;
                e.ai_state = "summon".to_string();
                // Spawn 2 skeleton adds around the boss
                for i in 0..2 {
                    let angle = (i as f32) * std::f32::consts::PI;
                    let (add_hp, add_atk) = get_enemy_stats("skeleton", 1);
                    ctx.db.dungeon_enemy().insert(DungeonEnemy {
                        id: 0,
                        dungeon_id: e.dungeon_id,
                        room_index: e.room_index,
                        enemy_type: "skeleton".to_string(),
                        x: e.x + angle.cos() * 50.0,
                        y: e.y + angle.sin() * 50.0,
                        hp: add_hp,
                        max_hp: add_hp,
                        atk: add_atk,
                        is_alive: true,
                        ai_state: "chase".to_string(),
                        state_timer: 0.0,
                        target_x: e.x,
                        target_y: e.y,
                        facing_angle: angle,
                        pack_id: None,
                        current_target: None,
                        is_taunted: false,
                        taunted_by: None,
                        taunt_timer: 0.0,
                        is_boss: false,
                        boss_phase: 0,
                    });
                }
            } else {
                // Chase between summons
                if dist > ENEMY_ATTACK_RANGE + 10.0 {
                    e.x += nx * speed * 0.7;
                    e.y += ny * speed * 0.7;
                } else if e.ai_state != "summon" {
                    e.ai_state = "attack".to_string();
                    // Attack
                    if let Some(player) = ctx.db.player().identity().find(target.identity) {
                        let damage = (e.atk - player.def / 2).max(1);
                        ctx.db.player().identity().update(Player {
                            hp: (player.hp - damage).max(0),
                            ..player
                        });
                    }
                }
            }
        }
        3 => {
            // Phase 3: Enraged, raid-wide AoE every 4 seconds
            if e.state_timer <= 0.0 {
                e.state_timer = 4.0;
                e.ai_state = "aoe".to_string();
                // Deal AoE damage to ALL players in dungeon
                for pos in all_positions.iter() {
                    if pos.dungeon_id != e.dungeon_id {
                        continue;
                    }
                    if let Some(player) = ctx.db.player().identity().find(pos.identity) {
                        let aoe_damage = (e.atk / 3).max(5); // Reduced damage but hits everyone
                        ctx.db.player().identity().update(Player {
                            hp: (player.hp - aoe_damage).max(0),
                            ..player
                        });
                    }
                }
            } else {
                // Aggressive chase and attack
                e.ai_state = "enrage".to_string();
                if dist > ENEMY_ATTACK_RANGE {
                    e.x += nx * speed * 1.5; // Faster when enraged
                    e.y += ny * speed * 1.5;
                } else {
                    // Fast attacks
                    if let Some(player) = ctx.db.player().identity().find(target.identity) {
                        let damage = (e.atk - player.def / 2).max(1);
                        ctx.db.player().identity().update(Player {
                            hp: (player.hp - damage).max(0),
                            ..player
                        });
                    }
                }
            }
        }
        _ => {}
    }
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

/// Schedule the next enemy AI tick (50ms = 20Hz for smooth multiplayer sync)
fn schedule_enemy_tick(ctx: &ReducerContext) {
    ctx.db.enemy_tick_schedule().insert(EnemyTickSchedule {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(TimeDuration::from_micros(50_000)),
    });
}

/// Spawn enemies for a given room
fn spawn_enemies_for_room(ctx: &ReducerContext, dungeon_id: u64, room_index: u32, depth: u32, seed: u64) {
    let room_seed = seed.wrapping_add(room_index as u64 * 1337);
    let mut pack_id_counter: u64 = seed.wrapping_add(room_index as u64);

    // Fixed 4-room structure:
    // Room 0: Basic (Training) - slimes, skeletons
    // Room 1: Tactical (Chamber) - archers, chargers + mini-boss (Shield Knight)
    // Room 2: Complex (Gauntlet) - necromancers, bombers, wolf packs
    // Room 3: Raid (Arena) - raid boss only (requires 2+ players)
    let enemy_types: Vec<&str> = match room_index {
        0 => vec!["slime", "slime", "skeleton", "bat"],
        1 => vec!["archer", "charger", "skeleton", "shield_knight"], // mini-boss: shield_knight
        2 => vec!["wolf", "wolf", "necromancer", "bomber"],
        3 => vec!["raid_boss"], // Raid boss room
        _ => vec!["slime", "skeleton"],
    };

    let enemy_count = enemy_types.len();

    for i in 0..enemy_count {
        let et = enemy_types[i];
        let (hp, atk) = get_enemy_stats(et, depth);

        // Spread enemies around the room (raid boss centered)
        let angle = if et == "raid_boss" {
            0.0
        } else {
            (i as f32 / enemy_count as f32) * std::f32::consts::TAU
        };
        let radius = if et == "raid_boss" {
            0.0 // Center of room
        } else {
            150.0 + (room_seed.wrapping_add(i as u64) % 80) as f32
        };
        let x = 270.0 + angle.cos() * radius; // Room center
        let y = 360.0 + angle.sin() * radius;

        // Initial AI state depends on enemy type
        let (initial_state, pack_id) = match et {
            "charger" => ("idle".to_string(), None),
            "wolf" => {
                pack_id_counter += 1;
                ("orbit".to_string(), Some(pack_id_counter))
            }
            "bomber" => ("chase".to_string(), None),
            "necromancer" => ("flee".to_string(), None),
            "shield_knight" => ("advance".to_string(), None),
            "archer" => ("kite".to_string(), None),
            _ => ("chase".to_string(), None), // skeleton, slime, bat
        };

        let is_boss = et == "boss" || et == "raid_boss";
        ctx.db.dungeon_enemy().insert(DungeonEnemy {
            id: 0, // auto_inc
            dungeon_id,
            room_index,
            enemy_type: et.to_string(),
            x,
            y,
            hp,
            max_hp: hp,
            atk,
            is_alive: true,
            ai_state: initial_state,
            state_timer: 0.0,
            target_x: x,
            target_y: y,
            facing_angle: angle,
            pack_id,
            // Threat system fields
            current_target: None,
            is_taunted: false,
            taunted_by: None,
            taunt_timer: 0.0,
            // Boss fields
            is_boss,
            boss_phase: if is_boss { 1 } else { 0 },
        });
    }
}

/// Get base stats for an enemy type, scaled by dungeon depth
fn get_enemy_stats(enemy_type: &str, depth: u32) -> (i32, i32) {
    let scale = 1.0 + (depth as f32 - 1.0) * 0.15;
    let (base_hp, base_atk) = match enemy_type {
        "skeleton" => (60, 12),
        "slime" => (40, 8),
        "charger" => (40, 20),
        "necromancer" => (60, 5),
        "bat" => (15, 6),
        "wolf" => (20, 8),
        "bomber" => (25, 30),
        "shield_knight" => (70, 12),
        "archer" => (35, 10),
        "boss" => (300, 18),
        "raid_boss" => (800, 25), // 3-phase raid boss
        _ => (20, 5),
    };
    ((base_hp as f32 * scale) as i32, (base_atk as f32 * scale) as i32)
}

/// Get movement speed for enemy type (base pixels per tick at 60fps equivalent)
fn get_enemy_speed(enemy_type: &str) -> f32 {
    match enemy_type {
        "charger" => ENEMY_MOVE_SPEED * 2.5,
        "bat" => ENEMY_MOVE_SPEED * 1.5,
        "wolf" => ENEMY_MOVE_SPEED * 1.8,
        "necromancer" => ENEMY_MOVE_SPEED * 0.5,
        "bomber" => ENEMY_MOVE_SPEED * 0.8,
        "shield_knight" => ENEMY_MOVE_SPEED * 0.7,
        "archer" => ENEMY_MOVE_SPEED * 0.6,
        _ => ENEMY_MOVE_SPEED,
    }
}

/// Get XP reward for killing an enemy type
fn get_enemy_xp(enemy_type: &str) -> u64 {
    match enemy_type {
        "skeleton" => 15,
        "slime" => 10,
        "charger" => 25,
        "necromancer" => 50,
        "bat" => 8,
        "wolf" => 12,
        "bomber" => 20,
        "shield_knight" => 35,
        "archer" => 18,
        "boss" => 100,
        _ => 10,
    }
}

/// Drop loot when an enemy dies (takes individual fields to avoid borrow issues)
fn drop_loot_for_dead_enemy(
    ctx: &ReducerContext,
    enemy_type: &str,
    dungeon_id: u64,
    room_index: u32,
    x: f32,
    y: f32,
    atk: i32,
    max_hp: i32,
) {
    // Determine rarity based on enemy type
    // Boss/raid_boss: 5% legendary, 25% epic, 50% rare
    // Shield_knight (mini-boss): 10% epic, 40% rare
    // Others: standard rates
    let is_boss = enemy_type == "boss" || enemy_type == "raid_boss";
    let is_miniboss = enemy_type == "shield_knight";

    let rarity = if is_boss {
        let roll: f32 = (ctx.timestamp.to_duration_since_unix_epoch().unwrap_or_default().as_micros() % 100) as f32 / 100.0;
        if roll < 0.05 { "legendary" }
        else if roll < 0.30 { "epic" }
        else if roll < 0.80 { "rare" }
        else { "uncommon" }
    } else if is_miniboss {
        let roll: f32 = (ctx.timestamp.to_duration_since_unix_epoch().unwrap_or_default().as_micros() % 100) as f32 / 100.0;
        if roll < 0.10 { "epic" }
        else if roll < 0.50 { "rare" }
        else { "uncommon" }
    } else {
        // Regular enemies: 1% legendary for class gear
        let roll: f32 = (ctx.timestamp.to_duration_since_unix_epoch().unwrap_or_default().as_micros() % 100) as f32 / 100.0;
        if roll < 0.01 { "legendary" }
        else {
            match enemy_type {
                "necromancer" => "rare",
                "charger" => "uncommon",
                _ => "common",
            }
        }
    };

    // For legendary drops, pick a random participant's class for class-specific gear
    let class_tag = if rarity == "legendary" {
        // Get all participants in this dungeon and pick random class
        let participants: Vec<Identity> = ctx.db.dungeon_participant().iter()
            .filter(|p| p.dungeon_id == dungeon_id)
            .map(|p| p.player_identity)
            .collect();

        if !participants.is_empty() {
            let idx = (ctx.timestamp.to_duration_since_unix_epoch().unwrap_or_default().as_micros() as usize) % participants.len();
            if let Some(player) = ctx.db.player().identity().find(participants[idx]) {
                format!(",\"classReq\":\"{}\"", player.player_class)
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let item_json = format!(
        r#"{{"type":"drop","source":"{}","atk_bonus":{},"def_bonus":{},"rarity":"{}"{}}}"#,
        enemy_type,
        atk / 2,
        max_hp / 10,
        rarity,
        class_tag,
    );

    ctx.db.loot_drop().insert(LootDrop {
        id: 0,
        dungeon_id,
        room_index,
        x,
        y,
        item_data_json: item_json,
        rarity: rarity.to_string(),
        picked_up: false,
    });
}

/// Check if player should level up, returns (new_level, new_max_hp, new_atk, new_def)
fn check_level_up(level: u32, xp: u64, max_hp: i32, atk: i32, def: i32) -> (u32, i32, i32, i32) {
    let mut lvl = level;
    let mut hp = max_hp;
    let mut a = atk;
    let mut d = def;

    // Keep leveling up while XP exceeds threshold
    while xp >= lvl as u64 * BASE_XP_PER_LEVEL {
        lvl += 1;
        hp += 10;
        a += 2;
        d += 1;
    }

    (lvl, hp, a, d)
}

/// Clean up all enemies and loot for a dungeon
fn cleanup_dungeon(ctx: &ReducerContext, dungeon_id: u64) {
    // Delete enemies
    let enemies: Vec<u64> = ctx.db.dungeon_enemy().iter()
        .filter(|e| e.dungeon_id == dungeon_id)
        .map(|e| e.id)
        .collect();
    for id in enemies {
        ctx.db.dungeon_enemy().id().delete(id);
    }

    // Delete loot
    let loots: Vec<u64> = ctx.db.loot_drop().iter()
        .filter(|l| l.dungeon_id == dungeon_id)
        .map(|l| l.id)
        .collect();
    for id in loots {
        ctx.db.loot_drop().id().delete(id);
    }

    // Delete participants
    let participants: Vec<u64> = ctx.db.dungeon_participant().iter()
        .filter(|p| p.dungeon_id == dungeon_id)
        .map(|p| p.id)
        .collect();
    for id in participants {
        ctx.db.dungeon_participant().id().delete(id);
    }

    // Delete player_position entries for this dungeon
    let positions: Vec<Identity> = ctx.db.player_position().iter()
        .filter(|p| p.dungeon_id == dungeon_id)
        .map(|p| p.identity)
        .collect();
    for identity in positions {
        ctx.db.player_position().identity().delete(identity);
    }

    // Delete player messages for this dungeon
    let messages: Vec<u64> = ctx.db.player_message().iter()
        .filter(|m| m.dungeon_id == dungeon_id)
        .map(|m| m.id)
        .collect();
    for id in messages {
        ctx.db.player_message().id().delete(id);
    }
}

// ─── Game Mode Reducers ─────────────────────────────────────────────────────────

/// Set player's current game mode
#[reducer]
pub fn set_game_mode(ctx: &ReducerContext, mode: String) -> Result<(), String> {
    if ctx.db.player().identity().find(ctx.sender).is_none() {
        return Err("Player not found".into());
    }

    let valid_modes = ["hub", "open_world", "dungeon", "raid"];
    if !valid_modes.contains(&mode.as_str()) {
        return Err("Invalid game mode".into());
    }

    if let Some(existing) = ctx.db.player_game_mode().identity().find(ctx.sender) {
        ctx.db.player_game_mode().identity().update(PlayerGameMode {
            mode,
            instance_id: None,
            ..existing
        });
    } else {
        ctx.db.player_game_mode().insert(PlayerGameMode {
            identity: ctx.sender,
            mode,
            instance_id: None,
        });
    }

    Ok(())
}

/// Enter Open World mode
#[reducer]
pub fn enter_open_world(ctx: &ReducerContext) -> Result<(), String> {
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;

    // Find or create an open world instance with room for more players
    let instance = ctx.db.open_world_instance().iter()
        .find(|i| i.player_count < OPEN_WORLD_MAX_PLAYERS_PER_SHARD);

    let instance_id = if let Some(inst) = instance {
        // Join existing instance
        ctx.db.open_world_instance().id().update(OpenWorldInstance {
            player_count: inst.player_count + 1,
            ..inst
        });
        inst.id
    } else {
        // Create new instance
        let timestamp = ctx.timestamp.to_duration_since_unix_epoch()
            .unwrap_or_default().as_millis() as u64;
        let new_inst = ctx.db.open_world_instance().insert(OpenWorldInstance {
            id: 0,
            created_at: timestamp,
            player_count: 1,
        });

        // Spawn enemies for all rooms in the new instance
        spawn_open_world_enemies(ctx, new_inst.id);

        // Start the open world tick scheduler if not running
        if ctx.db.open_world_tick_schedule().iter().count() == 0 {
            schedule_open_world_tick(ctx);
        }

        new_inst.id
    };

    // Spawn player at town center (5, 5)
    ctx.db.open_world_player().insert(OpenWorldPlayer {
        identity: ctx.sender,
        instance_id,
        room_x: 5,
        room_y: 5,
        x: ROOM_W / 2.0,
        y: ROOM_H / 2.0,
        facing_x: 0.0,
        facing_y: -1.0,
        name: player.name.clone(),
        level: player.level,
        player_class: player.player_class.clone(),
        weapon_icon: String::new(),
        armor_icon: String::new(),
        accessory_icon: String::new(),
    });

    // Update game mode
    if let Some(gm) = ctx.db.player_game_mode().identity().find(ctx.sender) {
        ctx.db.player_game_mode().identity().update(PlayerGameMode {
            mode: "open_world".to_string(),
            instance_id: Some(instance_id),
            ..gm
        });
    } else {
        ctx.db.player_game_mode().insert(PlayerGameMode {
            identity: ctx.sender,
            mode: "open_world".to_string(),
            instance_id: Some(instance_id),
        });
    }

    log::info!("Player {:?} entered Open World instance {}", ctx.sender, instance_id);
    Ok(())
}

/// Leave Open World mode
#[reducer]
pub fn leave_open_world(ctx: &ReducerContext) -> Result<(), String> {
    let ow_player = ctx.db.open_world_player().identity().find(ctx.sender)
        .ok_or("Not in Open World")?;

    let instance_id = ow_player.instance_id;
    ctx.db.open_world_player().identity().delete(ctx.sender);

    // Decrement player count
    if let Some(inst) = ctx.db.open_world_instance().id().find(instance_id) {
        let new_count = inst.player_count.saturating_sub(1);
        if new_count == 0 {
            // Delete empty instance and its enemies
            cleanup_open_world_instance(ctx, instance_id);
        } else {
            ctx.db.open_world_instance().id().update(OpenWorldInstance {
                player_count: new_count,
                ..inst
            });
        }
    }

    // Update game mode to hub
    if let Some(gm) = ctx.db.player_game_mode().identity().find(ctx.sender) {
        ctx.db.player_game_mode().identity().update(PlayerGameMode {
            mode: "hub".to_string(),
            instance_id: None,
            ..gm
        });
    }

    log::info!("Player {:?} left Open World", ctx.sender);
    Ok(())
}

/// Update player position in Open World
#[reducer]
pub fn update_open_world_position(
    ctx: &ReducerContext,
    room_x: i32,
    room_y: i32,
    x: f32,
    y: f32,
    facing_x: f32,
    facing_y: f32,
    weapon_icon: String,
    armor_icon: String,
    accessory_icon: String,
) -> Result<(), String> {
    let ow_player = ctx.db.open_world_player().identity().find(ctx.sender)
        .ok_or("Not in Open World")?;

    // Validate room bounds
    if room_x < 0 || room_x >= OPEN_WORLD_SIZE || room_y < 0 || room_y >= OPEN_WORLD_SIZE {
        return Err("Invalid room coordinates".into());
    }

    ctx.db.open_world_player().identity().update(OpenWorldPlayer {
        room_x,
        room_y,
        x,
        y,
        facing_x,
        facing_y,
        weapon_icon,
        armor_icon,
        accessory_icon,
        ..ow_player
    });

    Ok(())
}

/// Attack an enemy in Open World
#[reducer]
pub fn attack_open_world(ctx: &ReducerContext, enemy_id: u64) -> Result<(), String> {
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;
    let ow_player = ctx.db.open_world_player().identity().find(ctx.sender)
        .ok_or("Not in Open World")?;
    let enemy = ctx.db.open_world_enemy().id().find(enemy_id)
        .ok_or("Enemy not found")?;

    if !enemy.is_alive {
        return Err("Enemy already dead".into());
    }

    // Check if enemy is in same room
    if enemy.room_x != ow_player.room_x || enemy.room_y != ow_player.room_y {
        return Err("Enemy not in same room".into());
    }

    // Range check
    let dx = ow_player.x - enemy.x;
    let dy = ow_player.y - enemy.y;
    let dist = (dx * dx + dy * dy).sqrt();
    if dist > ATTACK_RANGE {
        return Err("Target out of range".into());
    }

    // Calculate damage
    let damage = player.atk.max(1);
    let new_hp = enemy.hp - damage;

    // Calculate XP with level scaling
    let enemy_level = get_enemy_level_for_room(enemy.room_x, enemy.room_y);
    let level_diff = enemy_level as i32 - player.level as i32;
    let xp_mult = if level_diff <= -5 {
        0.25  // 25% XP if 5+ levels above enemy
    } else if level_diff >= 5 {
        1.5   // 150% XP if 5+ levels below enemy
    } else {
        1.0
    };

    if new_hp <= 0 {
        // Enemy dies
        let base_xp = get_enemy_xp(&enemy.enemy_type);
        let scaled_xp = (base_xp as f32 * xp_mult) as u64;

        // Set respawn timer
        let is_hotspot = is_hotspot_room(enemy.room_x, enemy.room_y);
        let respawn_delay = if is_hotspot { OPEN_WORLD_HOTSPOT_RESPAWN_MS } else { OPEN_WORLD_BASE_RESPAWN_MS };
        let respawn_at = ctx.timestamp.to_duration_since_unix_epoch()
            .unwrap_or_default().as_millis() as u64 + respawn_delay;

        ctx.db.open_world_enemy().id().update(OpenWorldEnemy {
            hp: 0,
            is_alive: false,
            respawn_at,
            ..enemy
        });

        // Award XP
        let new_xp = player.xp + scaled_xp;
        let (new_level, new_max_hp, new_atk, new_def) = check_level_up(
            player.level, new_xp, player.max_hp, player.atk, player.def,
        );
        ctx.db.player().identity().update(Player {
            xp: new_xp,
            level: new_level,
            max_hp: new_max_hp,
            atk: new_atk,
            def: new_def,
            ..player
        });

        log::info!("Open World enemy {} killed, +{}xp (scaled)", enemy_id, scaled_xp);
    } else {
        ctx.db.open_world_enemy().id().update(OpenWorldEnemy {
            hp: new_hp,
            ..enemy
        });
    }

    Ok(())
}

/// Queue for dungeon matchmaking
#[reducer]
pub fn queue_dungeon(ctx: &ReducerContext, dungeon_tier: u32, difficulty: u32) -> Result<(), String> {
    if ctx.db.player().identity().find(ctx.sender).is_none() {
        return Err("Player not found".into());
    }

    if dungeon_tier < 1 || dungeon_tier > 3 {
        return Err("Invalid dungeon tier (1-3)".into());
    }

    if difficulty < 1 || difficulty > 5 {
        return Err("Invalid difficulty (1-5 stars)".into());
    }

    // Cancel any existing queue
    if ctx.db.dungeon_queue().identity().find(ctx.sender).is_some() {
        ctx.db.dungeon_queue().identity().delete(ctx.sender);
    }
    if ctx.db.raid_queue().identity().find(ctx.sender).is_some() {
        ctx.db.raid_queue().identity().delete(ctx.sender);
    }

    let queued_at = ctx.timestamp.to_duration_since_unix_epoch()
        .unwrap_or_default().as_millis() as u64;

    ctx.db.dungeon_queue().insert(DungeonQueue {
        identity: ctx.sender,
        dungeon_tier,
        difficulty,
        queued_at,
    });

    // Start matchmaking scheduler if not running
    if ctx.db.matchmaking_tick_schedule().iter().count() == 0 {
        schedule_matchmaking_tick(ctx);
    }

    log::info!("Player {:?} queued for dungeon tier {} difficulty {}", ctx.sender, dungeon_tier, difficulty);
    Ok(())
}

/// Start dungeon solo immediately
#[reducer]
pub fn start_dungeon_solo(ctx: &ReducerContext, dungeon_tier: u32, difficulty: u32) -> Result<(), String> {
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;

    if dungeon_tier < 1 || dungeon_tier > 3 {
        return Err("Invalid dungeon tier (1-3)".into());
    }

    // Cancel any existing queue
    if ctx.db.dungeon_queue().identity().find(ctx.sender).is_some() {
        ctx.db.dungeon_queue().identity().delete(ctx.sender);
    }

    // Create dungeon with tier-specific room
    let seed = ctx.timestamp.to_duration_since_unix_epoch()
        .unwrap_or_default().as_micros() as u64;

    // Difficulty scales enemy stats: +15% per star above 1
    let stat_mult = 1.0 + (difficulty.saturating_sub(1) as f32 * 0.15);

    let dungeon = ctx.db.active_dungeon().insert(ActiveDungeon {
        id: 0,
        owner_identity: ctx.sender,
        depth: dungeon_tier,  // Use tier as depth for enemy scaling
        current_room: 0,
        total_rooms: 1,  // Single room for tiered dungeons
        seed,
    });

    ctx.db.dungeon_participant().insert(DungeonParticipant {
        id: 0,
        dungeon_id: dungeon.id,
        player_identity: ctx.sender,
    });

    // Spawn enemies for the tier's room (room_index = tier - 1)
    spawn_enemies_for_tier(ctx, dungeon.id, dungeon_tier, stat_mult, seed);

    // Start enemy AI tick
    if ctx.db.enemy_tick_schedule().iter().count() == 0 {
        schedule_enemy_tick(ctx);
    }

    // Initialize player position
    ctx.db.player_position().insert(PlayerPosition {
        identity: ctx.sender,
        dungeon_id: dungeon.id,
        x: 270.0,
        y: 360.0,
        facing_x: 0.0,
        facing_y: -1.0,
        name: player.name.clone(),
        level: player.level,
        player_class: player.player_class.clone(),
        weapon_icon: String::new(),
        armor_icon: String::new(),
        accessory_icon: String::new(),
    });

    // Update game mode
    if let Some(gm) = ctx.db.player_game_mode().identity().find(ctx.sender) {
        ctx.db.player_game_mode().identity().update(PlayerGameMode {
            mode: "dungeon".to_string(),
            instance_id: Some(dungeon.id),
            ..gm
        });
    }

    log::info!("Started solo dungeon tier {} difficulty {} for {:?}", dungeon_tier, difficulty, ctx.sender);
    Ok(())
}

/// Queue for raid matchmaking
#[reducer]
pub fn queue_raid(ctx: &ReducerContext) -> Result<(), String> {
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;

    // Check raid cooldown
    if let Some(cd) = ctx.db.raid_cooldown().identity().find(ctx.sender) {
        let now = ctx.timestamp.to_duration_since_unix_epoch()
            .unwrap_or_default().as_millis() as u64;
        if now < cd.cooldown_until {
            return Err("Raid on cooldown".into());
        }
    }

    // Cancel any existing queue
    if ctx.db.dungeon_queue().identity().find(ctx.sender).is_some() {
        ctx.db.dungeon_queue().identity().delete(ctx.sender);
    }
    if ctx.db.raid_queue().identity().find(ctx.sender).is_some() {
        ctx.db.raid_queue().identity().delete(ctx.sender);
    }

    let queued_at = ctx.timestamp.to_duration_since_unix_epoch()
        .unwrap_or_default().as_millis() as u64;

    ctx.db.raid_queue().insert(RaidQueue {
        identity: ctx.sender,
        player_class: player.player_class.clone(),
        queued_at,
    });

    // Start matchmaking scheduler if not running
    if ctx.db.matchmaking_tick_schedule().iter().count() == 0 {
        schedule_matchmaking_tick(ctx);
    }

    log::info!("Player {:?} ({}) queued for raid", ctx.sender, player.player_class);
    Ok(())
}

/// Cancel queue (both dungeon and raid)
#[reducer]
pub fn cancel_queue(ctx: &ReducerContext) -> Result<(), String> {
    if ctx.db.dungeon_queue().identity().find(ctx.sender).is_some() {
        ctx.db.dungeon_queue().identity().delete(ctx.sender);
    }
    if ctx.db.raid_queue().identity().find(ctx.sender).is_some() {
        ctx.db.raid_queue().identity().delete(ctx.sender);
    }
    log::info!("Player {:?} cancelled queue", ctx.sender);
    Ok(())
}

/// Matchmaking tick - runs every second
#[reducer]
pub fn tick_matchmaking(ctx: &ReducerContext, _arg: MatchmakingTickSchedule) {
    let now = ctx.timestamp.to_duration_since_unix_epoch()
        .unwrap_or_default().as_millis() as u64;

    // Process dungeon queues
    process_dungeon_queues(ctx, now);

    // Process raid queues
    process_raid_queues(ctx, now);

    // Note: ScheduleAt::Interval auto-repeats
}

/// Open World tick - handles enemy AI and respawns
#[reducer]
pub fn tick_open_world(ctx: &ReducerContext, _arg: OpenWorldTickSchedule) {
    let now = ctx.timestamp.to_duration_since_unix_epoch()
        .unwrap_or_default().as_millis() as u64;
    let dt = AI_DT; // 50ms tick interval, same as dungeon enemies

    // Collect all open world players for AI targeting
    let players: Vec<OpenWorldPlayer> = ctx.db.open_world_player().iter().collect();

    // Process alive enemies - chase and attack players
    for enemy in ctx.db.open_world_enemy().iter() {
        if !enemy.is_alive {
            continue;
        }

        let mut e = enemy.clone();

        // Update state timer (attack cooldown)
        if e.state_timer > 0.0 {
            e.state_timer -= dt;
        }

        // Find nearest player in the same room
        let target = players.iter()
            .filter(|p| p.instance_id == e.instance_id && p.room_x == e.room_x && p.room_y == e.room_y)
            .min_by(|a, b| {
                let da = (a.x - e.x).powi(2) + (a.y - e.y).powi(2);
                let db = (b.x - e.x).powi(2) + (b.y - e.y).powi(2);
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            });

        if let Some(target) = target {
            let dx = target.x - e.x;
            let dy = target.y - e.y;
            let dist = (dx * dx + dy * dy).sqrt();
            let (nx, ny) = if dist > 0.1 { (dx / dist, dy / dist) } else { (0.0, 0.0) };

            // Update facing angle toward target
            e.facing_angle = ny.atan2(nx);

            // Use same speed calculation as dungeon enemies
            let speed = get_enemy_speed(&e.enemy_type) * dt * 60.0;

            // Chase if not in attack range (use same range as dungeon)
            if dist > ENEMY_ATTACK_RANGE {
                e.x += nx * speed;
                e.y += ny * speed;
                // Clamp to room bounds
                e.x = e.x.clamp(20.0, ROOM_W - 20.0);
                e.y = e.y.clamp(20.0, ROOM_H - 20.0);
                e.target_x = target.x;
                e.target_y = target.y;
                e.ai_state = "chase".to_string();
            } else {
                // In attack range - deal damage if cooldown ready
                if e.state_timer <= 0.0 {
                    e.state_timer = 1.2; // Attack cooldown
                    e.ai_state = "attack".to_string();

                    // Deal damage to player
                    if let Some(player) = ctx.db.player().identity().find(target.identity) {
                        let damage = (e.atk - player.def / 2).max(1);
                        let new_hp = player.hp - damage;
                        ctx.db.player().identity().update(Player {
                            hp: new_hp.max(0),
                            ..player
                        });
                    }
                }
            }

            ctx.db.open_world_enemy().id().update(e);
        }
    }

    // Respawn dead enemies whose timer has expired
    let dead_enemies: Vec<OpenWorldEnemy> = ctx.db.open_world_enemy().iter()
        .filter(|e| !e.is_alive && e.respawn_at > 0 && e.respawn_at <= now)
        .collect();

    for enemy in dead_enemies {
        // Get appropriate level for the room
        let level = get_enemy_level_for_room(enemy.room_x, enemy.room_y);
        let (hp, atk) = get_enemy_stats(&enemy.enemy_type, level);

        ctx.db.open_world_enemy().id().update(OpenWorldEnemy {
            hp,
            max_hp: hp,
            atk,
            is_alive: true,
            respawn_at: 0,
            ai_state: "chase".to_string(),
            state_timer: 0.0,
            ..enemy
        });
    }
}

// ─── Game Mode Helper Functions ─────────────────────────────────────────────────

fn schedule_matchmaking_tick(ctx: &ReducerContext) {
    ctx.db.matchmaking_tick_schedule().insert(MatchmakingTickSchedule {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(TimeDuration::from_micros(1_000_000)), // 1 second
    });
}

fn schedule_open_world_tick(ctx: &ReducerContext) {
    ctx.db.open_world_tick_schedule().insert(OpenWorldTickSchedule {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(TimeDuration::from_micros(50_000)), // 50ms = 20Hz for smooth enemy AI
    });
}

fn get_enemy_level_for_room(room_x: i32, room_y: i32) -> u32 {
    // Center (5,5) is level 1-5
    // Mid-ring is level 6-15
    // Outer ring is level 16+
    let center = OPEN_WORLD_SIZE / 2;
    let dist_from_center = ((room_x - center).abs().max((room_y - center).abs())) as u32;

    match dist_from_center {
        0 | 1 => 1 + dist_from_center,  // Center: 1-2
        2 => 5,  // Near center: 5
        3 => 10, // Mid: 10
        4 => 15, // Outer mid: 15
        _ => 20, // Edge: 20
    }
}

fn is_hotspot_room(room_x: i32, room_y: i32) -> bool {
    // Hotspots at cardinal directions from center
    let center = OPEN_WORLD_SIZE / 2;
    (room_x == center && (room_y == 1 || room_y == OPEN_WORLD_SIZE - 2)) ||
    (room_y == center && (room_x == 1 || room_x == OPEN_WORLD_SIZE - 2))
}

fn get_enemy_type_for_zone(level: u32) -> String {
    match level {
        1..=5 => ["slime", "bat", "skeleton"][level as usize % 3].to_string(),
        6..=10 => ["skeleton", "archer", "wolf"][level as usize % 3].to_string(),
        11..=15 => ["charger", "bomber", "shield_knight"][level as usize % 3].to_string(),
        _ => ["necromancer", "charger", "shield_knight"][level as usize % 3].to_string(),
    }
}

fn spawn_open_world_enemies(ctx: &ReducerContext, instance_id: u64) {
    for rx in 0..OPEN_WORLD_SIZE {
        for ry in 0..OPEN_WORLD_SIZE {
            // Skip town center (no enemies)
            if rx == OPEN_WORLD_SIZE / 2 && ry == OPEN_WORLD_SIZE / 2 {
                continue;
            }

            let level = get_enemy_level_for_room(rx, ry);
            let num_spawns = if is_hotspot_room(rx, ry) { 12 } else { 8 };

            for spawn_idx in 0..num_spawns {
                let enemy_type = get_enemy_type_for_zone(level);
                let (hp, atk) = get_enemy_stats(&enemy_type, level);

                // Distribute spawn points around the room
                let angle = (spawn_idx as f32 / num_spawns as f32) * std::f32::consts::TAU;
                let radius = 150.0 + (spawn_idx as f32 * 17.0) % 80.0;
                let x = ROOM_W / 2.0 + angle.cos() * radius;
                let y = ROOM_H / 2.0 + angle.sin() * radius;

                ctx.db.open_world_enemy().insert(OpenWorldEnemy {
                    id: 0,
                    instance_id,
                    room_x: rx,
                    room_y: ry,
                    spawn_point_idx: spawn_idx,
                    enemy_type,
                    hp,
                    max_hp: hp,
                    atk,
                    x,
                    y,
                    is_alive: true,
                    respawn_at: 0,
                    ai_state: "chase".to_string(),
                    state_timer: 0.0,
                    target_x: x,
                    target_y: y,
                    facing_angle: angle,
                });
            }
        }
    }
}

fn cleanup_open_world_instance(ctx: &ReducerContext, instance_id: u64) {
    // Delete all enemies
    let enemies: Vec<u64> = ctx.db.open_world_enemy().iter()
        .filter(|e| e.instance_id == instance_id)
        .map(|e| e.id)
        .collect();
    for id in enemies {
        ctx.db.open_world_enemy().id().delete(id);
    }

    // Delete instance
    ctx.db.open_world_instance().id().delete(instance_id);
}

fn spawn_enemies_for_tier(ctx: &ReducerContext, dungeon_id: u64, tier: u32, stat_mult: f32, _seed: u64) {
    // Tier 1: slimes, skeletons (Training Grounds)
    // Tier 2: archers, chargers, shield_knight (Tactical Chamber)
    // Tier 3: wolves, necromancer, bomber (The Gauntlet)
    let enemy_types: Vec<&str> = match tier {
        1 => vec!["slime", "slime", "skeleton", "bat"],
        2 => vec!["archer", "charger", "skeleton", "shield_knight"],
        3 => vec!["wolf", "wolf", "necromancer", "bomber"],
        _ => vec!["slime", "skeleton"],
    };

    for (i, et) in enemy_types.iter().enumerate() {
        let (base_hp, base_atk) = get_enemy_stats(et, tier);
        let hp = (base_hp as f32 * stat_mult) as i32;
        let atk = (base_atk as f32 * stat_mult) as i32;

        let angle = (i as f32 / enemy_types.len() as f32) * std::f32::consts::TAU;
        let radius = 150.0 + (i as f32 * 20.0);
        let x = ROOM_W / 2.0 + angle.cos() * radius;
        let y = ROOM_H / 2.0 + angle.sin() * radius;

        let (initial_state, pack_id) = match *et {
            "charger" => ("idle".to_string(), None),
            "wolf" => ("orbit".to_string(), Some(dungeon_id)),
            "bomber" => ("chase".to_string(), None),
            "necromancer" => ("flee".to_string(), None),
            "shield_knight" => ("advance".to_string(), None),
            "archer" => ("kite".to_string(), None),
            _ => ("chase".to_string(), None),
        };

        ctx.db.dungeon_enemy().insert(DungeonEnemy {
            id: 0,
            dungeon_id,
            room_index: 0,
            enemy_type: et.to_string(),
            x,
            y,
            hp,
            max_hp: hp,
            atk,
            is_alive: true,
            ai_state: initial_state,
            state_timer: 0.0,
            target_x: x,
            target_y: y,
            facing_angle: angle,
            pack_id,
            current_target: None,
            is_taunted: false,
            taunted_by: None,
            taunt_timer: 0.0,
            is_boss: false,
            boss_phase: 0,
        });
    }
}

fn process_dungeon_queues(ctx: &ReducerContext, now: u64) {
    // Group queued players by tier+difficulty
    let queued: Vec<DungeonQueue> = ctx.db.dungeon_queue().iter().collect();

    // Group by tier and difficulty
    let mut groups: std::collections::HashMap<(u32, u32), Vec<DungeonQueue>> = std::collections::HashMap::new();
    for q in queued {
        groups.entry((q.dungeon_tier, q.difficulty))
            .or_insert_with(Vec::new)
            .push(q);
    }

    for ((tier, difficulty), players) in groups {
        // Check if any player has been waiting 30+ seconds
        let timeout_threshold = 30000; // 30 seconds
        let should_start = players.len() >= 2 ||
            players.iter().any(|p| now - p.queued_at >= timeout_threshold);

        if should_start && !players.is_empty() {
            // Start dungeon with all queued players
            let seed = now;
            let stat_mult = 1.0 + (difficulty.saturating_sub(1) as f32 * 0.15);

            let dungeon = ctx.db.active_dungeon().insert(ActiveDungeon {
                id: 0,
                owner_identity: players[0].identity,
                depth: tier,
                current_room: 0,
                total_rooms: 1,
                seed,
            });

            // Add all players as participants
            for p in &players {
                ctx.db.dungeon_participant().insert(DungeonParticipant {
                    id: 0,
                    dungeon_id: dungeon.id,
                    player_identity: p.identity,
                });

                // Initialize position
                if let Some(player) = ctx.db.player().identity().find(p.identity) {
                    ctx.db.player_position().insert(PlayerPosition {
                        identity: p.identity,
                        dungeon_id: dungeon.id,
                        x: 270.0,
                        y: 360.0,
                        facing_x: 0.0,
                        facing_y: -1.0,
                        name: player.name.clone(),
                        level: player.level,
                        player_class: player.player_class.clone(),
                        weapon_icon: String::new(),
                        armor_icon: String::new(),
                        accessory_icon: String::new(),
                    });
                }

                // Remove from queue
                ctx.db.dungeon_queue().identity().delete(p.identity);

                // Update game mode
                if let Some(gm) = ctx.db.player_game_mode().identity().find(p.identity) {
                    ctx.db.player_game_mode().identity().update(PlayerGameMode {
                        mode: "dungeon".to_string(),
                        instance_id: Some(dungeon.id),
                        ..gm
                    });
                }
            }

            // Spawn enemies with loot bonus for party size
            let loot_bonus = 1.0 + (players.len() as f32 - 1.0) * 0.1; // +10% per extra player
            spawn_enemies_for_tier(ctx, dungeon.id, tier, stat_mult * loot_bonus, seed);

            // Start enemy AI tick
            if ctx.db.enemy_tick_schedule().iter().count() == 0 {
                schedule_enemy_tick(ctx);
            }

            log::info!("Started co-op dungeon tier {} with {} players", tier, players.len());
        }
    }
}

fn process_raid_queues(ctx: &ReducerContext, now: u64) {
    // Need exactly: 1 tank, 1 healer, 2 dps
    let tanks: Vec<RaidQueue> = ctx.db.raid_queue().iter()
        .filter(|q| q.player_class == "tank")
        .collect();
    let healers: Vec<RaidQueue> = ctx.db.raid_queue().iter()
        .filter(|q| q.player_class == "healer")
        .collect();
    let dps: Vec<RaidQueue> = ctx.db.raid_queue().iter()
        .filter(|q| q.player_class == "dps")
        .collect();

    if tanks.len() >= 1 && healers.len() >= 1 && dps.len() >= 2 {
        // Form raid party
        let party = vec![
            tanks[0].identity,
            healers[0].identity,
            dps[0].identity,
            dps[1].identity,
        ];

        // Create raid instance
        let (boss_hp, _boss_atk) = get_enemy_stats("raid_boss", 1);
        let raid = ctx.db.raid_instance().insert(RaidInstance {
            id: 0,
            started_at: now,
            boss_hp,
            boss_max_hp: boss_hp,
            boss_phase: 1,
            wipe_count: 0,
        });

        // Add participants
        for pid in &party {
            if let Some(player) = ctx.db.player().identity().find(*pid) {
                ctx.db.raid_participant().insert(RaidParticipant {
                    id: 0,
                    raid_id: raid.id,
                    player_identity: *pid,
                    player_class: player.player_class.clone(),
                    disconnected_at: None,
                });

                // Remove from queue
                ctx.db.raid_queue().identity().delete(*pid);

                // Update game mode
                if let Some(gm) = ctx.db.player_game_mode().identity().find(*pid) {
                    ctx.db.player_game_mode().identity().update(PlayerGameMode {
                        mode: "raid".to_string(),
                        instance_id: Some(raid.id),
                        ..gm
                    });
                }
            }
        }

        log::info!("Started raid with party of 4");
    }
}
