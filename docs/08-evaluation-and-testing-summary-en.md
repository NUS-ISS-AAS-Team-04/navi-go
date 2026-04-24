# 8. Evaluation and Testing Summary

This section provides NaviGo's testing and evaluation summary based on the current `tests/` directory and script configurations.

## 8.1 Test Layers

```
tests/
├── unit/
│   ├── agents/
│   ├── security/
│   └── tools/
├── integration/
│   ├── api.chat-endpoint.test.ts
│   ├── api.frontend-route.test.ts
│   ├── api.plan-endpoint.test.ts
│   └── graph.plan-flow.test.ts
├── redteam/
│   └── guardrails.redteam.test.ts
├── evals/
│   └── travel-planner.eval.ts
└── helpers/
    └── fake-model.ts
```

### Unit

- `tests/unit/agents/budget.agent.test.ts`
- `tests/unit/agents/itinerary.agent.test.ts`
- `tests/unit/agents/risk-guard.agent.test.ts`
- `tests/unit/agents/form-completer.agent.test.ts`
- `tests/unit/agents/requirement-parser.agent.test.ts`
- `tests/unit/security/guardrails.test.ts`
- `tests/unit/tools/http.test.ts`

Goal: Verify single-module logic correctness and error paths.

### Integration

- `tests/integration/graph.plan-flow.test.ts`
- `tests/integration/api.plan-endpoint.test.ts`
- `tests/integration/api.frontend-route.test.ts`
- `tests/integration/api.chat-endpoint.test.ts`

Goal: Verify complete graph flows, API routes (including chat and resume), static resources, and state persistence read behavior.

### Red Team

- `tests/redteam/guardrails.redteam.test.ts`

Goal: Verify guardrail detection capability against known attack vectors (injection, jailbreak, homoglyph, zero-width characters, indirect injection, context manipulation).

### Eval

- `tests/evals/travel-planner.eval.ts`

Goal: Verify "final plan completeness" baseline; gated by `LANGSMITH_API_KEY`.

## 8.2 Key Coverage by Module

| Module | Verified Points (from test code) |
|---|---|
| `requirement-parser.agent.ts` | Natural language field extraction, missing field filtering |
| `form-completer.agent.ts` | Complete form assembly, pending clarification questions generation |
| `risk-guard.agent.ts` | Injection hit/non-hit branches, LLM scan and rule scan merging, risk flag writing |
| `itinerary.agent.ts` | LLM itinerary generation, round-trip flight integration, weather risk propagation, unknown city anchor fallback |
| `budget.agent.ts` | Over-budget/within-budget branches and risk flags |
| `guardrails.ts` | Prompt injection / unsafe output detection, zero-width character and homoglyph normalization |
| `tools/common/http.ts` | Query assembly, timeout interruption and error mapping |
| `graph/builder.ts` + `routes.ts` | Full chain execution, node progression by state, chat resume, thread recovery |
| API routes | `POST /plan`, `POST /plan/chat`, `POST /plan/chat/resume`, `GET /plan/:threadId` behavior and state reading |

## 8.3 Test Strategy Characteristics

### 1) High Repeatability

Tests heavily use:

- `FakeStructuredChatModel`
- `createInMemoryCheckpointer()`
- Itinerary dependency injection (stubbed flight/weather)

Therefore unit and integration tests do not depend on real external APIs, yielding stable results.

### 2) Consistent Boundary Constraints

Test fixtures are generally constructed via schema (e.g., `UserRequestSchema.parse(...)`), ensuring consistency with production input contracts.

### 3) State Machine Verification Priority

Integration tests focus on state graph execution results (`finalPlan`, snapshot, thread recovery, chat resume) rather than internal implementation details, making them suitable for refactoring safety.

### 4) Red Team Informational Logging

`tests/redteam/guardrails.redteam.test.ts` logs known blind spots (e.g., variant verbs, plural forms) informationally without blocking builds, avoiding false positives affecting development velocity while preserving security audit trails.

## 8.4 Current Eval Mechanism

`tests/evals/travel-planner.eval.ts` baseline scoring consists of four items:

- Has summary
- Itinerary non-empty
- PackingList non-empty
- Budget exists

Pass condition: `completenessScore >= 4`.

This is a "structural completeness" evaluation, suitable as a minimum quality threshold.

## 8.5 Enhancement Dimensions Still Possible

The following are recommendations (not fully implemented in current repository):

1. **Relevance evaluation**: Destination/itinerary match with user interests
2. **Budget accuracy evaluation**: Deviation between estimation model and sample real expenses
3. **Security robustness evaluation**: Injection variant corpus regression set (beyond current red-team qualitative logging)
4. **Multi-scenario regression**: Family, multi-person, high-risk weather, no flights, round-trip flight anomalies, etc.
5. **Performance evaluation**: Per-node latency and external API failure rate trends
6. **Chat experience evaluation**: Clarification question quality, multi-turn conversation completion rate

## 8.6 Command Summary

```bash
npm run test:unit
npm run test:integration
npm run test:eval
npm run test
npm run acceptance
```

Red-team tests (require `OPENAI_API_KEY` for LLM-generated variants; static adversarial samples do not):

```bash
npx vitest run tests/redteam/
```

`acceptance` appends live CLI scenario verification when environment variables are satisfied.

## 8.7 Conclusion

Based on existing test code, we can confirm:

- Core planning chain (graph + API, including chat mode) has automated coverage
- Key security links (injection detection, unsafe output detection, red-team adversarial testing) have unit/integration/red-team test coverage
- External dependency call timeout and error mapping have unit test coverage
- Prompt security static analysis and model configuration audit are incorporated into the LLMSecOps pipeline

Meanwhile, current eval remains primarily structural completeness; for higher-reliability scenarios, it is recommended to supplement semantic quality, security robustness quantitative scoring, and performance regression evaluations.
