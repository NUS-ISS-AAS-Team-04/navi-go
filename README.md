# NaviGo

A TypeScript multi-agent travel planning backend powered by LangChain/LangGraph.

NaviGo orchestrates specialized AI agents to synthesize flights, weather risk, budget, packing lists, and safety checks into a checkpointed travel plan. It exposes both an HTTP API (Fastify) and a CLI runner over the same planner graph.

## Tech Stack

- **Runtime**: Node.js (ESM)
- **Language**: TypeScript (`NodeNext` module resolution)
- **AI Framework**: LangChain / LangGraph
- **Model Provider**: OpenAI
- **External APIs**: Duffel (flights), Open-Meteo (weather)
- **Persistence**: PostgreSQL with `@langchain/langgraph-checkpoint-postgres`
- **Observability**: LangSmith (optional)
- **Server**: Fastify
- **Testing**: Vitest

## Features

- **Multi-agent orchestration**: Supervisor-style routing across preference, destination, itinerary, budget, packing, risk guard, and plan synthesizer agents
- **Real flight search**: Duffel API integration for live flight offers
- **Weather risk assessment**: Open-Meteo forecast with daily risk scoring
- **Budget feasibility**: Accommodation preference-based cost estimation
- **Safety guardrails**: Prompt injection and unsafe output detection
- **Checkpointed state**: Thread-level persistence and recovery via PostgreSQL
- **Dual interface**: HTTP API (`POST /plan`, `GET /plan/:threadId`) + CLI

## Quick Start

### Prerequisites

- Node.js (>= 18)
- Docker & Docker Compose (for local PostgreSQL)

### 1. Install dependencies

```bash
npm install
```

### 2. Start PostgreSQL

```bash
docker compose up -d postgres
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

Required variables:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI model access |
| `DUFFEL_API_TOKEN` | Flight search (Duffel) |
| `POSTGRES_URL` | Checkpointer persistence |

Optional variables:

| Variable | Purpose |
|----------|---------|
| `LANGSMITH_API_KEY` | Tracing & evals |
| `LANGSMITH_TRACING` | Set `true` to enable |

### 4. Run

**API server** (default):
```bash
npm run dev
```

**CLI planner**:
```bash
npm run dev -- --cli \
  --thread-id trip-1 \
  --request "Plan a 3-day trip to Tokyo" \
  --origin SFO \
  --destination-hint Tokyo \
  --destination-city TYO \
  --destination-iata HND \
  --start-date 2026-04-21 \
  --end-date 2026-04-23 \
  --budget 2400 \
  --adults 1 \
  --children 0 \
  --interests food,museums
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   HTTP API  │     │    CLI       │     │  Fastify Server │
│  POST /plan │     │  --cli flags │     │  GET /plan/:id  │
└──────┬──────┘     └──────┬───────┘     └─────────────────┘
       │                   │
       └─────────┬─────────┘
                 ▼
        ┌────────────────┐
        │  Planner Graph │  (StateGraph over PlannerState)
        │   LangGraph    │
        └───────┬────────┘
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
risk_guard  supervisor   preference
    │           │        destination
    │           │        itinerary
    │           │        budget
    │           │        packing
    │           │        plan_synthesizer
    └───────────┴───────────┘
                │
        ┌───────┴───────┐
        ▼               ▼
   Duffel (flights)  Open-Meteo (weather)
   PostgreSQL (state)
```

Key directories:

- `src/agents/` — Agent node implementations
- `src/graph/` — State schema, routing, graph builder
- `src/tools/` — External API integrations
- `src/interfaces/` — API and CLI entry points
- `src/persistence/` — Checkpoint savers

## Development Commands

```bash
npm run dev              # Start API server
npm run build            # Compile to dist/
npm run start            # Run compiled app
npm run typecheck        # TypeScript check (tsc --noEmit)
npm run lint             # ESLint
npm run test             # All tests
npm run test:unit        # Unit tests
npm run test:integration # Integration tests
npm run test:eval        # Eval suite (LangSmith-gated)
npm run acceptance       # Full acceptance gate
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/plan` | Invoke planner graph |
| `GET`  | `/plan/:threadId` | Retrieve checkpointed state |
| `GET`  | `/health` | Health check |

### POST /plan Example

```bash
curl -X POST http://localhost:3000/plan \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "trip-1",
    "userRequest": {
      "requestText": "Plan a 3-day trip to Tokyo",
      "originIata": "SFO",
      "destinationHint": "Tokyo",
      "destinationCityCode": "TYO",
      "destinationIata": "HND",
      "travelStartDate": "2026-04-21",
      "travelEndDate": "2026-04-23",
      "budget": 2400,
      "adults": 1,
      "children": 0,
      "interests": ["food", "museums"]
    }
  }'
```

## Testing

- **Unit tests**: Isolated agent/tool behavior (`tests/unit/`)
- **Integration tests**: End-to-end graph and API validation with injected fakes (`tests/integration/`)
- **Evals**: LangSmith-gated scenario scoring (`tests/evals/`)

Tests use:
- `FakeStructuredChatModel` for deterministic LLM outputs
- `createInMemoryCheckpointer()` to avoid PostgreSQL dependency
- Stubbed tool dependencies for itinerary agent

## Environment Notes

- Several env vars are **schema-optional** but **runtime-required** via `require*` helpers when the relevant code path executes.
- The `acceptance` script runs a live API CLI scenario only when `OPENAI_API_KEY`, `DUFFEL_API_TOKEN`, and `POSTGRES_URL` are all set.
- Open-Meteo free forecast API has a date range limitation (typically ~14 days ahead). Use dates within the allowed window for live weather queries.

## License

MIT
