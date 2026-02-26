import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps/react";
import { PlayArea } from "./PlayArea";
import { SplashScreen } from "./SplashScreen";
import { getApiBaseUrl } from "./api-base-url";
import type { GameState, NextActionHint } from "./types";

/**
 * Sends a message to the model, preferring `sendFollowUpMessage` (scrolls to
 * bottom) with a fallback to `app.sendMessage` for hosts that don't support window.openai
 */
async function sendFollowUp(
  app: McpApp,
  text: string,
): Promise<void> {
  const openai = window.openai;
  if (openai?.sendFollowUpMessage) {
    try {
      await openai.sendFollowUpMessage({ prompt: text, scrollToBottom: true });
      return;
    } catch (err) {
      console.warn("[cards-ai] sendFollowUpMessage failed, falling back to sendMessage", err);
    }
  }
  await app.sendMessage({
    role: "user",
    content: [{ type: "text", text }],
  });
}

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
  const [pendingNextRound, setPendingNextRound] = useState(false);
  const [lastNextAction, setLastNextAction] = useState<NextActionHint>(null);
  const pendingActionRef = useRef(false);

  // Sets gameState and clears pending UI states in one batch.
  const updateGameState = useCallback((state: GameState) => {
    setGameState(state);
    setPendingPlayCardId(null);
    setPendingJudge(false);
    setPendingNextRound(false);
    setLastNextAction(null);
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
          const data = JSON.parse(event.data) as {
            gameState?: GameState;
            nextAction?: NextActionHint;
          };
          if (data.gameState) {
            updateGameState(data.gameState);
          }
          if (data.nextAction) {
            setLastNextAction(data.nextAction);
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

  // Watchdog: if the model ignores a notifyModel hint, nudge it after 15s.
  useEffect(() => {
    if (!lastNextAction?.notifyModel || !app || !gameId) return;
    const staleStatus = gameState?.status;
    const timer = setTimeout(() => {
      // Only nudge if state hasn't progressed
      if (gameState?.status === staleStatus) {
        sendFollowUp(
          app,
          `[GAME ACTION REQUIRED] ${lastNextAction.description}\nThe game is waiting on you. Take the action above NOW.\nWrite a brief line of in-character dialog from a CPU player while you do it.`,
        );
        setLastNextAction(null);
      }
    }, 15_000);
    return () => clearTimeout(timer);
  }, [lastNextAction, gameState?.status, app, gameId]);

  // Safety net: auto-clear pendingNextRound if the model never calls submit-prompt.
  useEffect(() => {
    if (!pendingNextRound) return;
    const id = setTimeout(() => setPendingNextRound(false), 15_000);
    return () => clearTimeout(id);
  }, [pendingNextRound]);

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
        await sendFollowUp(
          app,
          `${humanActionSummary}\n\n${sc.nextAction.description}${cpuContextStr}\n\nStay in character. Write a brief quip or reaction from each CPU player as they take their action.`,
        );
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
    if (pendingActionRef.current || !app || !gameId || !gameState) return;
    pendingActionRef.current = true;
    setPendingNextRound(true);
    try {
      // Build context so the model knows exactly what submit-prompt needs.
      const judge = gameState.players[gameState.currentJudgePlayerIndex];
      const playersWhoPlayed = gameState.playedAnswerCards
        .map((p) => gameState.players.find((pl) => pl.id === p.playerId))
        .filter((p): p is NonNullable<typeof p> => p != null);
      const previousPrompts = gameState.discardedPromptCards.map((p) => p.text);

      const contextLines = [
        `The human clicked "Next Round". The game is in "${gameState.status}" state.`,
        `Call the submit-prompt tool NOW for gameId="${gameId}".`,
        "",
        `Judge this round: ${judge?.persona?.name ?? judge?.id} (${judge?.id})`,
        `Players who need a replacement answer card: ${playersWhoPlayed.map((p) => `${p.persona?.name ?? p.id} (${p.id})`).join(", ")}`,
        ...(previousPrompts.length > 0
          ? [`Previous prompts (do NOT repeat): ${previousPrompts.join("; ")}`]
          : []),
        "",
        `Add a line or two of between-round banter from the CPU players — reactions to last round, trash-talk, or hype for the next prompt.`,
      ];

      await sendFollowUp(app, contextLines.join("\n"));
    } catch (err) {
      console.error("[cards-ai] nextRound failed", err);
      setPendingNextRound(false);
    } finally {
      pendingActionRef.current = false;
    }
  }, [app, gameId, gameState]);

  return {
    gameState, app,
    playCard, judgeCard, nextRound,
    pendingPlayCardId, pendingJudge, pendingNextRound,
  } as const;
}

export default function App() {
  const {
    gameState, app,
    playCard, judgeCard, nextRound,
    pendingPlayCardId, pendingJudge, pendingNextRound,
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
      pendingNextRound={pendingNextRound}
    />
  );
}
