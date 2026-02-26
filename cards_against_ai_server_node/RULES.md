# Cards Against AI

Cards Against AI is an irreverent adult party game designed to produce humorous,
often offensive or politically incorrect, combinations of phrases. It relies on
subjective humor rather than strategy.

## Card Types

**Black Cards (Prompts)**: These contain a question or a fill-in-the-blank statement.
The blank is represented by four underscores (____).

**White Cards (Answers)**: These contain a noun or phrase used to answer or complete
the prompt on the black card.

## Win Condition

**First to 5 wins!** The game ends when any player reaches 5 "Awesome Points"
(won prompt cards).

## Game Flow

1. **Start Game**: ChatGPT generates 4 players (1 human + 3 CPU), 7 answer cards
   per player (28 total), the first prompt card, and intro dialog.

2. **Each Round**:
   - Judge reveals prompt
   - **Human player plays their answer card first**
   - Then CPU players choose and play their answer cards
   - Judge picks the funniest (wins the prompt card)
   - Winner gets 1 point
   - Judge rotates to next player

3. **Between Rounds**: ChatGPT provides:
   - New prompt card text
   - Replacement answer cards (1 per player who played last round)

## Human as Judge

When the human player is the judge for a round:
- Do NOT mention the human's hand cards — they only judge, they don't play.
- Replacement cards go only to players who played last round. The judge did not play and must NOT receive one.
- When `nextAction` is `play-cpu-answer-cards` after `submit-prompt`, call it immediately using the `cpuContext` from the response.

## Tool Response Format

Every tool response includes:
- `structuredContent.nextAction`: A hint telling ChatGPT what tool to call next
- `structuredContent.gameState`: The full current game state (plus `gameId` and `gameKey`)

Use `nextAction.action` to determine the next step:
- `"play-cpu-answer-cards"` — CPU players need to play cards. Use `play-cpu-answer-cards` tool.
- `"cpu-judge-answer-card"` — CPU judge needs to pick the winner. Use `cpu-judge-answer-card` tool.
- `"human-answer-pending"` — Waiting for human to play a card
- `"human-judge-pending"` — Waiting for human to judge
- `"wait-for-next-round"` — Round complete, wait for human to click "Next Round"
- `"submit-prompt"` — Submit a new prompt and replacement cards
- `"game-over"` — Game has ended

`nextAction.notifyModel` indicates whether the widget will automatically route the action through the model.

## MCP Tool Schemas

### start-game

Creates a new game instance.

```json
{
  "players": [
    {
      "id": "string",
      "name": "string",
      "type": "human" | "cpu",
      "persona": { ... },
      "answerCards": [
        { "id": "string", "type": "answer", "text": "string" }
      ]
    }
  ],
  "firstPrompt": "string",
  "introDialog": [
    {
      "playerId": "string",
      "playerName": "string",
      "dialog": "string"
    }
  ]
}
```

**Response textContent**: Role-played introductions from CPU characters.

### play-answer-card

Human player plays an answer card from their hand.

```json
{
  "gameId": "string",
  "playerId": "string",
  "cardId": "string"
}
```

### judge-answer-card

Human judge picks the winning answer card.

```json
{
  "gameId": "string",
  "playerId": "string",
  "winningCardId": "string"
}
```

### play-cpu-answer-cards

Submit CPU player card selections. Read CPU persona details and card hands from
`structuredContent.cpuContext` in the previous response.

```json
{
  "gameId": "string",
  "cpuAnswerChoices": [
    {
      "playerId": "string",
      "cardId": "string",
      "playerComment": "string"
    }
  ]
}
```

**Response textContent**: CPU quips. If `nextAction` is `cpu-judge-answer-card`, call that tool immediately.

### cpu-judge-answer-card

Submit the CPU judge's verdict. Read the played answer cards from `structuredContent.cpuContext`.

```json
{
  "gameId": "string",
  "winningCardId": "string",
  "reactionToWinningCard": "string"
}
```

**Response textContent**: Judge announcement.

### submit-prompt

Provides next round's prompt and replacement cards.

```json
{
  "gameId": "string",
  "promptText": "string",
  "replacementCards": [
    {
      "playerId": "string",
      "card": { "id": "string", "type": "answer", "text": "string" }
    }
  ]
}
```

## In-Character Dialog

Every response MUST include in-character dialog from CPU players. Write it directly in your response text — do NOT use a separate tool.

- 1-2 sentences per character, max. Not everyone speaks every time.
- Use persona fields (personality, humorStyle, catchphrase, quirks, voiceTone, competitiveness)
- ~70% game reactions, ~30% personality tangents. Characters reference each other.
- **Reference the human player too** — address them by name (the human player's name is in gameState.players where type === "human"), tease their card choices, react to their judging, etc. Make them feel like part of the table.
- Format: **Name**: "dialog" or **Name** *action*: "dialog"

## TextContent Format

CPU tool responses include role-played textContent (quips/announcements)
that ChatGPT should display to create an immersive experience:

```markdown
**Brenda the Soccer Mom** slaps down a card:
"Oh, this one's going to get me banned from the PTA."

**Dave from IT** carefully places his card:
"Statistically, this has a 23% chance of being funny."
```

## Persona Schema (CPU Required)

```json
{
  "id": "string",
  "name": "string",
  "personality": "string",
  "likes": ["string"],
  "dislikes": ["string"],
  "humorStyle": ["string"],
  "favoriteJokeTypes": ["string"],
  "catchphrase": "string (optional — signature phrase)",
  "quirks": ["string (optional — behavioral tics)"],
  "backstory": "string (optional — 1-2 sentence background)",
  "voiceTone": "string (optional — e.g. 'sarcastic', 'deadpan')",
  "competitiveness": "number 1-10 (optional — trash-talk intensity)"
}
```

## Chat Narration

Write CPU character dialog directly in your response text. Let the characters speak — don't summarize. Dialog should never delay the next tool call.

## Standard Rules Reference

Initial Setup: Each player gets 7 answer cards.
Role Designation: First player is the initial judge (Card Czar).
The Prompt: The judge reveals a prompt card.
Submission: The human player plays their answer card first, then CPU players choose their cards.
Judging: The judge picks their favorite response.
The Winner: The winning player keeps the prompt card (1 point).
Reset: Players draw replacement cards. Judge rotates to next player.
Ending: First to 5 points wins!
