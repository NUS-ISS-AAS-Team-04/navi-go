# Repository Guidelines

## Project Overview
NaviGo is a TypeScript backend for multi-agent travel planning built on LangChain/LangGraph.

It provides two interfaces over the same planner graph:
- HTTP API (Fastify)
- CLI runner

The planner supports both **structured requests** (direct `UserRequest`) and **natural-language chat** (multi-turn with clarifying questions). It synthesizes flights, weather risk, budget, packing, and safety checks into a final plan, with checkpointed state per `thread_id`.

## Architecture & Data Flow
High-level flow:
1. Entry: `src/index.ts`
   - default: start API server
   - `--cli`: run CLI planner
2. Interface layer invokes compiled graph:
   - API: `src/interfaces/api/routes/plan.route.ts`
     - `POST /plan` — structured request
     - `POST /plan/chat` — natural language input
     - `POST /plan/chat/resume` — answer pending clarifying questions
     - `GET /plan/:threadId` — inspect thread state
   - CLI: `src/interfaces/cli/run-plan.ts`
3. Graph orchestration (`src/graph/builder.ts`):
   - `StateGraph` over `PlannerStateAnnotation`
   - Nodes: `requirement_parser`, `form_completer`, `risk_guard`, `supervisor`, `preference_agent`, `destination_agent`, `itinerary_agent`, `budget_agent`, `packing_agent`, `plan_synthesizer`
   - Routing (`src/graph/routes.ts`):
     - `START` → `requirement_parser` (if `naturalLanguage` present and not yet parsed)
     - `requirement_parser` → `form_completer`
     - `form_completer` → `END` (if `pendingQuestions` remain) or `risk_guard` (if complete)
     - `risk_guard` → `plan_synthesizer` (if blocked) or `supervisor` (if safe)
     - `supervisor` → `preference_agent` → `risk_guard`
     - `supervisor` → `destination_agent` → `risk_guard`
     - `supervisor` → `itinerary_agent` → `risk_guard`
     - `supervisor` → `budget_agent` → `risk_guard`
     - `supervisor` → `packing_agent` → `risk_guard`
     - `supervisor` → `plan_synthesizer` → `END`
4. Agents update shared state (`Partial<PlannerState>`) only; graph reducers control merge semantics.
5. Tool layer fetches external data:
   - Flights: Duffel (`src/tools/flights/duffel-flight.tool.ts`)
   - Hotels: not queried (feature removed)
   - Weather: Open-Meteo (`src/tools/weather/openmeteo-weather.tool.ts`)
6. Auxiliary modules:
   - `src/agents/flight-option-selection.ts` — pure-function flight sorting/recommendation helper
   - `src/data/place-anchors.ts` — hard-coded POI anchors per city code for itinerary generation
7. Persistence/checkpointing:
   - default Postgres saver (`src/persistence/checkpointer.ts`)
   - in-memory saver available for tests/injected runs

## Key Directories
- `src/agents/`: agent node implementations
- `src/graph/`: state schema, router logic, graph builder
- `src/tools/`: provider integrations + shared HTTP/error/auth helpers
- `src/interfaces/api/`: Fastify server + routes
- `src/interfaces/cli/`: CLI entry flow
- `src/config/`: env parsing + model construction
- `src/security/`: guardrail checks
- `src/observability/`: LangSmith metadata/tracing wiring
- `src/persistence/`: checkpointer factories
- `src/data/`: static data helpers (place anchors, etc.)
- `tests/unit/`: isolated module tests
- `tests/integration/`: graph/API integration tests
- `tests/evals/`: eval-style tests (LangSmith-gated)
- `scripts/`: operational scripts (acceptance gate)

## Development Commands
Use npm (lockfile is `package-lock.json`).

Core commands:
- `npm run dev` — run app (API mode by default)
- `npm run dev -- --cli --thread-id t1 --request "..."` — run CLI mode
- `npm run build` — compile to `dist/`
- `npm run start` — run compiled app
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint flat-config lint
- `npm run test` — all Vitest suites
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:eval`
- `npm run acceptance` — static + tests; runs live scenario only if required env vars exist

## Runtime & Tooling Preferences
- Runtime: Node.js (ESM)
- Module system: `"type": "module"`, TS `NodeNext`
- Import style: local TS imports use `.js` specifiers
- Package manager: npm
- Test framework: Vitest (node environment, globals enabled)
- Linting: ESLint v9 flat config + `typescript-eslint`

## Environment Contract
Defined in `src/config/env.ts`, example in `.env.example`.

Common variables:
- Core: `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4o-mini`)
- Flights: `DUFFEL_API_TOKEN`, `DUFFEL_BASE_URL` (default `https://api.duffel.com`)
- Persistence: `POSTGRES_URL`
- Observability: `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` (default `navi-go`)
- Server: `PORT` (default `3000`)

Important nuance:
- Several env vars are schema-optional but enforced at runtime by `require*` helpers (`requireOpenAiApiKey`, `requireDuffelApiToken`, `requirePostgresUrl`) when that feature path executes.

## Code Conventions & Common Patterns
- Validate input/output with Zod at boundaries (request payloads, provider payloads).
- Keep provider-specific auth/request logic in `src/tools/common/*`.
- Use shared HTTP helper `requestJson()` for retry/timeout behavior.
- Normalize upstream failures via typed `ToolError` (`src/tools/common/errors.ts`).
- Agents should return `Partial<PlannerState>` only; graph reducers control merge semantics.
- Routing is state-driven; do not hardcode linear pipelines when adding nodes.
- Dependency injection is preferred for graph/tests (`buildPlannerGraph({ model, checkpointer, itineraryAgentDependencies, budgetAgentDependencies, packingAgentDependencies, planSynthesizerDependencies, riskGuardDependencies, formCompleterDependencies })`).
- Safety checks are additive (`safetyFlags`, `decisionLog`) and should remain explicit.
- Use `makeDecisionLog()` (`src/graph/state.ts`) for consistent decision-log entries.

## Important Files
- Entrypoints: `src/index.ts`, `src/interfaces/api/server.ts`, `src/interfaces/cli/run-plan.ts`
- Graph core: `src/graph/state.ts`, `src/graph/routes.ts`, `src/graph/builder.ts`
- Agents: `src/agents/requirement-parser.agent.ts`, `src/agents/form-completer.agent.ts`, `src/agents/preference.agent.ts`, `src/agents/destination.agent.ts`, `src/agents/itinerary.agent.ts`, `src/agents/budget.agent.ts`, `src/agents/packing.agent.ts`, `src/agents/risk-guard.agent.ts`, `src/agents/plan-synthesizer.agent.ts`
- Flight helper: `src/agents/flight-option-selection.ts`
- Data anchors: `src/data/place-anchors.ts`
- Provider helpers: `src/tools/common/http.ts`, `src/tools/common/errors.ts`, `src/tools/common/duffel.ts`
- Persistence: `src/persistence/checkpointer.ts`
- Security/trace: `src/security/guardrails.ts`, `src/observability/tracing.ts`
- Acceptance flow: `scripts/acceptance.sh`

## Testing & QA
- Unit tests focus on deterministic module behavior (`tests/unit/**`).
- Integration tests validate end-to-end graph/API behavior with injected fakes/stubs (`tests/integration/**`), including chat endpoints.
- Evals are in `tests/evals/travel-planner.eval.ts` and are environment-gated.
- Prefer in-memory checkpointer and fake model in tests (`tests/helpers/fake-model.ts`).

Practical expectations for assistants:
- Run `typecheck` + `lint` after code changes.
- Run targeted test suites first; run full suites before final handoff.
- For provider-related changes, ensure acceptance script env gate remains accurate (`scripts/acceptance.sh`).
