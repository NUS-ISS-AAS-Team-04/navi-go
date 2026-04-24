# 4. Explainable & Responsible AI Practices

This document summarizes NaviGo's explainability and responsible AI practices based on the current repository implementation (`src/**`, `tests/**`, `.github/workflows/**`, `scripts/**`).

## 4.1 Explainability Design

### 1) Decision Log

Every agent appends a `decisionLog` entry (`makeDecisionLog`) when outputting `Partial<PlannerState>`, including:

- `agent`
- `inputSummary`
- `keyEvidence`
- `outputSummary`
- `riskFlags`
- `timestamp`

This means callers can see not only the final `finalPlan`, but also "what decision was made based on what evidence" at every step.

### 2) Structured Output Constraints

All LLM-requiring agents use `withStructuredOutput(...)` + Zod schema, preventing free text from directly entering state:

- `ExtractedRequestSchema` (requirement_parser)
- `FormCompletionSchema` (form_completer)
- `RiskGuardSchema` (risk_guard)
- `PreferencesSchema` (preference_agent)
- `DestinationSuggestionsSchema` / `DestinationCandidateSchema` (destination_agent)
- `ItineraryDraftSchema` (itinerary_agent)
- `BudgetAssessmentSchema` (budget_agent)
- `PackingListSchema` (packing_agent)
- `PlanSynthesisSchema` (plan_synthesizer)

### 3) Unified Boundary Validation

Zod validation covers:

- Environment variables: `src/config/env.ts`
- API request bodies: `src/interfaces/api/routes/plan.route.ts`
- External API responses: Duffel / Open-Meteo tool layer
- Final plan: `FinalPlanSchema`

## 4.2 Responsible AI Implementation

### 1) User Intent Priority

- In `preference_agent`, if the user explicitly provided `interests` in `userRequest`, they override model-extracted interests, reducing the risk of "the model silently rewriting user preferences."
- In `destination_agent`, the user's explicitly provided destination (hint + city code + IATA) is prepended as a fallback candidate, ensuring user intent is not ignored.

### 2) Explicit Risk Exposure, No Silent Handling

- `risk_guard` writes detected risks to `safetyFlags` (dual-layer scanning: rules + LLM semantics).
- `budget_agent` writes `BUDGET_EXCEEDED` when over budget.
- `plan_synthesizer` carries safety flags into the final output.

Even if planning can continue, risks are never hidden.

### 3) Controlled Refusal Path

When prompt injection (`BLOCKED_PROMPT_INJECTION`) is detected, the router sends flow directly to `plan_synthesizer` to generate a safe refusal summary, rather than continuing the full planning chain.

### 4) Natural-Language Interaction Transparency

`form_completer` does not silently guess or fill in missing required fields; instead, it generates 1–2 natural-language clarifying questions returned to the client, and only continues after user confirmation. This prevents the model from擅自 inferring user constraints that were not explicitly expressed.

## 4.3 Traceability and Audit

### 1) Thread-Level State Replay

Graph state is persisted via checkpointer; the API provides `GET /plan/:threadId` to read thread snapshots for:

- Backtracking which node the planner ended at
- Viewing complete state `values`
- Viewing metadata and timestamps

### 2) Optional LangSmith Tracing

Enabled when `LANGSMITH_TRACING=true`; metadata is injected via `buildTraceMetadata(...)` with:

- `userId`
- `threadId`
- `scenario`
- `service`

## 4.4 Data Processing and Minimization (Current Status)

In the current implementation, `userRequest` (including `userId`) is part of `PlannerState`, so it enters checkpoint state (depending on the checkpointer used).

Therefore:

- The system **has** thread state persistence capability (default Postgres)
- It is **not** "only transiently in memory, never persisted"

If the deployment has stricter data minimization requirements, it is recommended to anonymize/map `userId` before invocation, or introduce a minimal-field policy at the state layer.

## 4.5 Verified Advantages and Boundaries

### Advantages Already Achieved

- Explicit safety gate (risk guard, rules + LLM dual-layer)
- Structured output and schema constraints (all LLM agents)
- Audit log (decisionLog)
- Thread-level traceability (checkpoint + getState)
- Controlled natural-language completion mechanism (form_completer clarifying questions)

### Known Boundaries

- The rule layer of prompt injection detection covers common patterns but is not complete; the LLM semantic layer is the primary supplement, but evasion is still possible.
- Final plan summary safety detection also uses rule matching + LLM scanning.
- Budget model is LLM-estimated, not a real-time quotation settlement model, so estimation deviation exists.
- Itinerary generation depends on LLM; structural validity does not guarantee semantic correctness.

All above boundaries can be directly observed from the existing codebase.
