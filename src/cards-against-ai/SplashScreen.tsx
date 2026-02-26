import cardBackPattern from "./assets/card-back-pattern.png";
import { getAssetsBaseUrl } from "./api-base-url";
import type { GameStatus } from "./types";

const assetsBaseUrl = getAssetsBaseUrl();
const cardBackPatternUrl = assetsBaseUrl
  ? new URL(cardBackPattern, assetsBaseUrl).toString()
  : cardBackPattern;

interface SplashScreenProps {
  status: GameStatus;
  onStart: () => void;
}

export function SplashScreen({ status, onStart }: SplashScreenProps) {
  const isLoading = status === "initializing";

  return (
    <div className="relative flex h-full min-h-[280px] flex-col items-center justify-center gap-6 overflow-hidden px-6 py-8">
      {/* Background pattern decoration */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.06]"
        style={{
          backgroundImage: `url(${cardBackPatternUrl})`,
          backgroundSize: "200px",
          backgroundRepeat: "repeat",
        }}
      />

      {/* Title */}
      <div className="relative z-10 flex flex-col items-center gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
          Cards Against AI
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          A party game for horrible artificial intelligences
        </p>
      </div>

      {/* Loading bar or Start button */}
      <div className="relative z-10 flex flex-col items-center gap-3">
        {isLoading ? (
          <>
            <div className="h-1.5 w-48 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full w-full origin-left animate-pulse rounded-full bg-slate-400 dark:bg-slate-500 [animation-duration:1.5s]" />
            </div>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              Setting up the table...
            </span>
          </>
        ) : (
          <button
            type="button"
            onClick={onStart}
            className="rounded-lg border border-slate-300 bg-white px-6 py-2.5 text-sm font-semibold text-slate-900 shadow-md transition-all hover:bg-slate-100 hover:shadow-lg active:scale-95 dark:border-slate-400 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/20"
          >
            Start Game
          </button>
        )}
      </div>
    </div>
  );
}
