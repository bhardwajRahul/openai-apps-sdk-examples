import { useEffect, useMemo, useRef, useState } from "react";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  AnswerCard,
  PromptCard,
  CARD_DEALER_SPOT,
} from "./Cards";
import { Scoreboard } from "./Scoreboard";
import type { GameState } from "./types";

interface Bounds {
  width: number;
  height: number;
}

const CARD_HAND_ROTATION_STEP = 4;
const CARD_HAND_MAX_GAP = 60;
const CARD_PLAYED_GAP = 12;
const CARD_PROMPT_TOP_Y = 12;
const CARD_HAND_BOTTOM_PADDING = 12;
const ANSWER_CARDS_OFFSCREEN_POSITION_Y = CARD_HEIGHT + 10;

/**
 * Minimum container height: prompt row + played row + hand row + padding/gaps.
 * top-pad(12) + card(193) + gap(20) + card(193) + gap(20) + card(193) + bottom-pad(12)
 */
const MIN_PLAY_AREA_HEIGHT =
  CARD_PROMPT_TOP_Y + CARD_HEIGHT + 20 + CARD_HEIGHT + CARD_HAND_BOTTOM_PADDING;

// --- Component ---

export interface PlayAreaProps {
  gameState: GameState;
  playCard: (cardId: string, playerId: string) => void;
  judgeCard: (winningCardId: string, judgeId: string) => void;
  nextRound: () => void;
  pendingPlayCardId: string | null;
  pendingJudge: boolean;
  pendingNextRound: boolean;
}

/**
 * Responsible for displaying the game state.
 * Does the work of figuring out where to position the cards,
 * accounting for the status of the gameState, and making sure things
 * are displayed correctly.
 */
export function PlayArea(props: PlayAreaProps) {
  const {
    gameState,
    playCard, judgeCard, nextRound,
    pendingPlayCardId, pendingJudge, pendingNextRound,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const previousPromptRef = useRef<string | null>(null);
  const answerCardsInPlay = useMemo(() => new Set<string>(), []);

  // --- ResizeObserver for container bounds ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBounds((prev) =>
        prev && prev.width === width && prev.height === height
          ? prev
          : { width, height }
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- Build positioned card elements ---
  const localPlayerId = getLocalPlayerId(gameState);

  const positionedCards = useMemo<React.ReactNode[]>(() => {
    if (!bounds) return [];

    const answerCardsNotInPlay = new Set<string>(answerCardsInPlay);
    answerCardsInPlay.clear();

    const elements: React.ReactNode[] = [];

    // Add prompt card
    if (gameState.prompt) {
      const isNewlyAddedPromptCard =
        previousPromptRef.current !== gameState.prompt?.id;
      previousPromptRef.current = gameState.prompt?.id;

      if (isNewlyAddedPromptCard) {
        // The old card is going to the dealer's hand.
        elements.push(
          <PromptCard
            key={previousPromptRef.current}
            {...CARD_DEALER_SPOT}
            faceUp={false}
            text={""}
          />
        );
      }

      const position = {
        x: (bounds.width - CARD_WIDTH) / 2,
        y: CARD_PROMPT_TOP_Y,
        rotation: 0,
      };

      elements.push(
        <PromptCard
          key={gameState.prompt.id}
          {...position}
          faceUp={true}
          text={gameState.prompt.text}
        />
      );
    }

    const localPlayer = gameState.players.find((p) => p.id === localPlayerId);

    if (!localPlayer) throw new Error("Local player not found");

    const localPlayerIsJudge =
      localPlayer.id ===
      gameState.players[gameState.currentJudgePlayerIndex].id;
    const localPlayerHasPlayedACard =
      pendingPlayCardId !== null ||
      gameState.playedAnswerCards.some(
        (played) => played.playerId === localPlayer.id
      );

    // Add played answer cards
    if (gameState.playedAnswerCards.length > 0) {
      elements.push(
        ...gameState.playedAnswerCards.map((played, index) => {
          const playedCard = gameState.answerCards[played.cardId];

          if (playedCard) {
            answerCardsInPlay.add(played.cardId);
            answerCardsNotInPlay.delete(played.cardId);

            const position = {
              x:
                CARD_WIDTH * index +
                bounds.width / 2 -
                CARD_WIDTH * 1.5 -
                CARD_PLAYED_GAP +
                CARD_PLAYED_GAP * index,
              y: CARD_PROMPT_TOP_Y + CARD_HEIGHT + 20,
              rotation: 0,
            };

            return (
              <AnswerCard
                key={played.cardId}
                cardId={played.cardId}
                interactive={localPlayerIsJudge && !pendingJudge}
                highlighted={
                  gameState.judgementResult?.winningCardId === played.cardId &&
                  (gameState.status === "display-judgement" || gameState.status === "announce-winner")
                }
                onClick={({ cardId }) => judgeCard(cardId, localPlayer.id)}
                {...position}
                faceUp={true}
                text={playedCard.text}
              />
            );
          }
        })
      );
    }

    // Add cards in hand.
    for (let index = 0; index < localPlayer.answerCards.length; index++) {
      const cardId = localPlayer.answerCards[index];
      const card = gameState.answerCards[cardId];

      if (card) {
        answerCardsInPlay.add(cardId);
        answerCardsNotInPlay.delete(cardId);

        const isOffscreen = localPlayerIsJudge || localPlayerHasPlayedACard;
        const isInteractive = !localPlayerIsJudge && !localPlayerHasPlayedACard;

        const position = {
          x:
            (bounds.width -
              CARD_WIDTH -
              CARD_HAND_MAX_GAP * (localPlayer.answerCards.length - 1)) /
              2 +
            CARD_HAND_MAX_GAP * index,
          y:
            bounds.height -
            CARD_HAND_BOTTOM_PADDING -
            CARD_HEIGHT +
            (isOffscreen ? ANSWER_CARDS_OFFSCREEN_POSITION_Y : 0),
          rotation:
            (index - (localPlayer.answerCards.length - 1) / 2) *
            CARD_HAND_ROTATION_STEP,
        };

        elements.push(
          <AnswerCard
            key={cardId}
            cardId={cardId}
            interactive={isInteractive}
            onClick={({ cardId }) => playCard(cardId, localPlayer.id)}
            {...position}
            faceUp={true}
            text={card.text}
          />
        );
      }
    }

    for (const cardId of answerCardsNotInPlay) {
      // Move the answer cards not in play to the dealer's hand.
      const card = gameState.answerCards[cardId];
      if (card) {
        elements.push(
          <AnswerCard
            key={cardId}
            cardId={cardId}
            {...CARD_DEALER_SPOT}
            faceUp={false}
            text={card.text}
          />
        );
      }
    }

    return elements;
  }, [gameState, bounds, playCard, judgeCard, pendingPlayCardId, pendingJudge]);

  const { players, currentJudgePlayerIndex, status, winnerId } = gameState;

  // Find winner info for announce-winner overlay
  const winner =
    status === "announce-winner" && winnerId
      ? players.find((p) => p.id === winnerId)
      : null;

  return (
    <div
      ref={containerRef}
      className="relative w-screen overflow-hidden"
      style={{ minHeight: MIN_PLAY_AREA_HEIGHT }}
    >
      {positionedCards}
      <div className="absolute right-2 top-2 z-10">
        <Scoreboard
          players={players}
          currentJudgePlayerIndex={currentJudgePlayerIndex}
          localPlayerId={localPlayerId}
        />
      </div>
      {status === "display-judgement" && (
        pendingNextRound ? (
          <span className="absolute bottom-4 right-4 z-20 rounded-lg border border-white/40 bg-white/10 px-5 py-2.5 text-lg font-bold text-white/60 shadow-lg backdrop-blur-md">
            Waiting&hellip;
          </span>
        ) : (
          <button
            className="absolute bottom-4 right-4 z-20 rounded-lg border border-white/80 bg-white/15 px-5 py-2.5 text-lg font-bold text-white shadow-lg backdrop-blur-md transition-colors hover:bg-white/25 active:bg-white/35"
            onClick={nextRound}
          >
            Next Round &rarr;
          </button>
        )
      )}
      {winner && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-lg">
          <div
            className="cards-ai-winner-panel rounded-2xl border-2 border-amber-400/80 bg-slate-900/85 px-10 py-8 text-center shadow-2xl"
          >
            <h2
              className="text-5xl font-black text-white"
              style={{ textShadow: "0 0 20px rgba(251,191,36,0.7), 0 2px 4px rgba(0,0,0,0.5)" }}
            >
              {winner.persona?.name ?? "Player"} Wins!
            </h2>
            <p className="mt-3 text-lg font-semibold text-amber-300">
              {winner.wonPromptCards.length} point
              {winner.wonPromptCards.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function getLocalPlayerId(gameState: GameState): string | null {
  return gameState.players.find((p) => p.type === "human")?.id ?? null;
}
