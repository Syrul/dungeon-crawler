// main.ts — Entry point
// Tries SpacetimeDB connection, falls back to offline mode

import { initGame, setGameMode, setCallbacks } from './game';
import { spacetimeClient } from './spacetime';

const statusDot = document.getElementById('connection-status');

function setStatusDot(connected: boolean) {
  if (statusDot) {
    statusDot.style.background = connected ? '#22c55e' : '#ef4444';
  }
}

async function main() {
  // Try connecting to SpacetimeDB
  console.log('[Main] Attempting SpacetimeDB connection...');
  const connected = await spacetimeClient.connect();

  if (connected) {
    console.log('[Main] Online mode — SpacetimeDB connected');
    setGameMode('online');
    setStatusDot(true);

    // Set up callbacks for online mode (position sync etc.)
    // For now just basic position updates — combat sync is next step
    setCallbacks({
      onPlayerMove: (x, y, facingX, facingY) => {
        // TODO: send position to server when dungeon is active
        // spacetimeClient.updatePosition(dungeonId, x, y, facingX, facingY);
      },
    });

    // Listen for connection state changes
    spacetimeClient.onChange((state) => {
      setStatusDot(state.connected);
      if (!state.connected) {
        console.log('[Main] Lost connection, falling back to offline');
        setGameMode('offline');
      }
    });

    // Try login
    try {
      spacetimeClient.login();
    } catch (e) {
      console.warn('[Main] Login failed, may need to register first');
    }
  } else {
    console.log('[Main] Offline mode — SpacetimeDB not available');
    setGameMode('offline');
    setStatusDot(false);
  }

  // Start the game regardless
  initGame();
}

main();
