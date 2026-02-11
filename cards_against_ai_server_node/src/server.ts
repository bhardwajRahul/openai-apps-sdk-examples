/**
 * Cards Against AI MCP server (Node).
 *
 * Exposes game tools over MCP. All game state flows through tool responses.
 * Uses McpServer + StreamableHTTP + ext-apps (MCP Apps standard).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { GameInstance } from "./GameInstance.js";
import type { IntroDialogEntry } from "./shared-types.js";

// Use express from the SDK's own dependencies
import express from "express";
import cors from "cors";

interface GameRecord {
  id: string;
  key: string;
  instance: GameInstance;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const ASSETS_DIR = path.resolve(ROOT_DIR, "assets");
const TEMPLATE_URI = "ui://widget/cards-against-ai.html";
const RULES_URI = "rules://cards-against-ai";
const ANSWER_GUIDANCE_URI = "rules://cards-against-ai/answer-deck";
const MARKDOWN_MIME_TYPE = "text/markdown";
const RULES_PATH = path.resolve(
  ROOT_DIR,
  "cards_against_ai_server_node",
  "RULES.md",
);
const ANSWER_GUIDANCE_PATH = path.resolve(
  ROOT_DIR,
  "cards_against_ai_server_node",
  "ANSWER_DECK_GUIDANCE.md",
);

dotenv.config({ path: path.resolve(ROOT_DIR, ".env.local") });

const ASSETS_BASE_URL = normalizeBaseUrl(
  process.env.ASSETS_BASE_URL ??
    process.env.BASE_URL ??
    process.env.VITE_BASE_URL ??
    "",
);
const ASSETS_BASE_ORIGIN = parseOrigin(ASSETS_BASE_URL);
const API_BASE_URL = normalizeBaseUrl(
  process.env.API_BASE_URL ??
    process.env.VITE_API_BASE_URL ??
    "http://localhost:8000",
);
const API_BASE_ORIGIN = parseOrigin(API_BASE_URL);

const widgetConnectDomains: string[] = [];
if (ASSETS_BASE_ORIGIN) {
  widgetConnectDomains.push(ASSETS_BASE_ORIGIN);
}
if (API_BASE_ORIGIN) {
  widgetConnectDomains.push(API_BASE_ORIGIN);
}

const OPENAI_ASSETS_ORIGIN = "https://persistent.oaistatic.com";
const widgetResourceDomains = ASSETS_BASE_ORIGIN
  ? [ASSETS_BASE_ORIGIN, OPENAI_ASSETS_ORIGIN]
  : [OPENAI_ASSETS_ORIGIN];
const widgetCspDomains = buildWidgetCspDomains(
  widgetConnectDomains,
  widgetResourceDomains,
  ASSETS_BASE_ORIGIN,
);

const gamesById = new Map<string, GameRecord>();

function normalizeBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

function parseOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function buildWidgetCspDomains(
  connectDomains: string[],
  resourceDomains: string[],
  extraDomain: string | null,
): { connectDomains: string[]; resourceDomains: string[] } {
  const connect = new Set(connectDomains);
  const resource = new Set(resourceDomains);

  if (extraDomain) {
    connect.add(extraDomain);
    resource.add(extraDomain);
  }

  return {
    connectDomains: [...connect],
    resourceDomains: [...resource],
  };
}

function readWidgetHtml(): string {
  if (!fs.existsSync(ASSETS_DIR)) {
    throw new Error(
      `Widget assets not found. Expected directory ${ASSETS_DIR}. Run "pnpm run build" before starting the server.`,
    );
  }

  const directPath = path.join(ASSETS_DIR, "cards-against-ai.html");
  let htmlContents: string | null = null;

  if (fs.existsSync(directPath)) {
    htmlContents = fs.readFileSync(directPath, "utf8");
  } else {
    const candidates = fs
      .readdirSync(ASSETS_DIR)
      .filter(
        (file) =>
          file.startsWith("cards-against-ai-") && file.endsWith(".html"),
      )
      .sort();
    const fallback = candidates[candidates.length - 1];
    if (fallback) {
      htmlContents = fs.readFileSync(path.join(ASSETS_DIR, fallback), "utf8");
    }
  }

  if (!htmlContents) {
    throw new Error(
      `Widget HTML for "cards-against-ai" not found in ${ASSETS_DIR}. Run "pnpm run build" to generate the assets.`,
    );
  }

  if (ASSETS_BASE_URL) {
    return htmlContents.replaceAll(
      "http://localhost:4444",
      ASSETS_BASE_URL,
    );
  }

  return htmlContents;
}

function readMarkdownFile(filePath: string, label: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Cards Against AI ${label} not found. Expected file ${filePath}.`,
    );
  }

  return fs.readFileSync(filePath, "utf8");
}

const widgetHtml = readWidgetHtml();
const rulesMarkdown = readMarkdownFile(RULES_PATH, "rules");
const answerGuidanceMarkdown = readMarkdownFile(
  ANSWER_GUIDANCE_PATH,
  "answer deck guidance",
);

// --- UI metadata for tools and resources ---

const toolUiMeta = {
  ui: {
    resourceUri: TEMPLATE_URI,
    csp: {
      connectDomains: widgetCspDomains.connectDomains,
      resourceDomains: widgetCspDomains.resourceDomains,
    },
  },
};

// --- Zod schemas for tool input ---

const cpuPersonaParser = z.object({
  id: z.string(),
  name: z.string(),
  personality: z.string(),
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  humorStyle: z.array(z.string()),
  favoriteJokeTypes: z.array(z.string()),
});

const answerCardParser = z.object({
  id: z.string(),
  type: z.literal("answer"),
  text: z.string(),
});

const introDialogEntryParser = z.object({
  playerId: z.string(),
  playerName: z.string(),
  dialog: z.string(),
});

const playerInputParser = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["human", "cpu"]),
  persona: cpuPersonaParser.optional(),
  answerCards: z.array(answerCardParser),
});

const startGameShape = {
  players: z.array(playerInputParser).min(4).max(4),
  firstPrompt: z.string(),
  introDialog: z.array(introDialogEntryParser),
};

const playAnswerCardShape = {
  gameId: z.string(),
  playerId: z.string(),
  cardId: z.string(),
};

const judgeAnswerCardShape = {
  gameId: z.string(),
  playerId: z.string(),
  winningCardId: z.string(),
};

const submitCpuAnswersShape = {
  gameId: z.string(),
  choices: z.array(
    z.object({
      playerId: z.string(),
      cardId: z.string(),
      playerComment: z.string().optional(),
    }),
  ),
};

const submitCpuJudgementShape = {
  gameId: z.string(),
  winningCardId: z.string(),
  reactionToWinningCard: z.string().optional(),
};

const replacementCardParser = z.object({
  playerId: z.string(),
  card: answerCardParser,
});

const submitPromptShape = {
  gameId: z.string(),
  promptText: z.string(),
  replacementCards: z.array(replacementCardParser),
};

// --- Game logic helpers ---

const WATCH_TIMEOUT_MS = 45_000;

function buildWatchResponse(
  type: "change" | "timeout",
  record: GameRecord,
) {
  const base = {
    type,
    invocation: "watch-game-state" as const,
    gameId: record.id,
    gameKey: record.key,
  };

  return {
    content: [] as Array<{ type: "text"; text: string }>,
    structuredContent: type === "change"
      ? {
          ...base,
          gameState: record.instance.getState(),
          nextAction: record.instance.computeNextAction(),
        }
      : base,
  };
}

function buildGameToolResponse(
  toolName: string,
  record: GameRecord,
  textContent: string,
) {
  return {
    content: textContent ? [{ type: "text" as const, text: textContent }] : [],
    structuredContent: {
      invocation: toolName,
      gameId: record.id,
      gameKey: record.key,
      gameState: record.instance.getState(),
      nextAction: record.instance.computeNextAction(),
    },
  };
}

function gameNotFoundError(toolName: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: "Unknown game id" }],
    structuredContent: {
      invocation: toolName,
    },
  };
}

function getGameRecord(gameId: string) {
  return gamesById.get(gameId) ?? null;
}

function formatIntroDialog(introDialog: IntroDialogEntry[]): string {
  if (introDialog.length === 0) {
    return "";
  }

  return introDialog
    .map((entry) => `**${entry.playerName}**: "${entry.dialog}"`)
    .join("\n\n");
}

function formatCpuContextForPlayAnswerCard(
  cpuContext: ReturnType<GameInstance["getCpuContext"]>,
): string {
  const lines: string[] = ["Card played. Now it's the CPU players' turn."];

  if (cpuContext.prompt) {
    lines.push(`\n**Current prompt:** ${cpuContext.prompt.text}`);
  }

  for (const cpu of cpuContext.cpuPlayers) {
    const persona = cpu.persona;
    const personaDetails: string[] = [];
    if (persona?.personality) personaDetails.push(`Personality: ${persona.personality}`);
    if (persona?.likes?.length) personaDetails.push(`Likes: ${persona.likes.join(", ")}`);
    if (persona?.dislikes?.length) personaDetails.push(`Dislikes: ${persona.dislikes.join(", ")}`);
    if (persona?.humorStyle?.length) personaDetails.push(`Humor style: ${persona.humorStyle.join(", ")}`);
    if (persona?.favoriteJokeTypes?.length) personaDetails.push(`Favorite joke types: ${persona.favoriteJokeTypes.join(", ")}`);

    const cardsText = cpu.hand
      .map((card) => `  - ${card.id}: "${card.text}"`)
      .join("\n");

    lines.push(
      `\n**${cpu.name}** (${cpu.id}):\n${personaDetails.join("\n")}\nCards:\n${cardsText}`,
    );
  }

  lines.push("\nCall `submit-cpu-answers` with each CPU player's card choice and an in-character quip.");

  return lines.join("\n");
}

function formatCpuAnswerQuips(
  choices: Array<{ playerId: string; cardId: string; playerComment?: string }>,
  instance: GameInstance,
): string {
  const state = instance.getState();
  const lines: string[] = [];

  for (const choice of choices) {
    const player = state.players.find((p) => p.id === choice.playerId);
    const name = player?.persona?.name ?? "CPU";
    const comment = choice.playerComment?.trim();

    if (comment) {
      lines.push(`**${name}** slaps down a card:\n"${comment}"`);
    } else {
      lines.push(`**${name}** plays a card silently.`);
    }
  }

  return lines.join("\n\n");
}

// --- Server creation ---

const toolAnnotations = {
  // Game tools only mutate internal server state, not user data —
  // marking as read-only tells ChatGPT to skip confirmation dialogs.
  readOnlyHint: true as const,
  // These tools never delete or overwrite user data.
  destructiveHint: false as const,
  // These tools don't interact with external services or publish content.
  openWorldHint: false as const,
};

function createCardsAgainstAiServer(): McpServer {
  const server = new McpServer(
    {
      name: "cards-against-ai-node",
      version: "0.1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    },
  );

  // --- Register resources ---

  registerAppResource(
    server,
    "Cards Against AI widget",
    TEMPLATE_URI,
    {
      description: "Cards Against AI widget markup",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: TEMPLATE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
        },
      ],
    }),
  );

  registerAppResource(
    server,
    "Cards Against AI rules",
    RULES_URI,
    {
      description: "Cards Against AI game rules",
      mimeType: MARKDOWN_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: RULES_URI,
          mimeType: MARKDOWN_MIME_TYPE,
          text: rulesMarkdown,
        },
      ],
    }),
  );

  registerAppResource(
    server,
    "Cards Against AI answer deck guidance",
    ANSWER_GUIDANCE_URI,
    {
      description: "Guidance for crafting the answer deck",
      mimeType: MARKDOWN_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: ANSWER_GUIDANCE_URI,
          mimeType: MARKDOWN_MIME_TYPE,
          text: answerGuidanceMarkdown,
        },
      ],
    }),
  );

  // --- Register tools ---

  registerAppTool(
    server,
    "start-game",
    {
      title: "Start a Cards Against AI game",
      description:
        "Creates a new game instance and returns its gameId/gameKey along with the initial gameState. Provide exactly 4 players (1 human + 3 CPU recommended). Each player needs: id, name, type ('human' or 'cpu'), answerCards (7 cards each), and persona (required for CPU, optional for human). The firstPrompt is the first round's prompt card text (must contain ____). The introDialog array contains role-played introductions from each CPU character. The response includes gameState and nextAction — use nextAction to determine what tool to call next. First to 5 wins! Full rules are in rules://cards-against-ai. Answer card guidance in rules://cards-against-ai/answer-deck.",
      inputSchema: startGameShape,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      if (!args.firstPrompt.includes("____")) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "firstPrompt must contain ____ (four underscores) for the blank.",
            },
          ],
        };
      }

      const gameId = randomUUID();
      const instance = new GameInstance({
        players: args.players.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          persona: p.persona ?? null,
          answerCards: p.answerCards,
        })),
        firstPrompt: args.firstPrompt,
      });
      instance.initializeNewGame();

      const gameKey = instance.key;
      const record = { id: gameId, key: gameKey, instance };
      gamesById.set(gameId, record);

      const introTextContent = formatIntroDialog(args.introDialog);
      return buildGameToolResponse("start-game", record, introTextContent);
    },
  );

  registerAppTool(
    server,
    "play-answer-card",
    {
      title: "Play an answer card",
      description:
        "Plays an answer card from the human player's hand. The human will provide gameId, playerId, and cardId via chat. Returns updated gameState and nextAction.",
      inputSchema: playAnswerCardShape,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) return gameNotFoundError("play-answer-card");

      try {
        record.instance.playAnswerCard(args.playerId, args.cardId);
      } catch (error) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Failed to play answer card.",
            },
          ],
        };
      }

      const nextAction = record.instance.computeNextAction();
      let textContent = "Card played.";

      if (nextAction?.action === "submit-cpu-answers") {
        const cpuContext = record.instance.getCpuContext();
        textContent = formatCpuContextForPlayAnswerCard(cpuContext);
      }

      return buildGameToolResponse("play-answer-card", record, textContent);
    },
  );

  registerAppTool(
    server,
    "judge-answer-card",
    {
      title: "Judge the winning answer card",
      description:
        "Records the human judge's winning card choice. The human will provide gameId, playerId, and winningCardId via chat. Returns updated gameState and nextAction.",
      inputSchema: judgeAnswerCardShape,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) return gameNotFoundError("judge-answer-card");

      const state = record.instance.getState();
      const playedCard = state.playedAnswerCards.find(
        (played) => played.cardId === args.winningCardId,
      );
      if (!playedCard) {
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: "Winning card not found in played cards." }],
        };
      }

      try {
        record.instance.judgeAnswers({
          judgeId: args.playerId,
          winningCardId: args.winningCardId,
          winningPlayerId: playedCard.playerId,
        });
      } catch (error) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Failed to judge answer card.",
            },
          ],
        };
      }

      const stateAfter = record.instance.getState();
      const winningCard = stateAfter.answerCards[args.winningCardId];
      const winningPlayer = stateAfter.players.find(
        (p) => p.id === playedCard.playerId,
      );
      const winnerName = winningPlayer?.persona?.name ?? "Someone";
      const cardText = winningCard?.text ?? "???";
      const textContent = `The human judge picks: "${cardText}"\n\n**${winnerName}** wins this round!`;

      return buildGameToolResponse("judge-answer-card", record, textContent);
    },
  );

  registerAppTool(
    server,
    "submit-cpu-answers",
    {
      title: "Submit CPU player answer card choices",
      description:
        "When nextAction.action === 'submit-cpu-answers', use this tool to provide card selections for all CPU players. Each choice needs a playerId, cardId (from that player's hand in the gameState), and an optional playerComment (a quip in character). Returns updated gameState and nextAction.",
      inputSchema: submitCpuAnswersShape,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) return gameNotFoundError("submit-cpu-answers");

      try {
        record.instance.submitCpuAnswers(args.choices);
      } catch (error) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Failed to submit CPU answers.",
            },
          ],
        };
      }

      const textContent = formatCpuAnswerQuips(args.choices, record.instance);
      return buildGameToolResponse("submit-cpu-answers", record, textContent);
    },
  );

  registerAppTool(
    server,
    "submit-cpu-judgement",
    {
      title: "Submit CPU judge verdict",
      description:
        "When nextAction.action === 'submit-cpu-judgement', the CPU judge picks a winner from the played answer cards in gameState. Provide winningCardId and optional reactionToWinningCard (1-2 sentences in the judge's voice). Returns updated gameState and nextAction.",
      inputSchema: submitCpuJudgementShape,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) return gameNotFoundError("submit-cpu-judgement");

      const stateBefore = record.instance.getState();
      const judge = stateBefore.players[stateBefore.currentJudgePlayerIndex];
      const judgeName = judge?.persona?.name ?? "The Judge";

      try {
        record.instance.submitCpuJudgement({
          winningCardId: args.winningCardId,
          reactionToWinningCard: args.reactionToWinningCard,
        });
      } catch (error) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Failed to submit CPU judgement.",
            },
          ],
        };
      }

      const stateAfter = record.instance.getState();
      const winningCard = stateAfter.answerCards[args.winningCardId];
      const winningPlayer = stateAfter.players.find(
        (p) => p.id === stateAfter.judgementResult?.winningPlayerId,
      );
      const winnerName = winningPlayer?.persona?.name ?? "Someone";
      const cardText = winningCard?.text ?? "???";

      const reaction = args.reactionToWinningCard?.trim() ?? "This one wins!";
      const textContent = `**${judgeName}** picks up a card and announces:\n\n"${cardText}"\n\n*${reaction}*\n\n**${winnerName}** wins this round!`;

      return buildGameToolResponse("submit-cpu-judgement", record, textContent);
    },
  );

  registerAppTool(
    server,
    "submit-prompt",
    {
      title: "Submit a prompt card for the round",
      description:
        "When nextAction.action === 'submit-prompt', provide a new prompt card and replacement answer cards. The promptText must include exactly one blank (____). The replacementCards array should include one new answer card for each player who played last round (not the judge). Returns updated gameState and nextAction.",
      inputSchema: submitPromptShape,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) return gameNotFoundError("submit-prompt");

      if (!args.promptText.includes("____")) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "promptText must contain ____ (four underscores) for the blank.",
            },
          ],
        };
      }

      try {
        record.instance.submitPrompt(args.promptText, args.replacementCards);
      } catch (error) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Failed to submit prompt.",
            },
          ],
        };
      }

      return buildGameToolResponse("submit-prompt", record, "New round started!");
    },
  );

  // App-only tool: hidden from LLM, callable by the widget to wait for state changes.
  // Holds the response until the game state changes or a 45s timeout elapses.
  registerAppTool(
    server,
    "watch-game-state",
    {
      title: "Watch for game state changes",
      description:
        "Holds the response until the game state changes from knownStatus or a timeout elapses. Returns { type: 'change' | 'timeout' } in structuredContent.",
      inputSchema: {
        gameId: z.string(),
        knownStatus: z.string(),
      },
      _meta: {
        ui: {
          resourceUri: TEMPLATE_URI,
          visibility: ["app"],
          csp: {
            connectDomains: widgetCspDomains.connectDomains,
            resourceDomains: widgetCspDomains.resourceDomains,
          },
        },
      },
      annotations: {
        ...toolAnnotations,
        readOnlyHint: true as const,
      },
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) return gameNotFoundError("watch-game-state");

      // If state already differs from what the widget knows, return immediately
      const currentStatus = record.instance.getState().status;
      if (currentStatus !== args.knownStatus) {
        return buildWatchResponse("change", record);
      }

      // Wait for a state change or 45s timeout
      const timeout = AbortSignal.timeout(WATCH_TIMEOUT_MS);
      await record.instance.waitForChange(timeout);

      // If timeout aborted the signal, no change occurred
      const type = timeout.aborted ? "timeout" : "change";
      return buildWatchResponse(type, record);
    },
  );

  return server;
}

// --- HTTP server using Express + StreamableHTTP ---

const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

const app = express();
app.use(cors());
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const body = req.body;
  const method = Array.isArray(body) ? body.map((m: { method?: string }) => m.method).join(", ") : body?.method;
  console.log(`[mcp] POST /mcp — method: ${method}`);

  const server = createCardsAgainstAiServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const server = createCardsAgainstAiServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (_req, res) => {
  res.status(405).end();
});

app.listen(port, () => {
  console.log(
    `Cards Against AI MCP server listening on http://localhost:${port}`,
  );
  console.log(`  Streamable HTTP endpoint: POST http://localhost:${port}/mcp`);
});
