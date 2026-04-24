# 7. MLSecOps / LLMSecOps 流水线与演示

本节描述 NaviGo 当前仓库已实现的安全与质量流水线，以及本地可复现的演示方式。

## 7.1 本地开发与质量门禁

项目脚本（`package.json`）：

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:eval`
- `npm run acceptance`

`acceptance`（`scripts/acceptance.sh`）执行顺序：

1. `typecheck`
2. `lint`
3. `test:unit`
4. `test:integration`
5. `test:eval`
6. 若 `OPENAI_API_KEY` + `DUFFEL_API_TOKEN` + `POSTGRES_URL` 均存在，则执行一次 live CLI 场景；否则打印 `[blocked]` 提示。

这保证了“静态检查 + 自动化测试 + 条件化真实链路验证”三层门禁。

## 7.2 CI（GitHub Actions）现状

### `.github/workflows/ci.yml`

#### Job 1: `security-scan`（LLMSecOps）

已启用：

- `npm audit --audit-level=moderate --omit=dev`
- TruffleHog（secret detection）
- Semgrep（`p/javascript`, `p/typescript`, `p/owasp-top-ten`, `p/cwe-top-25`, `p/ci`, `p/secrets`, `p/supply-chain`）
- SBOM 生成并上传 artifact

#### Job 2: `checks`

在 `security-scan` 通过后执行：

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`

#### Job 3: `build`

在 `security-scan` 与 `checks` 通过后执行：

- `npm run build`
- 验证 `dist/src/index.js` 与 `public/` 存在

#### Job 4: `docker-build-and-scan`

- 构建 Docker 镜像（不推送）
- Trivy 扫描镜像并上传 SARIF

### `.github/workflows/llmsecops.yml`

专用于 LLM 应用安全的独立工作流：

#### Job 1: `ai-sast`（AI SAST）

- Semgrep 扩展规则集（含 `p/insecure-transport`, `p/xss`, `p/sql-injection`）
- Prompt security static analysis（`scripts/prompt-security-scan.ts`）
  - 扫描源码中的不安全模板字面量、缺少护栏的 LLM 调用、硬编码 system prompt 风险、缺少输出校验、温度过高等问题。

#### Job 2: `ai-supply-chain`

- `npm audit --omit=dev`
- AI dependency security scan（`scripts/ai-dependency-scan.ts`）
  - 扫描 `package-lock.json` 中已知 AI/ML 安全公告（CVE curated list）。
- Blocklist check for known compromised packages（`colors`, `faker`, `node-ipc`, `peacenotwar`）

#### Job 3: `llm-redteam`

- 运行红队对抗测试（`tests/redteam/guardrails.redteam.test.ts`）
  - 静态对抗样本（经典注入、homoglyph、零宽字符、间接注入、越狱、上下文操纵）
  - LLM 生成的新颖对抗变体（需 `OPENAI_API_KEY`）
  - 已知盲区信息性记录（不阻断构建）

#### Job 4: `model-config-audit`

- 运行模型配置安全审计（`scripts/model-config-audit.ts`）
  - 检查废弃模型、温度设置、超时配置、streaming、structured output、API key 管理。
- 扫描源码中的硬编码 API key 模式（OpenAI / Duffel）。

## 7.3 CD（GitHub Actions）现状

见 `.github/workflows/cd.yml`。

在 `main` 分支 push 或手动触发时：

1. 构建并推送 GHCR 镜像
2. Trivy 扫描发布镜像（CRITICAL/HIGH）
3. 生成并上传 SBOM
4. 生成并推送 build provenance attestation

这形成了从代码到镜像发布的供应链安全闭环（扫描 + SBOM + provenance）。

## 7.4 LLM 应用级安全控制（运行时）

### 1) 输入与输出护栏

- `risk_guard` 负责 prompt injection 检测（规则 + LLM 双层）。
- `plan_synthesizer` 负责最终摘要 unsafe output 检测（规则 + LLM 双层）。
- 命中风险后写入 `safetyFlags`，并在 API 返回。

### 2) 结构化与边界校验

- LLM 关键输出（偏好、目的地、行程、预算、打包、摘要）全部使用 structured output + schema。
- API 请求体、外部 API 响应、最终计划对象都做 Zod 校验。

### 3) 外部调用鲁棒性

`requestJson(...)` 提供统一：

- timeout（15s 默认）
- retries（2 次，指数退避）
- abort（AbortController）
- 统一错误分类（`ToolError`）

### 4) Prompt 安全静态分析

`scripts/prompt-security-scan.ts` 在 CI 中运行，检测：

- **PROMPT-001**: 用户输入直接插值到 LLM prompt 模板而未 JSON.stringify。
- **PROMPT-002**: 缺少护栏检查的 LLM 调用（入口点级别）。
- **PROMPT-003**: 包含易被操纵短语的硬编码 system prompt。
- **PROMPT-004**: LLM 输出缺少 schema 校验或安全筛选。
- **PROMPT-005**: 温度过高（>0.3）的安全关键流。

## 7.5 可观测性（LangSmith）

`src/observability/tracing.ts`：

- `LANGSMITH_TRACING=true` 时启用
- metadata 统一注入：`userId` / `threadId` / `scenario` / `service`

调用入口：

- API server 启动时调用 `configureTracingFromEnv()`
- CLI 执行前调用 `configureTracingFromEnv()`

## 7.6 演示：从提交到安全验证

### A. 本地演示

```bash
npm install
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
```

（可选）若已配置 LangSmith：

```bash
npm run test:eval
```

（可选）若已配置 OpenAI + Duffel + Postgres：

```bash
npm run acceptance
```

Prompt 安全扫描与模型配置审计也可本地运行：

```bash
npx tsx scripts/prompt-security-scan.ts
npx tsx scripts/ai-dependency-scan.ts
npx tsx scripts/model-config-audit.ts
```

### B. CI/CD 演示（仓库侧）

1. 提交 PR -> 触发 CI + LLMSecOps
2. 观察 `security-scan`（audit / secret / semgrep / SBOM）
3. 观察 `ai-sast`（prompt security scan / semgrep 扩展规则）
4. 观察 `ai-supply-chain`（audit / AI dependency scan / blocklist）
5. 观察 `llm-redteam`（对抗测试通过率）
6. 观察 `model-config-audit`（模型配置安全审计）
7. 观察 `checks`（typecheck / lint / unit / integration）
8. 合并到 main -> 触发 CD
9. 观察镜像构建、Trivy、SBOM、attestation

## 7.7 建议的下一步增强

- 将 `test:eval` 纳入 CI 的必跑或定时任务（当前主要靠环境条件）。
- 增加 prompt injection 专用轻量级分类器模型（规则 + LLM + 分类器三层）。
- 为 API 加入认证与更细粒度限流策略。
- 为 checkpoint 数据增加生命周期治理（TTL / 归档）。
- 将 red-team 检测率趋势纳入安全看板。
