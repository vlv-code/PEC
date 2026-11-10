# Current and Active Project Tasks

Coordination registry for tasks and progress between agents and the user.
Before starting work, every agent MUST review the active task list and, if necessary, log subtasks with their authorship.

---

## Team Task Management Rules
1. **Authorship and Timestamp Logging:** Every task and subtask is logged in the format:
   `- [ ] [agent-id @ YYYY-MM-DD HH:MM] Task description`
2. **Delegation (Out-of-Scope Handoff):** If a subtask exceeds the current agent's boundaries, it is logged in "Delegated Subtasks" with the target role (`agent-<role>`).
3. **Step Completion:** Upon completing a task, change the status to `- [x]` and optionally append a 1-line summary result.
4. **Sanctity of Other Agents' Notes:** Agents are prohibited from deleting or modifying entries written by others. Editing is restricted to own entries (status, details). Upon finding an error in another agent's note, present the conflict description with arguments to the user.

---

## Active Objective
- **Task:** Meta-Project Environment Synchronization & Invariant Hardening
- **Initiator:** User
- **Start Date:** 2026-11-10

---

## Execution Plan and Checklist
- [x] [agent-meta-guardian @ 2026-11-10 01:33] Step 1: Sync procedural skills from meta-project repository
- [x] [agent-meta-guardian @ 2026-11-10 01:34] Step 2: Implement Default Deny invariant in boundaries.md and register [theme] category in record-observation
- [x] [agent-meta-guardian @ 2026-11-10 01:35] Step 3: Implement Pre-Flight Flow Tracing in architecture.md and update weak_spots.md
- [x] [agent-meta-guardian @ 2026-11-10 01:36] Step 4: Update AGENTS.md with Circuit Breaker, Pre-Flight Flow Tracing, and Default Deny North Stars
- [x] [agent-meta-guardian @ 2026-11-10 01:37] Step 5: Update all role system prompts (.agents/team/*/system_prompt.md) with Circuit Breaker and Target State Audit
- [x] [agent-meta-guardian @ 2026-11-10 01:54] Step 6: Deploy and register agent-intake-dispatcher role for intake & routing
- [x] [agent-general-worker @ 2026-11-10 03:15] DEV-1: Graceful Shutdown сервера (stopScheduler, SIGTERM/SIGINT, test/gracefulShutdown.test.ts) — проверено тестом test/gracefulShutdown.test.ts
- [x] [agent-general-worker @ 2026-11-10 03:20] DEV-2: Внедрение статического линтера и форматтера Biome (biome.json, package.json) — проверено npm run lint (0 ошибок)
- [x] [agent-general-worker @ 2026-11-10 03:30] DEV-3: Настройка Pre-commit Git-хуков (simple-git-hooks, lint-staged) — проверено блокировкой коммита с ошибкой парсинга
- [x] [agent-devops-infra @ 2026-11-10 09:58] INFRA-1: Сборка и тесты Linux-клиента в CI (.github/workflows/ci.yml: compile-native-linux-client на ubuntu-latest) — проверено валидацией YAML и структурой шагов
- [x] [agent-devops-infra @ 2026-11-10 09:58] INFRA-2: CI-барьер рассинхрона шаблонов (Template Drift Check в verify джобе) — проверено npm run sync:templates и git diff --exit-code
- [x] [agent-devops-infra @ 2026-11-10 09:58] INFRA-3: Автоматизация мониторинга уязвимостей (Dependabot weekly npm/actions + Gitleaks в .github/workflows/security.yml) — проверено валидацией YAML и npm audit
- [x] [agent-security-auditor @ 2026-11-10 10:37] SEC-1: Валидация атомарности завершения и чистоты хранилища (Graceful Shutdown & writeJsonAtomic) — проверено синхронным контрактом, инспекцией каталога data/ и полным сьютом тестов (689 passed)
- [x] [agent-general-worker @ 2026-11-10 11:02] LOG-METRICS-1: Разработка легковесного модуля логирования src/logger.ts (JSON в prod, текст в dev, санитизация секретов) — проверено unit-тестами test/logger.test.ts
- [x] [agent-general-worker @ 2026-11-10 11:02] LOG-METRICS-2: Разработка Prometheus-эндпоинта src/routes/metricsRoutes.ts (клиенты флота, ротации 3x-ui, блокировки rate limit) — проверено unit-тестами test/metrics.test.ts
- [x] [agent-general-worker @ 2026-11-10 11:02] LOG-METRICS-3: Интеграция логгера и роута /metrics в server.ts, src/rotate.ts, src/scheduler.ts, src/instances.ts — проверено полным сьютом тестов (696 passed)
- [x] [agent-devops-infra @ 2026-11-10 12:50] DOCS-CI-1: Создание OpenAPI 3.1 спецификации (docs/openapi.yaml) и шага валидации в .github/workflows/ci.yml, обновление .env.example, README.md, README.ru.md — проверено Redocly CLI и test/openapi.test.ts
- [x] [agent-general-worker @ 2026-11-10 13:50] UI-MODULAR-1: Модуляризация монолита дашборда public/dashboard.js в src/client/dashboard/ (core: api, state, theme, notify; tabs: proxies, routing, studio, telemetry; index), сборка esbuild ("build:ui" в package.json, вывод public/dashboard.min.js), подключение в src/views/dashboardView.ts, валидация Theme Invariant паритета с client/Windows/gui/pec_imgui_theme.h — проверено esbuild, npm run lint и сьютом тестов
- [x] [agent-qa-engineer @ 2026-11-10 14:25] QA-FINAL-UI: Финальное сквозное тестирование декомпозированного UI (test/dashboard*.test.ts, npm run build:ui, npx tsc --noEmit, npm test) — проверено сборкой esbuild (236.5kb), 0 ошибками tsc, 101/101 тестами UI и полным прогоном 717/717 тестов репозитория
- [x] [agent-devops-infra @ 2026-11-10 14:35] CI-INTEGRATION-CLOSE: Интеграция сборки build:ui в общий npm run build и .github/workflows/ci.yml, обновление Code-to-README Truth Parity (README.md, README.ru.md), фиксация и пуш коммита в origin/main — проверено npm run build, Redocly CLI, npm run lint

---

## Delegated Subtasks and Blockers
- [x] [agent-security-auditor -> agent-general-worker @ 2026-11-10 11:26] SEC-FIX-1: Устранение утечек секретов в src/logger.ts (SENSITIVE_KEY_PATTERN, string masking, Basic Auth URLs) и закрытие GET /metrics авторизацией ADMIN_TOKEN по умолчанию (src/routes/metricsRoutes.ts, server.ts) с тестами в test/logger.test.ts и test/metrics.test.ts — проверено тестами test/logger.test.ts, test/metrics.test.ts и npm run lint
