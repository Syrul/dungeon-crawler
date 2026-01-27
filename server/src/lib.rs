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
#[table(name = dungeon_enemy, public)]
pub struct DungeonEnemy {
    #[primary_key]
    #[auto_inc]
    id: u64,
    dungeon_id: u64,
    room_index: u32,
    enemy_type: String,
    x: f32,
    y: f32,
    hp: i32,
    max_hp: i32,
    atk: i32,
    is_alive: bool,
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

/// Scheduler table for enemy AI ticks
#[table(name = enemy_tick_schedule, scheduled(tick_enemies))]
pub struct EnemyTickSchedule {
    #[primary_key]
    #[auto_inc]
    scheduled_id: u64,
    scheduled_at: ScheduleAt,
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const ATTACK_RANGE: f32 = 60.0;
const ENEMY_ATTACK_RANGE: f32 = 40.0;
const ENEMY_MOVE_SPEED: f32 = 2.0;
const LOOT_PICKUP_RANGE: f32 = 50.0;
const BASE_XP_PER_LEVEL: u64 = 100;

// ─── Account Reducers ──────────────────────────────────────────────────────────

/// Register a new player account
#[reducer]
pub fn register_player(ctx: &ReducerContext, name: String) -> Result<(), String> {
    if name.is_empty() {
        return Err("Name must not be empty".into());
    }
    if ctx.db.player().identity().find(ctx.sender).is_some() {
        return Err("Player already registered".into());
    }
    ctx.db.player().insert(Player {
        identity: ctx.sender,
        name,
        level: 1,
        xp: 0,
        hp: 100,
        max_hp: 100,
        atk: 10,
        def: 5,
        speed: 5,
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

/// Start a new dungeon run. Generates the dungeon and spawns enemies for room 0.
#[reducer]
pub fn start_dungeon(ctx: &ReducerContext) -> Result<(), String> {
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;

    // Simple seed from timestamp
    let seed = ctx.timestamp.to_duration_since_unix_epoch()
        .unwrap_or_default().as_micros() as u64;
    let total_rooms = 5 + player.dungeons_cleared; // more rooms as you progress
    let depth = player.dungeons_cleared + 1;

    let dungeon = ctx.db.active_dungeon().insert(ActiveDungeon {
        id: 0, // auto_inc
        owner_identity: ctx.sender,
        depth,
        current_room: 0,
        total_rooms,
        seed,
    });

    // Spawn enemies for room 0
    spawn_enemies_for_room(ctx, dungeon.id, 0, depth, seed);

    // Initialize player position
    if let Some(pos) = ctx.db.player_position().identity().find(ctx.sender) {
        ctx.db.player_position().identity().update(PlayerPosition {
            dungeon_id: dungeon.id,
            x: 400.0,
            y: 300.0,
            facing_x: 1.0,
            facing_y: 0.0,
            ..pos
        });
    } else {
        ctx.db.player_position().insert(PlayerPosition {
            identity: ctx.sender,
            dungeon_id: dungeon.id,
            x: 400.0,
            y: 300.0,
            facing_x: 1.0,
            facing_y: 0.0,
        });
    }

    // Ensure the enemy AI tick is scheduled
    schedule_enemy_tick(ctx);

    log::info!("Dungeon started: id={}, depth={}, rooms={}", dungeon.id, depth, total_rooms);
    Ok(())
}

/// Enter a new room in the dungeon, spawning its enemies.
#[reducer]
pub fn enter_room(ctx: &ReducerContext, dungeon_id: u64, room_index: u32) -> Result<(), String> {
    let dungeon = ctx.db.active_dungeon().id().find(dungeon_id)
        .ok_or("Dungeon not found")?;
    if dungeon.owner_identity != ctx.sender {
        return Err("Not your dungeon".into());
    }
    if room_index >= dungeon.total_rooms {
        return Err("Room index out of bounds".into());
    }

    // Update current room
    ctx.db.active_dungeon().id().update(ActiveDungeon {
        current_room: room_index,
        ..dungeon
    });

    spawn_enemies_for_room(ctx, dungeon_id, room_index, dungeon.depth, dungeon.seed);

    // Reset player position for new room
    if let Some(pos) = ctx.db.player_position().identity().find(ctx.sender) {
        ctx.db.player_position().identity().update(PlayerPosition {
            x: 400.0,
            y: 300.0,
            ..pos
        });
    }

    log::info!("Entered room {} in dungeon {}", room_index, dungeon_id);
    Ok(())
}

/// Complete a dungeon. Award XP and gold, increment dungeons_cleared.
#[reducer]
pub fn complete_dungeon(ctx: &ReducerContext, dungeon_id: u64) -> Result<(), String> {
    let dungeon = ctx.db.active_dungeon().id().find(dungeon_id)
        .ok_or("Dungeon not found")?;
    if dungeon.owner_identity != ctx.sender {
        return Err("Not your dungeon".into());
    }

    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;

    let xp_reward = 50 * dungeon.depth as u64;
    let gold_reward = 20 * dungeon.depth as u64;
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
) -> Result<(), String> {
    if let Some(pos) = ctx.db.player_position().identity().find(ctx.sender) {
        ctx.db.player_position().identity().update(PlayerPosition {
            dungeon_id,
            x,
            y,
            facing_x,
            facing_y,
            ..pos
        });
    } else {
        ctx.db.player_position().insert(PlayerPosition {
            identity: ctx.sender,
            dungeon_id,
            x,
            y,
            facing_x,
            facing_y,
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

    let damage = player.atk.max(1);
    let new_hp = enemy.hp - damage;

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
        log::info!("Enemy {} killed in dungeon {}", target_enemy_id, dungeon_id);
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
    let pos = ctx.db.player_position().identity().find(ctx.sender)
        .ok_or("Position not found")?;

    let dash_distance = 150.0;
    let new_x = pos.x + dir_x * dash_distance;
    let new_y = pos.y + dir_y * dash_distance;

    ctx.db.player_position().identity().update(PlayerPosition {
        x: new_x,
        y: new_y,
        facing_x: dir_x,
        facing_y: dir_y,
        ..pos
    });

    log::info!("Player dashed in dungeon {}", dungeon_id);
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

// ─── Enemy AI Tick (Scheduled Reducer) ─────────────────────────────────────────

/// Scheduled reducer: ticks all alive enemies. Moves them toward players and attacks if in range.
#[reducer]
pub fn tick_enemies(ctx: &ReducerContext, _arg: EnemyTickSchedule) {
    // Collect all player positions
    let positions: Vec<PlayerPosition> = ctx.db.player_position().iter().collect();

    // Process each alive enemy
    for enemy in ctx.db.dungeon_enemy().iter() {
        if !enemy.is_alive {
            continue;
        }

        // Find nearest player in same dungeon
        let nearest = positions.iter()
            .filter(|p| p.dungeon_id == enemy.dungeon_id)
            .min_by(|a, b| {
                let da = (a.x - enemy.x).powi(2) + (a.y - enemy.y).powi(2);
                let db = (b.x - enemy.x).powi(2) + (b.y - enemy.y).powi(2);
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            });

        if let Some(target) = nearest {
            let dx = target.x - enemy.x;
            let dy = target.y - enemy.y;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist <= ENEMY_ATTACK_RANGE {
                // Attack the player
                if let Some(player) = ctx.db.player().identity().find(target.identity) {
                    let damage = (enemy.atk - player.def / 2).max(1);
                    let new_hp = player.hp - damage;
                    ctx.db.player().identity().update(Player {
                        hp: new_hp.max(0),
                        ..player
                    });
                }
            } else if dist > 0.1 {
                // Move toward player
                let move_speed = get_enemy_speed(&enemy.enemy_type);
                let nx = dx / dist;
                let ny = dy / dist;
                ctx.db.dungeon_enemy().id().update(DungeonEnemy {
                    x: enemy.x + nx * move_speed,
                    y: enemy.y + ny * move_speed,
                    ..enemy
                });
            }
        }
    }

    // Reschedule next tick
    schedule_enemy_tick(ctx);
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

/// Schedule the next enemy AI tick (100ms from now)
fn schedule_enemy_tick(ctx: &ReducerContext) {
    ctx.db.enemy_tick_schedule().insert(EnemyTickSchedule {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(TimeDuration::from_micros(100_000)),
    });
}

/// Spawn enemies for a given room
fn spawn_enemies_for_room(ctx: &ReducerContext, dungeon_id: u64, room_index: u32, depth: u32, seed: u64) {
    // Simple deterministic spawn based on seed + room
    let room_seed = seed.wrapping_add(room_index as u64 * 1337);
    let enemy_count = 3 + (depth / 2) as usize; // more enemies at deeper levels

    let enemy_types = ["skeleton", "slime", "charger", "necromancer", "bat"];

    for i in 0..enemy_count {
        let s = room_seed.wrapping_add(i as u64 * 7919);
        let et = enemy_types[(s as usize) % enemy_types.len()];
        let (hp, atk) = get_enemy_stats(et, depth);

        // Spread enemies around the room
        let angle = (i as f32 / enemy_count as f32) * std::f32::consts::TAU;
        let radius = 200.0 + (s % 100) as f32;
        let x = 400.0 + angle.cos() * radius;
        let y = 300.0 + angle.sin() * radius;

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
        });
    }
}

/// Get base stats for an enemy type, scaled by dungeon depth
fn get_enemy_stats(enemy_type: &str, depth: u32) -> (i32, i32) {
    let scale = 1.0 + (depth as f32 - 1.0) * 0.15;
    let (base_hp, base_atk) = match enemy_type {
        "skeleton" => (30, 8),
        "slime" => (20, 5),
        "charger" => (25, 12),
        "necromancer" => (40, 10),
        "bat" => (15, 6),
        _ => (20, 5),
    };
    ((base_hp as f32 * scale) as i32, (base_atk as f32 * scale) as i32)
}

/// Get movement speed for enemy type
fn get_enemy_speed(enemy_type: &str) -> f32 {
    match enemy_type {
        "charger" => ENEMY_MOVE_SPEED * 2.5, // chargers are fast
        "bat" => ENEMY_MOVE_SPEED * 1.5,
        "necromancer" => ENEMY_MOVE_SPEED * 0.5, // slow
        _ => ENEMY_MOVE_SPEED,
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
    let rarity = match enemy_type {
        "necromancer" => "rare",
        "charger" => "uncommon",
        _ => "common",
    };

    let item_json = format!(
        r#"{{"type":"drop","source":"{}","atk_bonus":{},"def_bonus":{}}}"#,
        enemy_type,
        atk / 2,
        max_hp / 10,
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
}
