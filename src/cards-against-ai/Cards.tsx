import { useEffect, useState } from "react";
import { getAssetsBaseUrl } from "./api-base-url";
import cardBackPattern from "./assets/card-back-pattern.png";

/**
 * The width and height of a card in pixels.
 */
export const CARD_WIDTH = 138;
export const CARD_HEIGHT = 193;
/**
 * The position of the card in the dealer's hand. This is used
 * as an "offscreen" position for cards that are being dealt, or discarded.
 */
export const CARD_DEALER_SPOT = {
  x: -CARD_WIDTH,
  y: -CARD_HEIGHT,
  rotation: 0,
} as const;

const assetsBaseUrl = getAssetsBaseUrl();
const cardBackPatternUrl = assetsBaseUrl
  ? new URL(cardBackPattern, assetsBaseUrl).toString()
  : cardBackPattern;

export interface CardProps {
  x: number;
  y: number;
  rotation: number;
  faceUp: boolean;
  children: React.ReactNode;
}

const baseFaceClasses =
  "flex h-full w-full items-start rounded-2xl border border-black bg-white bg-gradient-to-b from-slate-50 to-white px-3 py-2.5 text-left text-black outline-none";

/**
 * A base card component that is used to get the general layout and positioning of a card.
 * The child components are displayed on the face of the card. All animations, flipping, etc,
 * are controlled with CSS transitions and/or keyframe animations.
 */
export function Card({ x, y, rotation, faceUp, children }: CardProps) {
  // All cards start in the dealer's hand.
  const [actualX, setActualX] = useState(CARD_DEALER_SPOT.x);
  const [actualY, setActualY] = useState(CARD_DEALER_SPOT.y);
  const [actualRotation, setActualRotation] = useState(0);
  const [actualFaceUp, setActualFaceUp] = useState(false);

  useEffect(() => {
    // After render, we need to update the actual positions of the card so that the animation can start.
    const id = requestAnimationFrame(() => {
      setActualX(x);
      setActualY(y);
      setActualRotation(rotation);
      setActualFaceUp(faceUp);
    });
    return () => cancelAnimationFrame(id);
  }, [x, y, rotation, faceUp]);

  return (
    <div
      className="absolute left-0 top-0 text-sm font-semibold hover:z-10 focus-within:z-10 [perspective:1200px] [transform-style:preserve-3d] [transition:transform_600ms_cubic-bezier(0.24,0.96,0.38,1)]"
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        transform: `translate3d(${actualX}px, ${actualY}px, 0px) rotate(${actualRotation}deg)`,
      }}
    >
      {/* Card inner (flip) */}
      <div
        className="relative h-full w-full [transform-style:preserve-3d] [transition:transform_300ms_ease]"
        style={{ transform: `rotateY(${actualFaceUp ? "0deg" : "180deg"})` }}
      >
        {/* Front face */}
        <div className="absolute inset-0 [backface-visibility:hidden]">
          <div className="h-full w-full rounded-2xl [transform-style:preserve-3d] shadow-[0_12px_30px_-10px_rgba(15,23,42,0.55)]">
            {children}
          </div>
        </div>
        {/* Back face */}
        <div className="pointer-events-none absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <div
            className="h-full w-full rounded-2xl border border-white bg-center bg-cover shadow-[0_12px_30px_-10px_rgba(15,23,42,0.55)]"
            style={{ backgroundImage: `url(${cardBackPatternUrl})` }}
          />
        </div>
      </div>
    </div>
  );
}

export interface AnswerCardProps extends Omit<CardProps, "children"> {
  /**
   * The answer text to display on the card.
   */
  text: string;
  /**
   * The card ID, required when interactive is true.
   */
  cardId?: string;
  /**
   * Whether the card is interactive. If true, the card will be clickable
   */
  interactive?: boolean;
  /**
   * The function to call when the card is clicked.
   * Only works if interactive is true.
   */
  onClick?: (event: { cardId: string }) => void;
  /**
   * Whether the card should be visually highlighted (e.g. winning card).
   */
  highlighted?: boolean;
}

/**
 * An answer card that is used to display answer text to the players,
 * as well as to allow the player to interact with the card (if interactive is true).
 */
export function AnswerCard({
  x,
  y,
  rotation,
  faceUp,
  interactive,
  cardId,
  text,
  onClick,
  highlighted,
}: AnswerCardProps) {
  const highlightClass = highlighted
    ? " scale-105 [animation:cards-ai-winner-glow_1.8s_ease-in-out_infinite]"
    : "";
  const highlightStyle: React.CSSProperties | undefined = highlighted
    ? { borderColor: "transparent" }
    : undefined;
  return (
    <Card x={x} y={y} rotation={rotation} faceUp={faceUp}>
      {interactive ? (
        <button
          type="button"
          className={`${baseFaceClasses} cursor-pointer hover:ring-2 hover:ring-blue-400${highlightClass}`}
          style={highlightStyle}
          onClick={() => onClick?.({ cardId: cardId! })}
        >
          {text}
        </button>
      ) : (
        <div
          className={`${baseFaceClasses} cursor-default${highlightClass}`}
          style={highlightStyle}
        >
          {text}
        </div>
      )}
    </Card>
  );
}

export interface PromptCardProps extends Omit<CardProps, "children"> {
  /**
   * The prompt text to display.
   */
  text: string;
  children?: React.ReactNode;
}

/**
 * A prompt card that is used to display promp text to the players.
 */
export function PromptCard({
  x,
  y,
  rotation,
  faceUp,
  text,
  children,
}: PromptCardProps) {
  return (
    <Card x={x} y={y} rotation={rotation} faceUp={faceUp}>
      <div className={`${baseFaceClasses} invert`}>
        {text}
        {children}
      </div>
    </Card>
  );
}
