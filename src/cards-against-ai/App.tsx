import { useCallback, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps/react";
import { PlayArea } from "./PlayArea";
import { SplashScreen } from "./SplashScreen";
import { getApiBaseUrl } from "./api-base-url";
import type { GameState } from "./types";

function useCardsAgainstAIGame() {
  const [gameId, setGameId] = useState<string | null>(null);

  const onAppCreated = useCallback((app: McpApp) => {
    // ontoolresult: only used to extract gameId from start-game
    app.ontoolresult = (params) => {
      const sc = params.structuredContent as
        | { gameId?: string }
        | undefined;
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

  const gameState = useStreamingGameState(gameId);

  return { gameState, gameId, app } as const;
}

function useStreamingGameState(gameId: string | null) {
  const [gameState, setGameState] = useState<GameState | null>(null);

  // SSE: open EventSource when gameId is set
  useEffect(() => {
    if (!gameId) return;

    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      const baseUrl = getApiBaseUrl();
      const url = `${baseUrl}/mcp/game/${gameId}/state-stream`;
       es = new EventSource(url);
  
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { gameState?: GameState };
          if (data.gameState) {
            setGameState(data.gameState);
          }
        } catch {
          console.warn("[cards-ai] SSE message parse error", event.data);
        }
      };
  
      es.onerror = () => {
        console.error("[cards-ai] SSE connection error (reconnecting...)");
        if (cancelled) return;
        // Reconnect after 5 seconds
        reconnectTimeout = setTimeout(connect, 5000);
      };
    }

    // Initialize the connection
    connect();

    return () => {
      cancelled = true;
      es?.close();
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [gameId]);

  return gameState;
}

export default function App() {
  const { gameState, gameId, app } = useCardsAgainstAIGame();
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
    <PlayArea
      app={app}
      gameId={gameId}
      gameState={gameState}
    />
  );
}
