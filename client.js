// client.js - SpacetimeDB client wrapper
// Will connect to server and sync state
// For now, just exports stub functions that the game will call

const SpacetimeClient = {
  connected: false,
  async connect(host, dbName) { /* TODO */ },
  async register(name) { /* TODO */ },
  async startDungeon() { /* TODO */ },
  sendPosition(x, y, fx, fy) { /* TODO */ },
  sendAttack(enemyId) { /* TODO */ },
  sendDash(dx, dy) { /* TODO */ },
  async pickupLoot(lootId) { /* TODO */ },
  onEnemyUpdate: null, // callback
  onLootDrop: null, // callback
  onPlayerUpdate: null, // callback
};

export default SpacetimeClient;
