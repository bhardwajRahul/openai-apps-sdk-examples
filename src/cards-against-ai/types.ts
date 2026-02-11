export interface AnswerCard {
  id: string;
  type: "answer";
  text: string;
}

export interface PromptCard {
  id: string;
  type: "prompt";
  text: string;
}

export interface Persona {
  id: string;
  name: string;
  personality: string;
  likes: string[];
  dislikes: string[];
  humorStyle: string[];
  favoriteJokeTypes: string[];
}

export interface Player {
  id: string;
  type: "human" | "cpu";
  persona: Persona | null;
  wonPromptCards: PromptCard[];
  answerCards: string[];
}

export interface PlayedAnswerCard {
  cardId: string;
  playerId: string;
  playerComment?: string;
}

export type GameStatus =
  | "initializing"
  | "waiting-for-answers"
  | "judging"
  | "game-ended"
  | "display-judgement"
  | "prepare-for-next-round"
  | "announce-winner";

export interface JudgementResult {
  judgeId: string;
  /** The ID of the winning card. */
  winningCardId: string;
  /** The ID of the player who won the round. */
  winningPlayerId: string;
  /** An explanation of why the judge chose the winning card. */
  reactionToWinningCard?: string;
}

export type NextActionHint =
  | { action: "submit-cpu-answers"; description: string }
  | { action: "submit-cpu-judgement"; description: string }
  | { action: "human-judge-pending"; description: string }
  | { action: "human-answer-pending"; description: string }
  | { action: "submit-prompt"; description: string }
  | { action: "game-over"; description: string }
  | null;

export interface IntroDialogEntry {
  playerId: string;
  playerName: string;
  dialog: string;
}

export interface GameState {
  gameKey: string;
  prompt: PromptCard | null;
  playedAnswerCards: PlayedAnswerCard[];
  players: Player[];
  status: GameStatus;
  winnerId: string | null;
  currentJudgePlayerIndex: number;
  answerCards: Record<string, AnswerCard>;
  discardedPromptCards: PromptCard[];
  judgementResult: JudgementResult | null;
}
