import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps/react";
import { PlayArea } from "./PlayArea";
import { SplashScreen } from "./SplashScreen";
import type { GameState } from "./types";

/** Widget-side timeout for watch-game-state calls (above the server's 45s hold). */
const WATCH_TOOL_TIMEOUT_MS = 55_000;

/**
 * Runs a continuous long-poll loop for game state changes.
 * Returns a `sendGameMessage` helper that safely pauses the watch loop
 * before calling `app.sendMessage()` — preventing concurrent MCP bridge
 * operations that can corrupt ChatGPT's internal message tree.
 */
function useWatchGameState(
  app: McpApp | null,
  gameId: string | null,
  gameState: GameState | null,
  setGameState: Dispatch<SetStateAction<GameState | null>>,
) {
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;
  const appRef = useRef(app);
  appRef.current = app;
  const gameIdRef = useRef(gameId);
  gameIdRef.current = gameId;
  const watchAbortRef = useRef<AbortController | null>(null);

  // Imperatively (re)starts the watch loop. Reads app/gameId/gameState
  // from refs so the function identity is stable across renders.
  const startWatchLoop = useCallback(() => {
    watchAbortRef.current?.abort();
    watchAbortRef.current = null;

    const currentApp = appRef.current;
    const currentGameId = gameIdRef.current;
    if (!currentApp || !gameStateRef.current || !currentGameId) return;

    const abort = new AbortController();
    watchAbortRef.current = abort;
    const { signal } = abort;

    (async () => {
      let knownStatus = gameStateRef.current?.status ?? "";

      while (!signal.aborted) {
        try {
          const result = await currentApp.callServerTool(
            {
              name: "watch-game-state",
              arguments: { gameId: currentGameId, knownStatus },
            },
            { timeout: WATCH_TOOL_TIMEOUT_MS },
          );

          if (signal.aborted) return;

          const sc = result?.structuredContent as
            | { type?: string; gameState?: GameState }
            | undefined;
          if (!sc) continue;

          if (sc.type === "timeout") {
            continue;
          }

          if (sc.gameState) {
            setGameState(sc.gameState);
            knownStatus = sc.gameState.status;

            if (knownStatus === "announce-winner" || knownStatus === "game-ended") {
              return;
            }
            continue;
          }

          return; // Unexpected shape — stop polling
        } catch (err) {
          if (signal.aborted) return;
          console.warn("[cards-ai] watch-game-state failed, retrying", err);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();
  }, [setGameState]);

  // Start the loop when key inputs become available; clean up on unmount.
  useEffect(() => {
    if (!app || !gameState || !gameId) return;

    startWatchLoop();

    return () => {
      watchAbortRef.current?.abort();
      watchAbortRef.current = null;
    };
  }, [app, !!gameState, gameId, startWatchLoop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Abort the watch loop before sending a message, then restart it after.
  // This prevents concurrent MCP bridge operations.
  const sendGameMessage = useCallback(
    async (text: string) => {
      const currentApp = appRef.current;
      if (!currentApp) return;
      watchAbortRef.current?.abort();
      try {
        await currentApp.sendMessage({
          role: "user",
          content: [{ type: "text", text }],
        });
      } finally {
        startWatchLoop();
      }
    },
    [startWatchLoop],
  );

  return sendGameMessage;
}

function useCardsAgainstAIGame() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);

  const onAppCreated = useCallback((app: McpApp) => {
    app.ontoolresult = (params) => {
      const sc = params.structuredContent as
        | { gameState?: GameState; gameId?: string }
        | undefined;
      if (sc?.gameState) {
        setGameState(sc.gameState);
      }
      if (sc?.gameId) {
        setGameId(sc.gameId);
      }
    };
  }, []);

  const { app } = useApp({
    appInfo: { name: "cards-against-ai", version: "1.0.0" },
    capabilities: {},
    onAppCreated,
  });

  const sendGameMessage = useWatchGameState(app, gameId, gameState, setGameState);

  return { gameState, gameId, app, sendGameMessage } as const;
}

export default function App() {
  const { gameState, gameId, app, sendGameMessage } = useCardsAgainstAIGame();
  const [pipStarted, setPipStarted] = useState(false);

  if (!pipStarted) {
    return (
      <SplashScreen
        status={gameState?.status ?? "initializing"}
        onStart={() => {
          app?.requestDisplayMode({ mode: "pip" });
          setPipStarted(true);
        }}
      />
    );
  }

  if (!gameState) {
    return <div>Loading...</div>;
  }

  return (
  <PlayArea gameId={gameId} gameState={gameState} sendGameMessage={sendGameMessage} />
  );
}
