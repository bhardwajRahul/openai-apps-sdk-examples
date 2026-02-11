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

## Tool Response Format

Every tool response includes:
- `structuredContent.nextAction`: A hint telling ChatGPT what tool to call next
- `structuredContent.gameState`: The full current game state (plus `gameId` and `gameKey`)

Use `nextAction.action` to determine the next step:
- `"submit-cpu-answers"` — CPU players need to play cards
- `"submit-cpu-judgement"` — CPU judge needs to pick a winner
- `"human-answer-pending"` — Waiting for human to play a card
- `"human-judge-pending"` — Waiting for human to judge
- `"submit-prompt"` — Submit a new prompt and replacement cards
- `"game-over"` — Game has ended

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

### submit-cpu-answers

Submit CPU player card selections.

```json
{
  "gameId": "string",
  "choices": [
    {
      "playerId": "string",
      "cardId": "string",
      "playerComment": "string"
    }
  ]
}
```

**Response textContent**: Each CPU's quip as they play their card.

### submit-cpu-judgement

Submit CPU judge's verdict.

```json
{
  "gameId": "string",
  "winningCardId": "string",
  "reactionToWinningCard": "string"
}
```

**Response textContent**: Dramatic announcement with winning card text, judge's
reasoning, and winner name.

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

## TextContent Format

All CPU tool responses include role-played textContent that ChatGPT should display
to create an immersive experience:

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
  "favoriteJokeTypes": ["string"]
}
```

## Chat Narration

When CPU tools return textContent with role-played dialog, present it naturally in your
response. Let the characters speak — don't summarize or editorialize. Keep the game moving.

## Standard Rules Reference

Initial Setup: Each player gets 7 answer cards.
Role Designation: First player is the initial judge (Card Czar).
The Prompt: The judge reveals a prompt card.
Submission: The human player plays their answer card first, then CPU players choose their cards.
Judging: The judge picks their favorite response.
The Winner: The winning player keeps the prompt card (1 point).
Reset: Players draw replacement cards. Judge rotates to next player.
Ending: First to 5 points wins!
