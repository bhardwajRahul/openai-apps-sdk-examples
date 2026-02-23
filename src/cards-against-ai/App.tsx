import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps/react";
import { PlayArea } from "./PlayArea";
import { SplashScreen } from "./SplashScreen";
import { getApiBaseUrl } from "./api-base-url";
import type { GameState } from "./types";

/**
 * Owns ALL game state and actions. Two data channels feed state updates:
 * 1. `ontoolresult` — fires on every tool response (bug fix: now updates gameState)
 * 2. SSE — server pushes full gameState on every change
 *
 * Both channels call `updateGameState`, which sets state AND clears pending
 * UI flags in a single synchronous batch — no useEffect needed.
 */
function useCardsAgainstAIGame() {
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [pendingPlayCardId, setPendingPlayCardId] = useState<string | null>(null);
  const [pendingJudge, setPendingJudge] = useState(false);
  const pendingActionRef = useRef(false);

  // Sets gameState and clears pending UI states in one batch.
  const updateGameState = useCallback((state: GameState) => {
    setGameState(state);
    setPendingPlayCardId(null);
    setPendingJudge(false);
  }, []);

  const onAppCreated = useCallback((app: McpApp) => {
    app.ontoolresult = (params) => {
      const sc = params.structuredContent as
        | { gameId?: string; gameState?: GameState }
        | undefined;
      if (sc?.gameId) setGameId(sc.gameId);
      if (sc?.gameState) updateGameState(sc.gameState);
    };
  }, [updateGameState]);

  const { app } = useApp({
    appInfo: { name: "cards-against-ai", version: "1.0.0" },
    capabilities: {},
    onAppCreated,
  });

  // SSE — server pushes full gameState on every change.
  useEffect(() => {
    if (!gameId) return;

    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      // Close previous EventSource before opening a new one
      es?.close();
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }

      const baseUrl = getApiBaseUrl();
      const url = `${baseUrl}/mcp/game/${gameId}/state-stream`;
      es = new EventSource(url);

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { gameState?: GameState };
          if (data.gameState) {
            updateGameState(data.gameState);
          }
        } catch {
          console.warn("[cards-ai] SSE message parse error", event.data);
        }
      };

      es.onerror = () => {
        console.error("[cards-ai] SSE connection error (reconnecting...)");
        // Close to disable browser auto-reconnect
        es?.close();
        es = null;
        if (cancelled) return;
        reconnectTimeout = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      cancelled = true;
      es?.close();
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [gameId, updateGameState]);

  // --- Game actions ---

  const callToolAndNotify = useCallback(
    async (
      toolName: string,
      args: Record<string, unknown>,
      humanActionSummary: string,
    ) => {
      if (!app) return;
      const result = await app.callServerTool({
        name: toolName,
        arguments: args,
      });
      const sc = result?.structuredContent as
        | { nextAction?: { notifyModel?: boolean; description?: string } | null; cpuContext?: unknown }
        | undefined;

      if (sc?.nextAction?.notifyModel) {
        const cpuContextStr = sc.cpuContext
          ? `\n\nCPU Context:\n${JSON.stringify(sc.cpuContext, null, 2)}`
          : "";
        await app.sendMessage({
          role: "user",
          content: [{
            type: "text",
            text: `${humanActionSummary}\n\n${sc.nextAction.description}${cpuContextStr}`,
          }],
        });
      }
    },
    [app],
  );

  const playCard = useCallback(
    async (cardId: string, playerId: string) => {
      if (pendingActionRef.current || !app || !gameId) return;
      pendingActionRef.current = true;
      setPendingPlayCardId(cardId);
      try {
        await callToolAndNotify(
          "play-answer-card",
          { gameId, playerId, cardId },
          `I played answer card ${cardId}.`,
        );
      } catch (err) {
        console.error("[cards-ai] playCard failed", err);
        setPendingPlayCardId(null);
      } finally {
        pendingActionRef.current = false;
      }
    },
    [app, gameId, callToolAndNotify],
  );

  const judgeCard = useCallback(
    async (winningCardId: string, judgeId: string) => {
      if (pendingActionRef.current || !app || !gameId) return;
      pendingActionRef.current = true;
      setPendingJudge(true);
      try {
        await callToolAndNotify(
          "judge-answer-card",
          { gameId, playerId: judgeId, winningCardId },
          `I judged card ${winningCardId} as the winner.`,
        );
      } catch (err) {
        console.error("[cards-ai] judgeCard failed", err);
        setPendingJudge(false);
      } finally {
        pendingActionRef.current = false;
      }
    },
    [app, gameId, callToolAndNotify],
  );

  const nextRound = useCallback(async () => {
    if (pendingActionRef.current || !app || !gameId) return;
    pendingActionRef.current = true;
    try {
      await app.sendMessage({
        role: "user",
        content: [{
          type: "text",
          text: `I'm ready for the next round. Call the submit-prompt tool for gameId="${gameId}" with a new prompt and replacement answer cards.`,
        }],
      });
    } catch (err) {
      console.error("[cards-ai] nextRound failed", err);
    } finally {
      pendingActionRef.current = false;
    }
  }, [app, gameId]);

  return {
    gameState, app,
    playCard, judgeCard, nextRound,
    pendingPlayCardId, pendingJudge,
  } as const;
}

export default function App() {
  const {
    gameState, app,
    playCard, judgeCard, nextRound,
    pendingPlayCardId, pendingJudge,
  } = useCardsAgainstAIGame();
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
      gameState={gameState}
      playCard={playCard}
      judgeCard={judgeCard}
      nextRound={nextRound}
      pendingPlayCardId={pendingPlayCardId}
      pendingJudge={pendingJudge}
    />
  );
}
