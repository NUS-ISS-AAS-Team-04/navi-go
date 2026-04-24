# 7. MLSecOps / LLMSecOps Pipeline and Demo

This section describes NaviGo's implemented security and quality pipelines, and locally reproducible demonstration methods.

## 7.1 Local Development and Quality Gates

Project scripts (`package.json`):

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:eval`
- `npm run acceptance`

`acceptance` (`scripts/acceptance.sh`) execution order:

1. `typecheck`
2. `lint`
3. `test:unit`
4. `test:integration`
5. `test:eval`
6. If `OPENAI_API_KEY` + `DUFFEL_API_TOKEN` + `POSTGRES_URL` are all present, execute one live CLI scenario; otherwise print `[blocked]` message.

This guarantees a three-layer gate of "static checks + automated tests + conditional real-chain verification."

## 7.2 CI (GitHub Actions) Status

### `.github/workflows/ci.yml`

#### Job 1: `security-scan` (LLMSecOps)

Enabled:

- `npm audit --audit-level=moderate --omit=dev`
- TruffleHog (secret detection)
- Semgrep (`p/javascript`, `p/typescript`, `p/owasp-top-ten`, `p/cwe-top-25`, `p/ci`, `p/secrets`, `p/supply-chain`)
- SBOM generation and artifact upload

#### Job 2: `checks`

Executes after `security-scan` passes:

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`

#### Job 3: `build`

Executes after `security-scan` and `checks` pass:

- `npm run build`
- Verify `dist/src/index.js` and `public/` exist

#### Job 4: `docker-build-and-scan`

- Build Docker image (no push)
- Trivy scan image and upload SARIF

### `.github/workflows/llmsecops.yml`

Dedicated workflow for LLM application security:

#### Job 1: `ai-sast` (AI SAST)

- Semgrep extended rule sets (including `p/insecure-transport`, `p/xss`, `p/sql-injection`)
- Prompt security static analysis (`scripts/prompt-security-scan.ts`)
  - Scans source code for unsafe template literals, LLM invocations without guardrails, hardcoded system prompt risks, missing output validation, and excessive temperature.

#### Job 2: `ai-supply-chain`

- `npm audit --omit=dev`
- AI dependency security scan (`scripts/ai-dependency-scan.ts`)
  - Scans `package-lock.json` for known AI/ML security advisories (CVE curated list).
- Blocklist check for known compromised packages (`colors`, `faker`, `node-ipc`, `peacenotwar`)

#### Job 3: `llm-redteam`

- Runs red-team adversarial tests (`tests/redteam/guardrails.redteam.test.ts`)
  - Static adversarial samples (classic injection, homoglyph, zero-width characters, indirect injection, jailbreak, context manipulation)
  - LLM-generated novel adversarial variants (requires `OPENAI_API_KEY`)
  - Known blind spots logged informationally (do not block builds)

#### Job 4: `model-config-audit`

- Runs model configuration security audit (`scripts/model-config-audit.ts`)
  - Checks deprecated models, temperature settings, timeout configuration, streaming, structured output, API key management.
- Scans source code for hardcoded API key patterns (OpenAI / Duffel).

## 7.3 CD (GitHub Actions) Status

See `.github/workflows/cd.yml`.

Triggered on `main` branch push or manual dispatch:

1. Build and push GHCR image
2. Trivy scan published image (CRITICAL/HIGH)
3. Generate and upload SBOM
4. Generate and push build provenance attestation

This forms a supply-chain security closed loop from code to image release (scan + SBOM + provenance).

## 7.4 LLM Application-Level Security Controls (Runtime)

### 1) Input and Output Guardrails

- `risk_guard` handles prompt injection detection (rules + LLM dual-layer).
- `plan_synthesizer` handles final summary unsafe output detection (rules + LLM dual-layer).
- Upon risk detection, writes to `safetyFlags` and returns in API response.

### 2) Structuring and Boundary Validation

- All LLM key outputs (preferences, destinations, itinerary, budget, packing, summary) use structured output + schema.
- API request bodies, external API responses, and final plan objects all undergo Zod validation.

### 3) External Call Resilience

`requestJson(...)` provides unified:

- timeout (15s default)
- retries (2 times, exponential backoff)
- abort (AbortController)
- unified error classification (`ToolError`)

### 4) Prompt Security Static Analysis

`scripts/prompt-security-scan.ts` runs in CI, detecting:

- **PROMPT-001**: User input directly interpolated into LLM prompt templates without JSON.stringify.
- **PROMPT-002**: LLM invocation without visible guardrails/safety checks at entry points.
- **PROMPT-003**: Hardcoded system prompts containing manipulation-prone phrases.
- **PROMPT-004**: LLM output used without schema validation or safety screening.
- **PROMPT-005**: Excessive temperature (>0.3) in safety-critical flows.

## 7.5 Observability (LangSmith)

`src/observability/tracing.ts`:

- Enabled when `LANGSMITH_TRACING=true`
- Metadata uniformly injected: `userId` / `threadId` / `scenario` / `service`

Entry points:

- `configureTracingFromEnv()` called when API server starts
- `configureTracingFromEnv()` called before CLI execution

## 7.6 Demo: From Commit to Security Verification

### A. Local Demo

```bash
npm install
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
```

(Optional) If LangSmith is configured:

```bash
npm run test:eval
```

(Optional) If OpenAI + Duffel + Postgres are configured:

```bash
npm run acceptance
```

Prompt security scan and model configuration audit can also run locally:

```bash
npx tsx scripts/prompt-security-scan.ts
npx tsx scripts/ai-dependency-scan.ts
npx tsx scripts/model-config-audit.ts
```

### B. CI/CD Demo (Repository Side)

1. Submit PR -> triggers CI + LLMSecOps
2. Observe `security-scan` (audit / secret / semgrep / SBOM)
3. Observe `ai-sast` (prompt security scan / semgrep extended rules)
4. Observe `ai-supply-chain` (audit / AI dependency scan / blocklist)
5. Observe `llm-redteam` (adversarial test pass rate)
6. Observe `model-config-audit` (model configuration security audit)
7. Observe `checks` (typecheck / lint / unit / integration)
8. Merge to main -> triggers CD
9. Observe image build, Trivy, SBOM, attestation

## 7.7 Recommended Next Steps

- Incorporate `test:eval` into CI as a mandatory or scheduled task (currently mainly environment-gated).
- Add a dedicated lightweight classifier model for prompt injection (rules + LLM + classifier triple layer).
- Add authentication and more fine-grained rate-limiting policies for the API.
- Add lifecycle governance (TTL / archival) for checkpoint data.
- Incorporate red-team detection rate trends into the security dashboard.
