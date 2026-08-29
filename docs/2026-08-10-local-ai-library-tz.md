# Техническое задание: `local-ai` — TS/Capacitor-библиотека офлайн-ассистента

**Дата:** 2026-08-10, §10 синхронизирован 2026-08-11 (обновлено — v6, 2026-08-29: **Electron-десктоп
(Windows/macOS/Linux) переведён из «Non-goals/деградированный режим» в первоклассную (не деградированную)
целевую платформу** — продуктовое решение владельца, закрывает §16 вопрос #4 (`docs/decisions.md` #4,
`Resolved`). Инференс на Electron идёт через **`llama-cpp-pro`'s собственную desktop-подсистему**
(`llama-cpp-pro/desktop` — компилируемый сайдкар-процесс с OpenAI-совместимым HTTP API + GPU-детект/
выбор бэкенда), а не через `node-llama-cpp` (тот остаётся только Node-side тестовым `LlmRuntimePort`-
адаптером, §13.1, без изменений) и не через Capacitor native-мост (которого на Electron нет). Уточнено
позже в тот же день после чтения распакованного `llama-cpp-pro@0.2.4` (не только README) — см. §4.1 для
полной механики и найденный риск (сайдкарный HTTP-клиент пакета не стримит, нужен собственный SSE-путь
для per-token `CompletionStream`). Манифест для десктопа обычно содержит более мощные модели того же
`models[]`/`recommended`-механизма (см. multi-model-план от 2026-08-21) — никакой отдельной схемы не
потребовалось. Правки: §1 Non-goals, §2 (таблица целевой среды), §4.1 (Electron-путь инференса через
`llama-cpp-pro/desktop`, плюс замечание, что раздел уже был устаревшим по имени пакета до ADR 0008),
§6.1 (`PlatformSupportPort`/`getPlatform()` включают `'electron'` как настоящую, не деградированную
платформу; `isPluginAvailable()`'s `inference`-семантика на Electron уточнена — зависит от резолва
бинарника сайдкара, не безусловна). Полный список задач — `ROADMAP.md`'s «Electron desktop support»
раздел. Web (браузер, вне Electron) остаётся деградированным без изменений — это решение только про
Electron;
предыдущее — v5: §10 «Публичный API» сведён с фактической
публичной поверхностью после Phase 8/security-hardening/logging — `ChatSearchApi.searchMessages()`,
`ChatExportApi.exportChat()`/`exportChats()`, `ConversationSyncApi.updateMessage()`/`deleteMessages()`,
`LogExportApi.exportLogs()`/`clearLogs()`, `LocalAiConfig.logging`, `chat-search:fallback-active`
событие — ни один из них не был описан в v4, хотя все реализованы и покрыты тестами; см.
`docs/decisions.md`'s «External consumer feedback review (2026-08-11)», пункт #3, откуда взят этот
апдейт. Никакой из уже описанных v4-контрактов при этом не менялся — только добавлены пропущенные;
ранее — v4: учтена внешняя рецензия `docs/corrections.txt` — явный `CompletionStream` вместо гибридного типа, разделение MVP/advanced conversation API, жёсткая защита от рассинхрона векторного пространства, `releaseRuntime()` вместо `unloadAll()`, параметры сэмплинга и chat-template, политика контекстного окна, семантика отмены/сбоя; ранее — v3: проверка поддержки платформы/плагинов, device eligibility, download-плагин, независимое версионирование эмбеддинга, множественные чаты с внешней синхронизацией истории)
**Статус:** черновик ТЗ для реализации (готов к работе Claude/разработчиков)
**Автор:** составлено на основе `docs/initial/*` + дополнительного исследования
**Целевой читатель:** LLM/разработчик, который будет писать код библиотеки с нуля

> Это ТЗ описывает **отдельную переиспользуемую npm-библиотеку**, а не конкретный экран в конкретном чат-приложении. Она сама по себе не содержит UI-рендеринга, персон/адаптеров и цензурной политики магазинов — это инфраструктурный слой, который любое Capacitor-приложение подключает, чтобы получить: (1) одну LLM-модель, (2) одну embedding-модель к ней (версионируется независимо), (3) их загрузку/обновление/удаление, (4) локальную SQL-БД, (5) множество независимых диалогов («чатов») поверх одной модели — в том числе как зеркало для уже существующей истории приложения, (6) проверку, поддерживается ли вообще текущая платформа/устройство, (7) инференс и (8) управляемую выгрузку из памяти.

---

## 0. Как это ТЗ соотносится с `docs/initial/`

В `docs/initial/` лежат три independent исследования, сделанные для другого контекста (Forta Chat, мультичатовое приложение с LoRA-персонами). Часть решений оттуда переиспользуется, часть — сознательно отбрасывается, потому что нынешняя задача уже про другое: **библиотеку**, а не про фичу внутри конкретного мессенджера.

| Решение из `docs/initial` | Статус в этом ТЗ | Причина |
|---|---|---|
| `llama-cpp-capacitor` как native-рантайм | ✅ переиспользуем как кандидат №1 (после спайка, §4.1) | единственный найденный Capacitor-плагин с `completion` + `embedding` + LoRA + download из коробки |
| Hugging Face, `resolve/<commit-sha>/<file>`, `main` запрещён | ✅ переиспользуем для модели | воспроизводимость, защита от подмены файла под тем же URL |
| Манифест как JSON-каталог, не хардкод | ✅ переиспользуем, но схема пересмотрена (§5) — модель и эмбеддинг версионируются **независимо** | эмбеддинг может обновляться чаще модели |
| `sha256` + immutable filenames | ✅ переиспользуем | базовая целостность скачанного бинарника |
| Собственный resumable-download на Range-запросах | ⚠️ пересмотрено — теперь резервная/тестовая реализация, основная — готовый плагин (§4.4, §7) | `Cap-go/capacitor-downloader` решает то же на уровне ОС-загрузчика надёжнее самодельного JS-цикла |
| **Device tier `low/mid/high`** | ❌ по-прежнему не делаем | правила «4 GB = low» устаревают без релиза; вместо тиров — декларативные `minRamGb`/`recommendedRamGb` в манифесте + `canRun()`, см. §6 |
| **`canRun` eligibility / `@capgo/capacitor-device-info`** | ✅ **теперь в объёме v1** (в первой версии этого ТЗ было отложено в необязательную Phase 7) | пользователь явно попросил учитывать слабые устройства — см. §6 |
| **LoRA-адаптеры = отдельные чаты** | ❌ убрано как *механизм персон* | пользователь явно сказал: «адаптеров не будет» |
| **Несколько диалогов/«чатов»** | ✅ в объёме, включая режим «библиотека как зеркало для уже существующей истории приложения» | явное требование пользователя, см. §9 |
| **Каналы распространения / `contentRating` / цензура по store** | ❌ убрано из ядра библиотеки | политика конкретного приложения-потребителя |
| **Chat UI (компоненты, вкладки, рендер)** | ❌ убрано | UI-слой конкретного приложения; библиотека даёт данные/API/события |
| **Dexie/Matrix как модель хранения истории** | ❌ убрано | своя SQLite-схема для чатов внутри самой библиотеки (§9), без привязки к Matrix |
| **Knowledge packs / RAG-оркестрация** | ⚠️ библиотека даёт *примитивы* (embedding + векторный поиск в SQL), не готовый RAG-пайплайн | сборка промпта — на стороне приложения |
| Multilingual-only модели (Qwen3 семейство) | ✅ переиспользуем как ориентир для дефолтного манифеста | совпадает с требованием впрямую |

---

## 1. Цель и контекст

Сделать npm-библиотеку на TypeScript (`local-ai`, финальное имя пакета — открытый вопрос §16), которая подключается в любое Capacitor-приложение (Android/iOS, native; частично — web) и даёт:

1. Инициализацию и инференс **одной** LLM-модели (изначально ~**4B**, Q4_K_M, мультиязычная), заменяемой в будущем через манифест.
2. Инициализацию и инференс **одной** embedding-модели, привязанной к текущей LLM-модели по совместимости (версия эмбеддинга обновляется независимо и чаще, см. §5).
3. Скачивание модели с **Hugging Face** (pinned revision) и эмбеддинга **по произвольному URL**, оба — с **возобновляемой (resumable) загрузкой** поверх готового Capacitor-плагина загрузок (§4.4).
4. Инициализацию и удобную работу с **локальной SQLite-БД**, включая хранение/поиск векторов эмбеддингов и хранение множества чатов.
5. Управление файлами модели и эмбеддинга через `@capacitor/filesystem` + download-плагин: перекачка новой версии, удаление устаревшей — независимо для модели и для эмбеддинга.
6. **Множество независимых диалогов («чатов»)** поверх одной загруженной модели — создание, список, переименование, удаление, история сообщений; в том числе режим, где источник истины — сама история чатов приложения-потребителя, а библиотека лишь идемпотентно синхронизирует нужный контекст (§9.6).
7. **Проверку поддерживаемости**: доступна ли библиотека вообще на текущей платформе/сборке (нет ли, например, попытки запуска в вебе без нужных нативных плагинов) и по какой причине — до того, как приложение попытается что-то скачать или загрузить в память (§6).
8. **Проверку пригодности устройства** (device eligibility): хватает ли RAM/диска/термически ли устройство готово тянуть выбранную модель — с исследованными и явно задокументированными критериями (§6).
9. Полную и явную **выгрузку всего из памяти** (LLM-контексты, SQL-соединения, кеши) по вызову разработчика — в том числе из хуков `unfocus/focus`.
10. Автотесты, по возможности исполняемые в среде Node.js (см. §13 — где это возможно, а где принципиально нет).
11. JSDoc на публичном API + читаемую документацию для разработчиков-потребителей библиотеки.

### Non-goals (явно не входит в v1)

- Рендеринг UI (список чатов, экран настроек, progress-виджеты, пузыри сообщений) — библиотека отдаёт данные/события, рисует потребитель.
- LoRA-адаптеры, персоны как механизм смены поведения модели.
- Несколько одновременно загруженных **моделей** / выбор пользователем из каталога — манифест описывает одну актуальную модель (много **чатов** при этом — да; это не то же самое, что несколько моделей).
- Фиксированные device-тиры (`low/mid/high`) — вместо них декларативные пороги + измерение конкретного устройства, см. §6.
- Готовый RAG-пайплайн (chunking, ranking, prompt-assembly) — только строительные блоки (embedding + vector search).
- Синхронизация чатов между устройствами / бэкап в облако.
- Полноценный инференс в браузерном Web (не Electron) — остаётся деградацией/заглушкой (см. §4.1, §6),
  программно детектируемой через `checkSupport()`, а не просто документированной словами.
  **Electron-десктоп (Windows/macOS/Linux) выведен из этого пункта v6 (2026-08-29,
  `docs/decisions.md` #4) — там инференс полноценный**, см. §2/§4.1/§6.1 и `ROADMAP.md`'s «Electron
  desktop support».
- Цензурные каналы дистрибуции, возрастные тумблеры, App Store/Play policy-логика.

---

## 2. Целевая среда и стек

| Параметр | Значение |
|---|---|
| Язык | TypeScript, `strict: true`, ES2022 target, публикуется как ESM + CJS (dual build) |
| Платформа-хост | Capacitor **8.x** (peer dependency, `>=8.0.0`) |
| Целевые ОС | Android (minSdk по требованиям native-плагина инференса, обычно 24+), iOS 15+, **Electron-десктоп: Windows/macOS/Linux (v6, 2026-08-29 — см. ниже)** |
| Electron (v6, 2026-08-29) | **Первоклассная (не деградированная) платформа** — `docs/decisions.md` #4, `Resolved`. Полный набор возможностей, включая `inference`, доступен через отдельный набор Node-адаптеров, исполняемых в Electron **main-процессе** (не в renderer — там нет прямого доступа к нативным биндингам без собственного IPC-моста хост-приложения, который остаётся вне ответственности библиотеки, как и любой другой UI/bridge-слой). Инференс — не через `llama-cpp-capacitor` (тот требует Capacitor native-мост, Android/iOS-only), а через `node-llama-cpp` напрямую (тот же путь, что §13.1 всегда описывал как Node-side test-адаптер, здесь становится продакшен-адаптером). Манифест для десктопных сборок обычно перечисляет более мощные модели в том же `models[]` (multi-model-манифест, 2026-08-21) — eligibility (§6.2) по факту большего `totalRamGb` десктопа сама выбирает их как проходные, отдельная схема манифеста не нужна. Детали и разбивка задач — `ROADMAP.md`'s «Electron desktop support». |
| Web (браузер, не Electron) | Деградированный режим, без изменений: библиотека не падает при импорте; `checkSupport()` (§6.1) явно сообщает, какие возможности недоступны. Инференс на web в v1 не работает (§4.1); SQL/Download/Conversations — потенциально доступны, если используемые плагины сами поддерживают web (уточняется по каждому плагину в Phase 0) |
| Пакетный менеджер разработки | pnpm (workspaces, если решим на монорепо — см. §16) |
| Сборка | `tsup` или `unbuild` → ESM/CJS/`d.ts`, sourcemaps |
| Тесты | Vitest или Jest (см. §13) — выбрать один, не смешивать |
| Линт | ESLint + `@typescript-eslint` + `eslint-plugin-jsdoc` (обязательный JSDoc на экспортируемых символах) |
| Документация | TypeDoc → markdown/HTML сайт из JSDoc + ручной README/гайды |

---

## 3. Архитектура: hexagonal (ports & adapters)

Это ключевое архитектурное решение, которое делает возможным требование «автотесты из Node.js». Вся бизнес-логика библиотеки **не обращается напрямую к Capacitor-плагинам** — она работает через порты (интерфейсы), а конкретные реализации (адаптеры) подставляются снаружи.

```text
┌───────────────────────────────────────────────────────────────────────┐
│                          @local-ai/core                                 │
│  (чистый TS, ноль импортов из @capacitor/*, 100% тестируем в Node)     │
│                                                                           │
│   SupportChecker ← новое   ManifestService     ModelRegistry            │
│   EligibilityService ← новое   Database         VectorStore             │
│   DownloadEngine            ConversationStore                          │
│   RuntimeFacade             LifecycleManager                            │
│                                                                           │
│   зависит только от портов:                                             │
│   PlatformSupportPort ← новое · DeviceInfoPort ← новое ·                │
│   DownloadTransportPort · FileSystemPort · SqlitePort ·                │
│   LlmRuntimePort · ClockPort · HashPort · AppLifecyclePort             │
└───────────────┬───────────────────────────────┬─────────────────────────┘
                │                               │
   реализация для прод (Capacitor)     реализация для тестов (Node)
                │                               │
┌───────────────▼────────────────────┐  ┌────────▼──────────────────────────┐
│ @local-ai/capacitor-adapters         │  │ (в devDependencies core-пакета)   │
│  - CapacitorPlatformSupportAdapter    │  │  - FakePlatformSupportAdapter     │
│    (Capacitor.isPluginAvailable и т.п)│  │  - FakeDeviceInfoAdapter          │
│  - CapgoDeviceInfoAdapter             │  │  - NodeRangeDownloadAdapter       │
│    (@capgo/capacitor-device-info)     │  │  - NodeFsAdapter (node:fs)        │
│  - CapgoDownloaderAdapter             │  │  - BetterSqliteAdapter             │
│    (@capgo/capacitor-downloader)      │  │    (+ sqlite-vec npm)              │
│  - CapacitorFsAdapter                 │  │  - NodeLlamaCppAdapter             │
│    (@capacitor/filesystem)            │  │    (node-llama-cpp, опц.)          │
│  - CapacitorSqliteAdapter             │  │  - FakeClock / WebCrypto Hash      │
│    (@capacitor-community/sqlite)      │  │                                    │
│  - LlamaCppCapacitorAdapter           │  │                                    │
│    (llama-cpp-capacitor)              │  │                                    │
│  - CapacitorAppLifecycleAdapter       │  │                                    │
│    (@capacitor/app)                   │  │                                    │
└─────────────────────────────────────┘  └───────────────────────────────────┘
```

### 3.1 Пакетная структура

Рекомендация — **один npm-пакет** с subpath-экспортами (проще для потребителя, меньше версийного разъезда, чем монорепо из нескольких пакетов):

```text
local-ai/
  src/
    core/                     # чистая логика, только порты
      ports/
        platform-support.port.ts    # НОВОЕ
        device-info.port.ts          # НОВОЕ
        download-transport.port.ts
        filesystem.port.ts
        sqlite.port.ts
        llm-runtime.port.ts
        clock.port.ts
        hash.port.ts
        app-lifecycle.port.ts
      support/                       # НОВОЕ, см. §6
        support-checker.ts
        eligibility-service.ts
      manifest/
        manifest.schema.ts
        manifest.service.ts
        manifest.diff.ts
      download/
        download-engine.ts
        download-state.ts
        checksum.ts
      registry/
        model-registry.ts
      db/
        database.ts
        migrations/
        vector-store.ts
      conversations/
        conversation-store.ts
        session-cache.ts
      runtime/
        runtime-facade.ts
        lifecycle-manager.ts
      client/
        local-ai-client.ts
      errors.ts
      types.ts
    adapters/
      capacitor/
        capacitor-platform-support.adapter.ts   # НОВОЕ
        capgo-device-info.adapter.ts             # НОВОЕ
        capgo-downloader.adapter.ts
        capacitor-fs.adapter.ts
        capacitor-sqlite.adapter.ts
        llama-cpp-capacitor.adapter.ts
        capacitor-app-lifecycle.adapter.ts
        index.ts
      node-testing/
        fake-platform-support.adapter.ts         # НОВОЕ
        fake-device-info.adapter.ts               # НОВОЕ
        node-range-download.adapter.ts
        node-fs.adapter.ts
        better-sqlite.adapter.ts
        node-llama-cpp.adapter.ts
        fake-clock.adapter.ts
  test/
    unit/
    integration/
    contract/
    device-e2e/
  docs/
  examples/
    minimal-capacitor-app/
  package.json
```

---

## 4. Native-слой: выбор Capacitor-плагинов

### 4.1 Инференс (LLM + embedding)

**Кандидат №1 (выбран): `llama-cpp-capacitor`** (пакет `arusatech/llama-cpp` на npm, версия на момент исследования — `0.1.5`). Даёт из коробки `initLlama`, `completion` (стрим), `embedding`, `release`/`releaseAllLlama`, `stopCompletion`, `saveSession`/`loadSession` (используется механикой множественных чатов, §9.3), `loadLlamaModelInfo`. LoRA есть в API, но библиотека им **не пользуется**. **Web не поддержан** в 0.1.5 — прямое следствие для §6 (checkSupport должен явно об этом сообщать).

**Переименован в `llama-cpp-pro` (2026-08-20, ADR 0008)** — тот же проект/автор, тот же API
(`docs/adr/0008-llama-cpp-pro-migration.md`: «Same project, renamed» — `CHANGELOG.md`'s `[Unreleased]`
секция подтверждает переезд репозитория с `llama-cpp-capacitor`/`annadata-llama-cpp`). Адаптер
(`src/adapters/capacitor/llama-cpp-capacitor.adapter.ts`, класс `LlamaCppCapacitorAdapter` — имя файла/
класса **не переименовано**, только источник импорта; переименование самого адаптера не сделано,
т.к. это публичный экспорт и правило CLAUDE.md требует не трогать такое без явного запроса) и
зависимость в `package.json` уже используют `llama-cpp-pro@^0.2.4`. Везде ниже по документу и в
`ROADMAP.md`, где написано `llama-cpp-capacitor`, имеется в виду этот же пакет под текущим именем —
исторические записи (ADR 0001, `ROADMAP.md`'s Phase 0 task 0.1) оставлены как есть, это точный отчёт
о том, что было верно на момент спайка 2026-08-10, до переименования.

**Electron (v6, 2026-08-29; архитектура уточнена 2026-08-29 после чтения распакованного
`llama-cpp-pro@0.2.4`, не только README):** `llama-cpp-pro` **сам заявляет и реализует** поддержку
Electron — не как обёртку над Capacitor native-мостом (которого на Electron нет и не может быть), а
через собственную desktop-подсистему пакета (`llama-cpp-pro/desktop`): компилируемый из исходников
(`sidecar/CMakeLists.txt` + `cap-sidecar-main.cpp`) **сайдкар-процесс** — локальный HTTP-сервер с
OpenAI-совместимым API (`POST /v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, плюс
служебные `/v1/internal/models/load`, `DELETE /v1/internal/models/:id`, `/v1/internal/context-limit`,
`/v1/internal/memory`, `GET /health`), которым управляет `sidecar-manager.cjs` (старт/стоп/health-poll),
а общается с ним `sidecar-client.cjs` — тонкий Node-`http`-клиент на `127.0.0.1:{port}`. Отдельно пакет
детектирует GPU (`gpu-probe.cjs`: `nvcuda.dll`/`libcuda.so` для CUDA, `vulkan-1.dll`/`libvulkan.so` для
Vulkan, Metal — всегда на macOS) и выбирает бинарный вариант сайдкара под конкретный бэкенд
(`backend-selector.cjs`: `metal`/`cuda`/`vulkan`/`vulkan-openblas`/`cuda-openvino`/`metal-coreml`/ROCm),
с ручным оверрайдом пользователя. Своя `desktop/electron-builder.config.cjs` и
`scripts/stage-desktop-resources.cjs` дают готовый (но не автоматический — бинарники под каждую ОС/
архитектуру/бэкенд нужно **собрать заранее** через пакетный `build-variants.sh --variant desktop`)
рецепт упаковки через `electron-builder`.

**Следствие для `local-ai`'s `LlmRuntimePort`:** это НЕ переиспользование `node-llama-cpp` (Node-side
тестовый адаптер §13.1 остаётся тестовым инструментом, не продакшен-путём для Electron — эта запись
исправляет ошибочное предположение более ранней версии этого раздела). Электронный адаптер — новый
(не промоушен существующего Node-testing адаптера), оборачивающий `llama-cpp-pro/desktop`'s
`detectBackend()`/`createSidecarManager()`/`createSidecarClient()` напрямую, минуя Capacitor-JS-слой
плагина (тот нужен только приложениям, гоняющим единый Capacitor-бридж на всех платформах; `local-ai`
и так исполняется в Electron main-процессе, см. §6.1). **Важная находка:** `sidecar-client.cjs`'s
`chatCompletion()`/`completion()` — небуферизованные (собирают весь HTTP-ответ целиком через
`res.on('data')`+`Buffer.concat`, затем один `JSON.parse`) — то есть **не стримят**. Пословный
(per-token) `CompletionStream` (TZ-требование, подтверждено визуально на Android — см.
`docs/decisions.md`) на Electron потребует собственного SSE-клиента адаптера поверх того же
`/v1/chat/completions?stream=true`, а `sidecar-client.cjs` использовать только для нестримингового
admin-API (`loadModel`/`unloadModel`/`memory`/`setContextLimit`/`health`) — не подтверждено, что
`stream: true` вообще поддерживается сайдкаром на уровне HTTP; открытый вопрос, см.
`docs/decisions.md` ленджер #23.

`PlatformSupportPort.isPluginAvailable()`/`capabilities.inference` на Electron — не безусловный `true`:
зависит от того, резолвится ли `llama-cpp-pro/desktop`'s `resolveBinaryPath()`/`assertSidecarBinary()`
для текущих OS/arch (собранный ли под них бинарник сайдкара вообще заложен в упакованное приложение),
см. §6.1.

Полная разбивка задач и спайков (сборка сайдкара под три ОС, стриминг, лицензия/происхождение
бинарников) — `ROADMAP.md`'s «Electron desktop support», Phase 0.

`LlmRuntimePort` не содержит LoRA-специфичных полей — замена нативного плагина не потребует переписывать бизнес-логику.

**Chat template — не забота приложения.** `complete()`/`sendMessage()` (§10) принимают только структурированные `messages: { role, content }[]`, библиотека **никогда** не отдаёт наружу API для склеивания сырого текстового промпта. Разные семейства моделей (Qwen, Llama, Gemma, Mistral) форматируют историю по-разному (спецтокены, порядок ролей, system-обёртка), и это не должно быть обязанностью кода приложения — иначе смена модели в манифесте молча ломает качество ответов у всех потребителей библиотеки. Механизм (уточняется в Phase 0 спайке):

1. **Основной путь** — GGUF-файлы, сконвертированные из HF, обычно несут `tokenizer.chat_template` (Jinja2) прямо в метаданных; сам `llama.cpp` умеет применять такой шаблон нативно (`llama_chat_apply_template`, свой Jinja-движок `minja`, без Python). Если native-плагин (`llama-cpp-pro`, см. выше) принимает `messages` и сам вызывает эту машинерию — библиотеке достаточно передавать `messages` как есть.
2. **Фолбэк** — если плагин этого не делает или GGUF не несёт шаблон, `ModelArtifact.chatTemplate` (§5.2) явно называет пресет (`'qwen'`/`'llama3'`/`'gemma'`/`'mistral'`/`'raw'`), и `RuntimeFacade` сама собирает форматированный промпт по небольшому встроенному реестру шаблонов перед вызовом низкоуровневого `prompt`-режима плагина.

Поток всегда: `messages` + `ModelArtifact` → `RuntimeFacade` (выбирает механизм 1 или 2) → нативный плагин. Приложение видит только `messages` на входе и токены/финальное сообщение на выходе.

### 4.2 SQLite

**Кандидат: `@capacitor-community/sqlite`** (~8.x). Даёт `loadExtension()`/`enableLoadExtension()` для `sqlite-vec`. ⚠️ Загрузка runtime-расширений на iOS — риск, спайк в Phase 0, фолбэк — §8.3.

### 4.3 Файлы

**`@capacitor/filesystem`** — путь назначения для download-плагина, удаление старых версий, orphan cleanup, чтение чанками для потокового SHA-256 (§7.4), хранение session-cache файлов (§9.3).

### 4.4 Скачивание — `@capgo/capacitor-downloader`

Основной транспорт (детали — §7). Обёртка над нативными ОС-загрузчиками (Android DownloadManager-класс механизмов, iOS фоновые `URLSession`) — переживает сворачивание приложения, чего самодельный JS Range-цикл дать не может. Не делает `sha256`-верификацию и не даёт байтовый прогресс (только `progress: 0–100`) — это остаётся зоной ответственности `local-ai`. MPL-2.0. Открытые вопросы (переживает ли задача убийство процесса, точный формат `destination`) — Phase 0 спайк.

### 4.5 Device Info — `@capgo/capacitor-device-info`

Нужен библиотеке для двух вещей: (а) собственно eligibility-проверки (§6.2), (б) части `checkSupport()` (§6.1). Проверено дополнительно:

- **`getInfo()`** — снимок CPU/памяти/GPU/storage/thermal/low-power-mode/сенсоров одним вызовом; **`startMonitoring()`** — периодические снимки.
- Android: температура батареи/ambient, best-effort CPU/GPU thermal zones.
- iOS: `thermalState`, low-power-mode; **публичного API температуры CPU/GPU на iOS нет** — это платформенное ограничение самой ОС, не плагина.
- Не требует runtime-разрешений для используемых нами метрик.

**Официальный `@capacitor/device`** (часть core-плагинов) — не подходит как единственный источник: даёт `memUsed` только для процесса приложения, а не total/free RAM системы (см. также `docs/initial`). Может использоваться как дополнительный источник платформенных метаданных (`Device.getInfo()` — модель, OS-версия), но не заменяет `@capgo/capacitor-device-info` для eligibility.

**Плагин помечен как soft-dependency**, а не hard-required: если он недоступен (не установлен, платформа не поддерживает) — `DeviceInfoPort` возвращает `null`/недоступность, `EligibilityService` деградирует до вердикта `'unknown'` вместо падения (§6.2).

### 4.6 App lifecycle

**`@capacitor/app`** — `App.addListener('appStateChange', ...)`. Используется опционально самим потребителем или встроенным `LifecycleManager`, если включена настройка `autoUnloadOnBackground` (§11).

---

## 5. Манифест: модель и эмбеддинг версионируются независимо

### 5.1 Почему не «пара»

Модель и эмбеддинг — два **независимых** top-level поля манифеста, каждое со своей версией/историей; совместимость декларируется явно полем `compatibleModelIds` у эмбеддинга; события «модель изменилась» и «эмбеддинг изменился» различаются (`ManifestDiff.modelChanged`/`embeddingChanged`) — два разных независимых потока скачивания/переключения (§5.4–5.5).

### 5.2 Схема

```ts
export interface LocalAiManifest {
  manifestVersion: number;
  publishedAt: string;
  model: ModelArtifact;
  embedding: EmbeddingArtifact;
  previousModels?: ModelArtifact[];
  previousEmbeddings?: EmbeddingArtifact[];
}

export interface ModelArtifact {
  id: string;
  version: number;
  displayName: string;
  family: string;
  paramsB: number;                // 4
  quant: string;                  // "Q4_K_M"
  languages: 'multilingual';
  contextLength: number;
  source: HuggingFaceSource;
  filename: string;               // model__<id>__v<version>.gguf
  sha256: string;
  sizeBytes: number;
  /** Пороги eligibility, см. §6.2 — обязательны, не опциональны (в отличие от v1-черновика). */
  minRamGb: number;
  recommendedRamGb: number;
  /** 'auto' (по умолчанию) — доверять chat_template из метаданных GGUF/нативному плагину (§4.1).
   *  Явный пресет — фолбэк, если модель/плагин не несёт корректный шаблон. */
  chatTemplate: 'auto' | 'qwen' | 'llama3' | 'gemma' | 'mistral' | 'raw';
  status: 'active' | 'deprecated';
}

export interface EmbeddingArtifact {
  id: string;
  version: number;                          // растёт НЕЗАВИСИМО от model.version
  compatibleModelIds: string[];
  dimensions: number;
  source: UrlSource;
  filename: string;                         // embedding__<id>__v<version>.gguf
  sha256: string;
  sizeBytes: number;
  minRamGb: number;
  recommendedRamGb: number;
  status: 'active' | 'deprecated';
}

export interface HuggingFaceSource {
  type: 'huggingface';
  repo: string;
  revision: string;                // ОБЯЗАТЕЛЬНО commit SHA, "main" запрещён валидацией
  file: string;
}

export interface UrlSource {
  type: 'url';
  url: string;                     // произвольный HTTPS-URL
}
```

Валидация: `model.source.revision` не `"main"`/`"HEAD"`/пусто; `embedding.source.url` начинается с `https://`; `embedding.compatibleModelIds.includes(model.id)`; `sha256` — валидный hex64 у обоих; `sizeBytes > 0` у обоих; `model.paramsB <= maxModelParamsB` (по умолчанию 4, конфигурируемо); `minRamGb > 0`, `recommendedRamGb >= minRamGb` у обоих. При провале — манифест не принимается, используется кэш, событие `manifest:invalid`.

### 5.3 Жизненный цикл манифеста

`previousModels[]`/`previousEmbeddings[]` не копятся (рекомендация — не больше 1 записи каждый). Манифест целиком кэшируется с `ETag`/`Last-Modified` (SQL kv-таблица, §8.1). Библиотека не выбирает между несколькими моделями — просто следует манифесту.

### 5.4 Поток обновления

```text
refreshManifest()
  → fetch manifestUrl (If-None-Match: cachedEtag)
  → 304 → вернуть cached, ManifestDiff { modelChanged: false, embeddingChanged: false }
  → 200 → validate → сравнить installed.modelVersion / installed.embeddingVersion
       ManifestDiff { modelChanged, embeddingChanged, from: {...}, to: {...} }
```

Скачивание не стартует автоматически по факту diff — решение принимает потребитель.

### 5.5 Обновление модели (безопасный порядок)

```text
1. checkDeviceEligibility(newModel) → если 'no' и policy='block' → отказ до скачивания (§6.2)
2. downloadArtifact(newModel)                // resumable, §7
3. verify sha256
4. runtime: release ТОЛЬКО LLM-контекст (эмбеддинг-контекст не трогаем)
5. registry.setCurrentModel(newModel)
6. Filesystem: удалить файл старой модели
7. Все session-cache файлы (§9.3) инвалидируются — KV-состояние несовместимо
   с новыми весами. История сообщений в SQL НЕ трогается.
```

### 5.6 Обновление эмбеддинга (безопасный порядок, независимо от модели)

```text
1. checkDeviceEligibility(newEmbedding)
2. downloadArtifact(newEmbedding)
3. verify sha256
4. runtime: release ТОЛЬКО embedding-контекст (LLM-контекст не трогаем)
5. registry.setCurrentEmbedding(newEmbedding)
6. Filesystem: удалить файл старого эмбеддинга
7. Событие `vector-store:embedding-changed` — библиотека НЕ удаляет и НЕ
   пересчитывает существующие вектора сама, даже если dimensions совпали:
   другая версия эмбеддера не гарантирует то же векторное пространство.
   С этого момента `VectorStore.upsert()`/`search()` начинают сравнивать
   текущий активный эмбеддинг с тем, что записано в `vector_space` (§8.2) —
   при несовпадении бросают `VectorSpaceMismatchError`, а не тихо ищут по
   устаревшим векторам. Разблокировать можно только явным `vectors.reindex()`
   (стереть + переиндексировать) — событие даёт ранний сигнал, guard в
   `VectorStore` даёт гарантию.
```

---

## 6. Поддержка платформы и совместимость устройства

Пользовательский запрос: «есть ли все необходимые плагины Capacitor, может мы вообще в вебе запускаем» + «может у нас устройство слабое — надо проверить device info». Это два **разных** вопроса, и они разведены в разные проверки:

| Вопрос | Проверка | Меняется ли между запусками на одном устройстве? |
|---|---|---|
| Может ли библиотека вообще функционировать здесь (платформа + установлены ли нужные нативные плагины)? | `checkSupport()` (§6.1) | Нет — зависит от сборки приложения, не от текущего состояния железа |
| Достаточно ли конкретно **этого** устройства прямо сейчас (RAM/диск/термо) для конкретной модели из манифеста? | `checkDeviceEligibility()` (§6.2) | Да — RAM/диск/температура меняются в моменте |

### 6.1 `checkSupport()` — платформа и доступность плагинов

Порт:

```ts
export interface PlatformSupportPort {
  /** True на Android/iOS native-сборках **и** на Electron main-процессе (v6, 2026-08-29 —
   *  `docs/decisions.md` #4); false на браузерном web (не Electron). */
  isNativePlatform(): boolean;
  getPlatform(): 'ios' | 'android' | 'web' | 'electron' | string;
  /** Обёртка над Capacitor.isPluginAvailable(name) — официальный, задокументированный
   *  способ Capacitor проверить, зарегистрирован ли нативный плагин в текущей сборке.
   *  На Electron нет Capacitor native-моста/плагинов вообще — `ElectronPlatformSupportAdapter`
   *  (см. ROADMAP.md's «Electron desktop support») не оборачивает `isPluginAvailable`, а
   *  проверяет каждую capability по своим правилам: `sql`/`download`/`fs` — всегда `true`
   *  (чистый Node, всегда доступен в main-процессе); `inference` — зависит от того, резолвится
   *  ли `llama-cpp-pro/desktop`'s `assertSidecarBinary()` для текущих OS/arch (собран ли под
   *  них бинарник сайдкара и заложен ли в упакованное приложение, §4.1) — то есть **не**
   *  безусловный `true`, в отличие от `sql`/`download`/`fs`. */
  isPluginAvailable(pluginName: string): boolean;
}
```

Продакшен-адаптер — тонкая обёртка над `Capacitor.isNativePlatform()` / `Capacitor.getPlatform()` / `Capacitor.isPluginAvailable()` (официальный Capacitor core API, ничего самодельного). Точные строковые имена регистрации каждого нативного плагина (`'LlamaCpp'`, `'CapacitorSQLite'`, `'CapacitorDownloader'`, `'Filesystem'`, `'DeviceInfo'` — иллюстративно) нужно свести в константу и **подтвердить в Phase 0 спайке** — они определяются самим плагином, не нами.

```ts
export type Capability = 'inference' | 'sql' | 'vectorSearch' | 'download' | 'deviceInfo';

export interface SupportReport {
  platform: 'ios' | 'android' | 'web' | 'electron' | 'unknown';
  isNative: boolean;
  capabilities: Record<Capability, boolean>;
  missingPlugins: Array<{ capability: Capability; pluginName: string; required: boolean }>;
  /** Человекочитаемые причины — для логов/сообщения пользователю. Стабильные codes — в errors. */
  reasons: string[];
}

export class LocalAiClient {
  /** Не требует manifestUrl/сети — чистая проверка окружения. Можно вызывать
   *  до LocalAiClient.create(), чтобы решить, стоит ли вообще пытаться. */
  static async checkSupport(ports?: Partial<Pick<LocalAiPorts, 'platformSupport'>>): Promise<SupportReport>;
}
```

Правило деградации: `inference` требует **и** native-платформу (не web), **и** доступность LLM-плагина — если хотя бы одно не выполняется, `capabilities.inference === false`, с явной причиной (`"platform 'web' does not support llama-cpp-capacitor"` или `"required plugin LlamaCpp is not available"`). `sql`/`download` могут остаться `true` на web, если соответствующие плагины сами заявляют web-поддержку (уточняется в Phase 0 per-plugin) — то есть **не** блокируем всю библиотеку по факту web, а даём точную картину по каждой возможности отдельно. `deviceInfo` отсутствие — не блокирует остальное, просто отключает eligibility (§6.2).

`ensureReady()`/`ensureModelReady()` внутри себя **обязаны** вызвать `checkSupport()` и бросить `PlatformNotSupportedError` с деталями из `reasons`, если `capabilities.inference === false`, — не позволяя дойти до непонятной ошибки глубоко в нативном мосте.

### 6.2 Device Eligibility — критерии

**Исследование и обоснование критериев** (поскольку явного стандарта нет, критерии зафиксированы здесь как решение библиотеки, подлежащее калибровке на реальных устройствах в Phase 0):

| Параметр | Значение по умолчанию | Обоснование |
|---|---|---|
| `minRamGb` для 4B Q4_K_M (~2.2–2.9 GB файл) | **4 GB** total RAM устройства | ниже этого порога процесс, скорее всего, не помещается в память одновременно с ОС и приложением-хостом |
| `recommendedRamGb` для 4B Q4_K_M | **8 GB** total RAM устройства | независимые источники сходятся на «минимум 8 GB рекомендуется для телефонов, гоняющих модели 3–4B» — комфортный порог без троттлинга по памяти |
| Общая формула для будущих моделей (при заполнении манифеста) | `minRamGb ≈ ceil(sizeGB × 1.5)`, `recommendedRamGb ≈ ceil(sizeGB × 2.5)` | эмпирика: веса + KV-кеш при типичном `n_ctx` + запас ОС/приложения-хоста |
| Запас свободного диска перед скачиванием | `freeDiskBytes ≥ sizeBytes × 1.15` | место под сам файл + временный `.part` (§7), не впритык |
| Порог «слишком медленно» (`tooSlow`) | `tgAvg < 3 tok/s` по локальному `bench()` после первой загрузки | ниже — UX чата неприемлем; конфигурируемо (`tooSlowTokPerSec`) |
| Термальное состояние `critical` | принудительно `'tight'`, независимо от RAM | защита от троттлинга/краша середины генерации |
| `freeRamGb` в моменте | `freeRamGb < minRamGb × 0.5` → `'tight'` | totalRam не значит свободно прямо сейчас — фон/другие приложения едят память |
| `lowPowerMode` (iOS) / аналог на Android | → `'tight'` | производительность CPU намеренно снижена ОС |

`minRamGb`/`recommendedRamGb` **не хардкодятся в коде** — это поля манифеста (§5.2, теперь обязательные), таблица выше — только дефолтный ориентир для наполнения каталога владельцем продукта, а не константа библиотеки.

```ts
export type EligibilityVerdict = 'ok' | 'tight' | 'no' | 'unknown';

export interface DeviceSnapshot {
  totalRamGb: number;
  freeRamGb: number;
  freeDiskBytes: number;
  thermal?: 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';
  lowPowerMode?: boolean;
}

export interface DeviceInfoPort {
  /** null, если плагин недоступен на платформе/не установлен — soft-dependency, см. §4.5. */
  getSnapshot(): Promise<DeviceSnapshot | null>;
}

export type LocalRuntimeVerdict = 'tooSlow' | 'oom';   // кэшируется локально в kv_store после реальной попытки

export function evaluateEligibility(
  artifact: { minRamGb: number; recommendedRamGb: number; sizeBytes: number },
  device: DeviceSnapshot | null,
  priorVerdict?: LocalRuntimeVerdict,
): EligibilityVerdict {
  if (device === null) return 'unknown';                          // device-info недоступен — честно не знаем
  if (priorVerdict === 'oom') return 'no';
  if (device.totalRamGb < artifact.minRamGb) return 'no';
  if (device.freeDiskBytes < artifact.sizeBytes * 1.15) return 'no';
  if (priorVerdict === 'tooSlow') return 'tight';
  if (device.thermal === 'critical') return 'tight';
  if (device.lowPowerMode) return 'tight';
  if (device.freeRamGb < artifact.minRamGb * 0.5) return 'tight';
  if (device.totalRamGb < artifact.recommendedRamGb) return 'tight';
  return 'ok';
}
```

### 6.3 Локальные вердикты после реальной попытки

- После первой успешной загрузки — опциональный `bench()` (если доступен в выбранном рантайм-плагине, §4.1) → `tgAvg < tooSlowTokPerSec` → сохранить `LocalRuntimeVerdict: 'tooSlow'` для `(artifactId, version)` в `kv_store` (§8.1).
- Если `loadModel()` бросает распознаваемую OOM-подобную ошибку → сохранить `'oom'` для этого артефакта, дальнейшие попытки без явного игнорирования вердикта библиотека не предпринимает молча.
- Оба вердикта — **локальные и переопределяемые** методом `resetLocalVerdicts()` (например, после того как пользователь освободил память на устройстве).

### 6.4 Как это встроено в публичный поток

```ts
export interface EligibilityReport {
  verdict: EligibilityVerdict;
  reasons: string[];
  device: DeviceSnapshot | null;
}

export class LocalAiClient {
  checkDeviceEligibility(target?: 'model' | 'embedding'): Promise<EligibilityReport>;
  resetLocalVerdicts(): Promise<void>;
}

export interface LocalAiConfig {
  // ...
  /** 'block' — ensureReady() бросает DeviceNotEligibleError при verdict === 'no';
   *  'warn'  — событие 'device:eligibility-warning', выполнение продолжается;
   *  'ignore' — eligibility не проверяется вообще при ensureReady() (ручной вызов
   *  checkDeviceEligibility() всё равно доступен). По умолчанию: 'no' → 'block', 'tight'/'unknown' → 'warn'. */
  eligibilityPolicy?: { no?: 'block' | 'warn' | 'ignore'; tight?: 'block' | 'warn' | 'ignore' };
}
```

`ensureModelReady()`/`ensureEmbeddingReady()` вызывают `checkDeviceEligibility()` **до** старта скачивания — нет смысла качать 2.5 GB на устройство, которое заведомо не потянет модель (`'no'` + policy `'block'`). Явно НЕ проверяем eligibility при каждом `sendMessage()`/`complete()` — только на этапе подготовки/загрузки модели, чтобы не тратить время на диагностику при каждом сообщении.

---

## 7. Resumable download engine

### 7.1 Модель порта

```ts
export interface DownloadTransportPort {
  start(task: { id: string; url: string; destinationPath: string; headers?: Record<string, string> }): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  stop(id: string, options?: { discardPartial?: boolean }): Promise<void>;
  status(id: string): Promise<{ state: 'pending' | 'running' | 'paused' | 'done' | 'error'; progressPercent: number; errorMessage?: string }>;
  onProgress(cb: (e: { id: string; progressPercent: number }) => void): Unsubscribe;
  onCompleted(cb: (e: { id: string }) => void): Unsubscribe;
  onFailed(cb: (e: { id: string; error: string }) => void): Unsubscribe;
}
```

`DownloadEngine` в `core` — тонкий оркестратор поверх этого порта (продакшен-реализация — `@capgo/capacitor-downloader`, §4.4), не сам ведёт байтовый Range-цикл:

```text
downloadArtifact(artifact: ModelArtifact | EmbeddingArtifact):
  1. key = hash(resolved URL + artifact.filename)
  2. state = loadOrCreate(key) в download_state (§8.1)
  3. status === 'completed' и файл существует и sha256 уже проверен → return сразу
  4. transport.start({ id: key, url, destinationPath, headers })
  5. onProgress → DownloadProgress (percent от плагина; approximateBytes = percent/100 × sizeBytes)
  6. onFailed → retry с backoff (transport.resume(key), при неудаче — transport.start() заново)
     → по исчерпании попыток: status='failed'
  7. onCompleted → status='verifying' → incrementalHash(файл) (§7.4)
       не совпал → status='failed', удалить файл, ChecksumMismatchError
       совпал    → status='completed'
```

### 7.2 Состояние загрузки (персистентное, в SQL)

```ts
export interface DownloadState {
  key: string;
  transportTaskId: string;
  kind: 'model' | 'embedding';
  url: string;
  destinationFilename: string;
  sizeBytesExpected: number;
  sha256Expected: string;
  status: 'pending' | 'downloading' | 'paused' | 'verifying' | 'completed' | 'failed';
  progressPercent: number;
  attempt: number;
  lastError?: string;
  updatedAt: string;
}
```

Persist переживает перезапуск приложения на уровне **нашей БД** независимо от того, помнит ли сам нативный плагин задачу после убийства процесса (§4.4, открытый вопрос) — при неизвестности `DownloadEngine` переоткрывает задачу через `transport.start()` с тем же `destinationPath`, полагаясь на то, что ОС-загрузчик сам умеет доиспользовать частично скачанный файл (обычное поведение `DownloadManager`/`URLSession`). Фиксируется в Phase 0 спайке, не считается гарантированным заранее.

### 7.3 Node-адаптер (эталонная реализация + запасной прод-путь)

`NodeRangeDownloadAdapter` — реализация `DownloadTransportPort` на чистом Node (`undici`/`fetch` + ручные `Range: bytes=start-`-запросы). Назначение: (1) тестировать `DownloadEngine` в Node против mock-HTTP-сервера, который рвёт соединение/меняет `ETag`/не отдаёт `Accept-Ranges`; (2) чертёж запасного Capacitor-адаптера поверх `CapacitorHttp`, если `@capgo/capacitor-downloader` не пройдёт спайк.

### 7.4 Инкрементальный SHA-256 на устройстве

Потоковое чтение файла чанками + инкрементальный SHA-256 (например, `@noble/hashes/sha256` с `.create().update(chunk)`). Время хеширования 2.5 GB на среднем Android — пункт Phase 0 спайка.

### 7.5 Публичное API загрузок

```ts
export interface DownloadHandle {
  readonly key: string;
  readonly kind: 'model' | 'embedding';
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(options?: { discardPartial?: boolean }): Promise<void>;
  onProgress(cb: (p: DownloadProgress) => void): Unsubscribe;
}

export interface DownloadProgress {
  key: string;
  kind: 'model' | 'embedding';
  percent: number;
  approximateBytes?: number;
  status: DownloadState['status'];
}
```

---

## 8. SQL-слой

### 8.1 Системная схема

```sql
CREATE TABLE IF NOT EXISTS _local_ai_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,           -- JSON: манифест-кэш/ETag, локальные eligibility-вердикты (§6.3) и т.п.
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS installed_artifacts (
  kind TEXT NOT NULL CHECK (kind IN ('model','embedding')),
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  installed_at TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, artifact_id, version)
);

CREATE TABLE IF NOT EXISTS download_state (
  key TEXT PRIMARY KEY,
  transport_task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('model','embedding')),
  url TEXT NOT NULL,
  destination_filename TEXT NOT NULL,
  size_bytes_expected INTEGER NOT NULL,
  sha256_expected TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

-- Чаты (§9)
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata TEXT                  -- JSON, произвольные поля приложения
);

CREATE TABLE IF NOT EXISTS chat_messages (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  id TEXT NOT NULL,              -- id вызывающей стороны; уникален В ПРЕДЕЛАХ chat_id, не глобально
  role TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','cancelled','error')),  -- см. §9.8
  created_at TEXT NOT NULL,
  token_count INTEGER,
  metadata TEXT,                 -- JSON
  PRIMARY KEY (chat_id, id)       -- основа идемпотентного appendMessages: INSERT OR IGNORE по этому ключу
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id, created_at);

-- Единственная строка — какому embedding-пространству соответствуют СЕЙЧАС сохранённые
-- вектора в VectorStore (§8.2). Основа жёсткой защиты от молчаливого поиска по
-- несовместимым векторам (см. §8.3).
CREATE TABLE IF NOT EXISTS vector_space (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  embedding_id TEXT NOT NULL,
  embedding_version INTEGER NOT NULL,
  dimensions INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
```

Миграции — пронумерованные файлы `NNN_description.ts`, каждая в транзакции, версия схемы в `_local_ai_migrations`. Раннер — часть `core/db`, платформенно-нейтрален (через `SqlitePort`).

### 8.2 Векторное хранилище (`VectorStore`)

Критика первого черновика (см. `docs/corrections.txt`) — справедливая: событие `vector-store:embedding-changed` (§5.6) само по себе **не защищает** от сценария «вектора в базе посчитаны embedding v1, текущий эмбеддинг уже v2, приложение не обработало событие → `search()` тихо отдаёт технически валидный, но семантически неверный результат». Событие остаётся (полезный ранний сигнал), но перестаёт быть единственной линией защиты — добавлен **жёсткий guard на уровне самого хранилища**.

`VectorStore` хранит собственный дескриптор «под какое эмбеддинг-пространство сейчас реально записаны вектора» (таблица `vector_space`, §8.1) и сверяет его с **текущим активным** эмбеддингом из `ModelRegistry` при каждой операции чтения/записи — не полагаясь на то, что приложение вообще посмотрит на событие:

```ts
export interface VectorSpaceDescriptor {
  embeddingId: string;
  embeddingVersion: number;
  dimensions: number;
}

export interface VectorStore {
  /** Инициализирует схему под УКАЗАННОЕ пространство. Если в vector_space уже
   *  записано другое пространство и в таблице есть данные — бросает
   *  VectorSpaceMismatchError вместо тихой переинициализации: вызывающая
   *  сторона должна осознанно выбрать reindex() (стереть и начать заново)
   *  или продолжить работать со старым пространством. */
  ensureSchema(space: VectorSpaceDescriptor): Promise<void>;

  /** upsert/search проверяют, что space совпадает с записанным в vector_space
   *  (embeddingId + embeddingVersion + dimensions СТРОГО равны — не только
   *  размерность, см. §5.6: другая версия эмбеддера не гарантирует то же
   *  векторное пространство даже при совпадении dimensions).
   *  Несовпадение → VectorSpaceMismatchError, операция не выполняется. */
  upsert(entry: VectorEntry, space: VectorSpaceDescriptor): Promise<void>;
  upsertMany(entries: VectorEntry[], space: VectorSpaceDescriptor): Promise<void>;
  search(queryEmbedding: Float32Array, space: VectorSpaceDescriptor, options?: { topK?: number; filter?: Record<string, unknown> }): Promise<VectorSearchHit[]>;

  delete(id: string): Promise<void>;
  /** Стирает ВСЕ вектора и принимает новое пространство как текущее — единственный
   *  штатный способ "переключиться" на новый embedding после vector-store:embedding-changed. */
  reindex(newSpace: VectorSpaceDescriptor): Promise<void>;
  count(): Promise<number>;
  currentSpace(): Promise<VectorSpaceDescriptor | null>;
}

export interface VectorEntry { id: string; embedding: Float32Array; text?: string; metadata?: Record<string, unknown>; }
export interface VectorSearchHit { id: string; score: number; text?: string; metadata?: Record<string, unknown>; }
```

Практически: `LocalAiClient` сам подставляет `VectorSpaceDescriptor` текущего эмбеддинга из registry при вызовах через фасад, поэтому обычному потребителю **не нужно** передавать его руками в типичном случае (упрощённые обёртки `vectors.upsert(entry)`/`vectors.search(query, options)` без явного `space` — оставлены в фасаде как sugar над этим же интерфейсом, см. §10). Явный параметр `space` в самом `VectorStore` — для контракт-тестов и для сценариев, где приложение осознанно работает с несколькими пространствами.

### 8.3 Реализация и фолбэк

- **Основной путь:** `sqlite-vec` (`vec0`) через `loadExtension()`. Предсказуемо на Android/Electron; на iOS — риск, спайк Phase 0.
- **Фолбэк:** `embedding` как `BLOB`, brute-force косинусный поиск в TS. Потолок — ориентир до ~20–50 тыс. векторов на mid-range телефоне. Событие `vector-store:fallback-active` обязательно. `VectorStore`-интерфейс (включая `VectorSpaceMismatchError`-guard) не меняется между реализациями.
- Оба варианта покрываются одинаковым contract-test набором (§13.3), включая обязательный кейс «`search()` после смены эмбеддинга без `reindex()` бросает `VectorSpaceMismatchError`, а не возвращает результат».

### 8.4 Открытые технические вопросы SQL-слоя

- Шифрование БД (SQLCipher passphrase) — по умолчанию без, `SqlitePort` не исключает такую возможность.
- Единая БД для системных таблиц + чатов + векторов, или отдельные файлы? Рекомендация — единая БД по умолчанию.

---

## 9. Управление чатами (Conversations)

Библиотека должна позволять создавать множество независимых диалогов поверх одной модели — как в интерфейсе ChatGPT. Даёт **данные и API**, не рендер. Поддерживает два режима использования — библиотека как источник истины (A) и библиотека как контекст-зеркало над уже существующей историей приложения (B) — см. §9.6.

### 9.1 Доменная модель

```ts
export interface Chat {
  /** Задаётся ВЫЗЫВАЮЩЕЙ стороной, библиотека сама id не генерирует принудительно
   *  (кроме удобного дефолта в createChat(), см. §9.6). Позволяет приложению-хозяину
   *  использовать СВОИ id чатов напрямую, без маппинга. */
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  /** Тоже задаётся вызывающей стороной. Уникальность — в паре (chatId, id),
   *  не глобально: приложение может использовать свои локальные id сообщений
   *  (даже инкрементальные/не-UUID) без риска коллизий между чатами. */
  id: string;
  chatId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** 'complete' — обычное завершённое сообщение; 'cancelled' — генерация
   *  ассистента была прервана через AbortSignal (content — частичный ответ,
   *  сохраняется, а не отбрасывается); 'error' — генерация упала с ошибкой
   *  (content может быть пустым). См. §9.8. Для user-сообщений всегда 'complete'. */
  status: 'complete' | 'cancelled' | 'error';
  createdAt: string;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}
```

### 9.2 API (часть `LocalAiClient`)

По замечанию из `docs/corrections.txt`: гибридный тип `AsyncIterable<CompletionToken> & Promise<ChatMessage>` (thenable-и-итерируемое одновременно) — неудобный и хрупкий в реализации/тестировании паттерн. Заменён на явный объект-обёртку `CompletionStream<T>` (см. §10) — итерируется как обычный `AsyncIterable`, а финальный результат забирается через понятное поле `.result`, а не через `await` самого объекта:

```ts
const stream = client.sendMessage('chat-1', 'Hello');
for await (const token of stream) { render(token); }
const message = await stream.result;
```

Также API разделён на **обязательный MVP-набор** и **опциональное расширение синхронизации** (режим B, §9.6) — по замечанию, что смешение двух моделей владения данными в одном плоском списке методов раздувает поверхность API для тех, кому режим B не нужен. Оба интерфейса реализует один и тот же `LocalAiClient` — разделение чисто типовое/документационное, не два разных модуля для подключения.

```ts
/** Обязательный MVP-набор: библиотека как источник истины (режим A, §9.6). */
export interface ConversationApi {
  createChat(options?: { id?: string; title?: string; systemPrompt?: string; metadata?: Record<string, unknown> }): Promise<Chat>;
  listChats(options?: { limit?: number; offset?: number; orderBy?: 'updatedAt' | 'createdAt' }): Promise<Chat[]>;
  getChat(chatId: string): Promise<Chat | null>;
  renameChat(chatId: string, title: string): Promise<void>;
  deleteChat(chatId: string): Promise<void>;             // каскадно удаляет сообщения + session-cache файл (§9.3)
  getMessages(chatId: string, options?: { limit?: number; before?: string }): Promise<ChatMessage[]>;

  /** Берёт историю чата, вызывает completion, стримит токены, сам добавляет
   *  user- и assistant-сообщения (можно передать свои id для идемпотентности
   *  повторного вызова после сбоя сети), обновляет session-cache. Семантика
   *  отмены/статуса сообщения — §9.8. Управление длиной контекста — §9.7. */
  sendMessage(chatId: string, text: string, options?: { userMessageId?: string; assistantMessageId?: string; completionOptions?: CompletionOptions; signal?: AbortSignal }): CompletionStream<ChatMessage>;
}

/** Опциональное расширение — режим B, §9.6. Тот же LocalAiClient её реализует,
 *  но приложениям, которым не нужна синхронизация с внешней историей, эти
 *  методы можно просто не использовать; в фазах реализации (§15) вынесено
 *  отдельно от MVP-набора (Phase 5, а не Phase 3). */
export interface ConversationSyncApi {
  /** Идемпотентный upsert по id: чата с таким id ещё нет → создать; чат уже
   *  есть → НЕ пересоздаётся и НЕ теряет сообщения, обновляются только
   *  title/metadata/updatedAt (если переданы). */
  upsertChat(chat: { id: string; title: string; createdAt?: string; updatedAt?: string; metadata?: Record<string, unknown> }): Promise<Chat>;

  /** Идемпотентное добавление сообщений извне (импорт/синхронизация истории из
   *  приложения-хозяина). Дедуп по (chatId, message.id): уже существующие
   *  сообщения молча пропускаются, НЕ перезаписываются — контент иммутабелен
   *  после первой записи (§9.5, §9.6). Если chatId ещё не существует — чат
   *  создаётся неявным upsertChat с минимальным title. Порядок вставки не важен —
   *  сортировка при чтении идёт по createdAt. */
  appendMessages(chatId: string, messages: Array<{ id: string; role: ChatMessage['role']; content: string; status?: ChatMessage['status']; createdAt: string; tokenCount?: number; metadata?: Record<string, unknown> }>): Promise<{ inserted: number; skippedExisting: number }>;
}
```

`LocalAiClient.complete()` (низкоуровневый, §10) остаётся доступен напрямую для случаев без персистентной истории (одноразовые запросы, суммаризация) — `sendMessage` не заменяет его, а надстраивается сверху.

### 9.3 Session-cache (KV) и переключение между чатами

Используем `saveSession`/`loadSession` из `LlmRuntimePort` (§4.1), чтобы не переигрывать всю историю чата как промпт при каждом переключении:

```text
sendMessage(chatId, text):
  1. если активный (последний использованный) чат !== chatId:
       a. есть валидный session-cache для chatId (совпадает с текущей версией модели) → loadSession(...)
       b. иначе → собрать промпт из getMessages(chatId) целиком (холодный старт)
  2. runtime.complete(...) со стримингом
  3. append user + assistant сообщений в chat_messages
  4. saveSession(session-<chatId>.bin)
  5. пометить chatId как активный
```

**v1-решение:** кешируем session-файл только для **одного «горячего» (последнего активного) чата** — многослотовый LRU-кеш session-файлов возможен в Phase 8, не блокирует v1. Session-файлы — производные, не источник истины; при отсутствии/повреждении/несовместимой версии модели — пересобираются из SQL-истории.

### 9.4 Конкурентность

Один рантайм-контекст LLM — генерировать одновременно можно только в одном чате. Попытка `sendMessage`/`complete` во время активной генерации в другом чате → `RuntimeBusyError`. UI-очередь/дизейбл кнопки отправки — ответственность приложения-потребителя.

### 9.5 Что НЕ входит в v1 conversation-слоя

- Ветвление сообщений (regenerate → alternative branch) — можно добавить позже (`parentMessageId`), не закладываем в схему заранее (открытый вопрос §16).
- Прикрепление файлов/изображений к сообщениям — вне объёма (модель текстовая).
- Полнотекстовый поиск по всем чатам сразу — можно построить поверх `chat_messages` при необходимости (FTS5), не описываем отдельно.
- **Редактирование контента уже сохранённого сообщения.** `appendMessages`/`sendMessage` только добавляют — повторная запись с существующим `(chatId, id)` молча игнорируется. Синхронизация редактирования/удаления из БД приложения-хозяина — отдельный явный вызов (`updateMessage`/`deleteMessages`), которого в v1 нет (открытый вопрос §16).

### 9.6 Два режима использования: библиотека как источник истины vs как контекст-зеркало

Частый кейс: у приложения-потребителя **уже есть своя** история чатов для отображения в UI, и `local-ai` нужен не как хранилище для UI, а только как «память» для контекста модели. Оба режима — один и тот же `ConversationApi`, разница — в том, какие методы вызывает приложение и чьи `id` используются.

| | **Режим A — библиотека как источник истины** | **Режим B — приложение как источник истины (`local-ai` = зеркало для контекста)** |
|---|---|---|
| Кто рисует UI списка чатов/сообщений | `local-ai` не рисует ничего, но его данные — «правда» | своя БД/стор приложения — «правда» |
| Создание чата | `createChat()` — id генерируется библиотекой | `upsertChat({ id: myChatId, title })` — id из приложения, идемпотентно |
| Добавление сообщений | `sendMessage(chatId, text)` — сама создаёт user- и assistant-сообщение | `appendMessages(chatId, [...])` со своими id, и/или `sendMessage()` с `options.userMessageId`/`assistantMessageId` = своими id |
| Повторный/фоновый импорт истории | не нужен | `appendMessages` можно звать сколько угодно раз с пересекающимися наборами — дубликаты по `(chatId, id)` не создаются, ничего не перезаписывается |
| Удаление/редактирование | `deleteChat`/будущий `updateMessage` | приложение решает само; в v1 синхронизируется только `deleteChat` целиком (см. §9.5) |

**Типичный поток для режима B:**

```text
1. Пользователь открывает существующий чат в UI приложения (своя БД, id = "chat-42")
2. client.upsertChat({ id: 'chat-42', title: 'Отпуск в Португалии' })
   → чата с таким id в local-ai ещё нет → создан пустым; если есть — no-op по сообщениям
3. client.appendMessages('chat-42', historyFromOwnDb)
   → досинхронизирует то, чего в local-ai ещё не было; дубликаты по id безопасны
4. Пользователь пишет новое сообщение → приложение сохраняет его в СВОЮ БД под id 'msg-501'
   и вызывает: client.sendMessage('chat-42', text, { userMessageId: 'msg-501', assistantMessageId: 'msg-502' })
5. local-ai строит контекст из синхронизированной истории chat-42, стримит ответ;
   приложение параллельно получает те же токены и сохраняет финальный ответ под
   id 'msg-502' в СВОЮ БД — id совпадают, повторный вызов после сетевого сбоя идемпотентен
```

Ключевая гарантия: `local-ai` в режиме B никогда не «отбирает» право на отображение — он только копит контекст под теми же `id`, что и у приложения, поэтому синхронизация становится делом сопоставления `id`, а не отдельного маппинга.

### 9.7 Управление длиной контекста (context window policy)

Пробел из первого черновика (справедливо отмечен в `docs/corrections.txt`): «собрать промпт из `getMessages(chatId)` целиком» (§9.3) не масштабируется — у модели фиксированный `contextLength` (§5.2), а история чата растёт неограниченно. Без явной политики первая же длинная переписка ломается либо переполнением контекста, либо неопределённым поведением рантайма.

```ts
export type ContextStrategy = 'fail' | 'truncate-oldest' | 'truncate-to-fit';

export interface LocalAiConfig {
  // ...
  /** По умолчанию 'truncate-oldest'. */
  contextStrategy?: ContextStrategy;
  /** По умолчанию: model.contextLength − (completionOptions.maxTokens ?? дефолт) − безопасный запас.
   *  Можно задать меньше руками, если приложение хочет оставить больше места под ответ. */
  maxContextTokens?: number;
}
```

Алгоритм сборки промпта (и в `complete()`, и в `sendMessage()`):

```text
1. system-сообщение (если есть) — всегда сохраняется, в лимит считается, но не отбрасывается
2. считаем токены кандидатов "снизу вверх" (от новых к старым), используя chat_messages.token_count;
   если у сообщения token_count не записан (например, импортировано через appendMessages
   без явного tokenCount) — оценивается через LlmRuntimePort.countTokens() (если модель уже
   загружена) либо приблизительной эвристикой (символы / 4) как временная оценка до первой
   реальной токенизации
3. добавляем сообщения, пока сумма (system + добавленные + предполагаемый ответ) < maxContextTokens
4. как только лимит превышен:
     'fail'            → ContextWindowExceededError, sendMessage()/complete() не стартует генерацию
     'truncate-oldest'  (по умолчанию) → отбрасываем САМЫЕ старые non-system сообщения,
                          пока не влезет; отброшенные сообщения остаются в SQL нетронутыми —
                          отбрасывается только то, что попадает в ЭТОТ конкретный промпт
     'truncate-to-fit'  → как truncate-oldest, и дополнительно может обрезать содержимое
                          самого старого оставшегося сообщения по границе токенов, а не
                          целиком отбрасывать его — более агрессивный вариант для длинных
                          одиночных сообщений
```

Важно: усечение контекста **не удаляет** сообщения из `chat_messages` — это только про то, что попадает в конкретный вызов инференса. `getMessages()` всегда возвращает полную сохранённую историю, вне зависимости от `contextStrategy`. Суммаризация старых сообщений в более компактную форму — вне объёма v1 (может быть предложена как Phase 8 расширение, приложение может делать это само поверх `getMessages()`).

### 9.8 Семантика отмены и сбоев генерации

Тоже отмечено как недостаточно определённое в `docs/corrections.txt`. Явное правило:

| Событие | user-сообщение | assistant-сообщение |
|---|---|---|
| Обычный успешный ответ | сохраняется сразу при вызове `sendMessage()`, **до** старта генерации (не теряется, даже если генерация упадёт) | сохраняется по завершении, `status: 'complete'` |
| Отмена через `AbortSignal` (`options.signal`) | уже сохранено | сохраняется с `status: 'cancelled'` и **частичным** content, накопленным до отмены (не отбрасывается — так делает большинство чат-интерфейсов, и это полезно для UX «вы остановили этот ответ») |
| Генерация упала с ошибкой рантайма (`RuntimeInitError`/иное) | уже сохранено | сохраняется с `status: 'error'`, `content` может быть пустой строкой; сама ошибка дополнительно пробрасывается вызывающему через reject `stream.result` |

Явное сохранение user-сообщения **до** старта генерации — тоже осознанное решение (не было явным в первом черновике): если рантайм упадёт ещё до первого токена (например, `RuntimeBusyError` из-за параллельного чата, §9.4), сообщение пользователя не должно потеряться в UI. `CompletionStream.result` в любом из трёх случаев резолвится (не reject'ится) финальным `ChatMessage` с соответствующим `status` — приложение читает статус, а не ловит исключение, чтобы отличить «отменено»/«ошибка» от «успех» (кроме случаев, когда сама генерация не смогла стартовать вовсе — например, `ContextWindowExceededError`/`RuntimeBusyError` — тогда `sendMessage()`/`stream.result` действительно reject'ится, потому что user-сообщение уже сохранено, а ответа не будет вовсе).

---

## 10. Публичный API (фасад)

Единая точка входа. `ConversationApi`/`ConversationSyncApi` (§9.2) и eligibility-методы (§6.4) — часть этого же фасада.

> **v5 note:** этот раздел был синхронизирован 2026-08-11 с фактической публичной поверхностью после
> Phase 8 («search + export/backup + `updateMessage`/`deleteMessages`»), security-hardening и
> «Local logging & export» (все — `ROADMAP.md`, за пределами исходных §15-фаз, добавлены по запросу
> пользователя после того, как v4 этого ТЗ считалось «готово к реализации»). Ниже — полный список,
> включая то, что появилось после v4; `ChatSearchApi`/`ChatExportApi`/`LogExportApi` не имеют
> отдельного §-раздела в этом ТЗ (не было запланировано на момент v4) — их контракт и обоснование
> живут в `docs/decisions.md` («Full-text search», «Export/backup», «Local logging & export»
> секции) и `src/core/conversations/conversation.types.ts`/`src/core/logging/logging.types.ts`.

### 10.0 Инференс-параметры и потоковый результат

Пробел из первого черновика (`docs/corrections.txt`): нужна явная модель параметров сэмплинга, а не голый `CompletionInput` без структуры, и нужен явный (не гибридный) тип потокового результата:

```ts
export interface CompletionOptions {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  repeatPenalty?: number;
  seed?: number;
  stop?: string[];
}

/** Только структурированные сообщения — НИКОГДА сырой prompt-строкой, см. §4.1 (chat template). */
export interface CompletionInput {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  options?: CompletionOptions;
}

export interface CompletionResult {
  content: string;
  status: 'complete' | 'cancelled' | 'error';
  tokenCount?: number;
}

/** Единица потокового вывода — то, что видит подписчик в `for await`. */
export interface CompletionToken {
  token: string;
  /** Накопленный текст с начала генерации — удобно для UI, которому не хочется
   *  самому конкатенировать token за token. */
  accumulatedContent: string;
}

/** Замена гибридному AsyncIterable&Promise — простой явный объект,
 *  дешёвый в реализации/тестировании (не thenable-хак). */
export interface CompletionStream<TResult> extends AsyncIterable<CompletionToken> {
  /** Резолвится финальным результатом ПОСЛЕ полного прохода стрима (успех/cancel/error —
   *  все три случая резолвят, а не reject'ят, см. §9.8; reject — только если генерация
   *  вообще не смогла стартовать: RuntimeBusyError, ContextWindowExceededError и т.п.). */
  readonly result: Promise<TResult>;
}
```

Использование одинаково для `complete()` и `sendMessage()`:

```ts
const stream = client.sendMessage('chat-1', 'Hello');
for await (const token of stream) { render(token); }
const message = await stream.result;
```

```ts
export interface LocalAiConfig {
  manifestUrl: string;
  storageDirectory?: string;
  databaseName?: string;
  maxModelParamsB?: number;
  autoUnloadOnBackground?: boolean;
  eligibilityPolicy?: { no?: 'block' | 'warn' | 'ignore'; tight?: 'block' | 'warn' | 'ignore' };
  /** См. §9.7. */
  contextStrategy?: ContextStrategy;
  maxContextTokens?: number;
  ports?: Partial<LocalAiPorts>;
  logger?: LocalAiLogger;
  /** Отдельное, opt-in персистентное хранилище логов (SQLite-таблица) — не то же самое, что logger
   *  выше (тот no-op-колбэк, этот — читается обратно через exportLogs()). По умолчанию `enabled: false`.
   *  См. docs/decisions.md «Local logging & export». */
  logging?: { enabled?: boolean; minLevel?: LogLevel; maxEntries?: number };
}

export class LocalAiClient implements ConversationApi, ConversationSyncApi, ChatSearchApi, ChatExportApi, LogExportApi {
  static async create(config: LocalAiConfig): Promise<LocalAiClient>;
  static async checkSupport(ports?: Partial<Pick<LocalAiPorts, 'platformSupport'>>): Promise<SupportReport>;

  checkDeviceEligibility(target?: 'model' | 'embedding'): Promise<EligibilityReport>;
  resetLocalVerdicts(): Promise<void>;

  refreshManifest(): Promise<ManifestDiff>;

  ensureModelReady(options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void>;
  ensureEmbeddingReady(options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void>;
  ensureReady(options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void>;

  switchModel(options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void>;      // §5.5
  switchEmbedding(options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void>;   // §5.6

  complete(input: CompletionInput, signal?: AbortSignal): CompletionStream<CompletionResult>;
  embed(text: string | string[]): Promise<Float32Array | Float32Array[]>;

  // ConversationApi (MVP, §9.2) — режим A
  createChat(...): Promise<Chat>;
  listChats(...): Promise<Chat[]>;
  getChat(chatId: string): Promise<Chat | null>;
  renameChat(chatId: string, title: string): Promise<void>;
  deleteChat(chatId: string): Promise<void>;
  getMessages(chatId: string, options?): Promise<ChatMessage[]>;
  sendMessage(chatId: string, text: string, options?: { userMessageId?: string; assistantMessageId?: string; completionOptions?: CompletionOptions; signal?: AbortSignal }): CompletionStream<ChatMessage>;

  // ConversationSyncApi (опционально, §9.2/§9.6) — режим B
  upsertChat(chat: { id: string; title: string; createdAt?: string; updatedAt?: string; metadata?: Record<string, unknown> }): Promise<Chat>;
  appendMessages(chatId: string, messages: Array<{ id: string; role: ChatMessage['role']; content: string; status?: ChatMessage['status']; createdAt: string; tokenCount?: number; metadata?: Record<string, unknown> }>): Promise<{ inserted: number; skippedExisting: number }>;

  // ConversationSyncApi (продолжение, режим B) — Phase 8, docs/decisions.md #7a.
  // Синхронизация правок/удалений отдельных сообщений из собственной БД хоста.
  /** Частичный апдейт по совпадающим (chatId, messageId); бросает MessageNotFoundError, если такого сообщения нет. */
  updateMessage(chatId: string, messageId: string, updates: { content?: string; status?: ChatMessage['status']; tokenCount?: number; metadata?: Record<string, unknown> }): Promise<ChatMessage>;
  /** Отсутствующие id молча не учитываются в счётчике — ожидаемо для bulk delete-sync. */
  deleteMessages(chatId: string, messageIds: string[]): Promise<{ deleted: number }>;

  // ChatSearchApi — Phase 8 addition, no TZ §-section originally (see docs/decisions.md "Full-text search").
  /** Полнотекстовый поиск по одному чату или по всем; snippet заполнен только на FTS5-пути. */
  searchMessages(query: string, options?: { chatId?: string; limit?: number }): Promise<ChatSearchHit[]>;

  // ChatExportApi — Phase 8 addition, no TZ §-section originally (see docs/decisions.md "Export/backup").
  // Форма результата специально совпадает со входом upsertChat()/appendMessages() — round-trip
  // restore без отдельного import-метода.
  /** Резолвится null, если чата с таким id нет. */
  exportChat(chatId: string): Promise<{ chat: Chat; messages: ChatMessage[] } | null>;
  /** Экспортирует все чаты, пагинация как у listChats(). */
  exportChats(options?: { limit?: number; offset?: number }): Promise<Array<{ chat: Chat; messages: ChatMessage[] }>>;

  // LogExportApi — "Local logging & export" addition, no TZ §-section originally
  // (see docs/decisions.md, same-named entry). Независимо от config.logger (см. LocalAiConfig выше) —
  // это отдельное, opt-in персистентное хранилище (config.logging), которое читается через эти методы.
  /** Только данные — без записи файла/share-sheet изнутри библиотеки, хост-приложение решает, что с этим делать. */
  exportLogs(options?: { since?: Date; level?: LogLevel; limit?: number }): Promise<LogEntry[]>;
  /** Очищает персистентный лог-стор; не влияет на config.logger колбэк. */
  clearLogs(): Promise<void>;

  /** Тонкая обёртка над VectorStore, сама подставляет VectorSpaceDescriptor
   *  текущего активного эмбеддинга (§8.2) — обычному коду не нужно передавать
   *  его руками. */
  readonly vectors: {
    upsert(entry: VectorEntry): Promise<void>;
    search(queryEmbedding: Float32Array, options?: { topK?: number; filter?: Record<string, unknown> }): Promise<VectorSearchHit[]>;
    reindex(): Promise<void>;                    // §8.2 — стереть и принять текущий эмбеддинг как новое пространство
    count(): Promise<number>;
  };
  readonly downloads: { get(key: string): DownloadHandle | undefined; list(): DownloadHandle[] };

  /** Освобождает нативные рантайм-контексты и in-memory кеши. `unloadAll` — алиас
   *  (то же самое), оставлен для обратной совместимости названия из ранних версий
   *  ТЗ; см. §11 — почему переименовано. */
  releaseRuntime(options?: { closeDatabase?: boolean }): Promise<void>;
  /** @deprecated используйте releaseRuntime — тот же метод, другое имя. */
  unloadAll(options?: { closeDatabase?: boolean }): Promise<void>;
  reload(): Promise<void>;

  on<E extends LocalAiEvent>(event: E, handler: (payload: LocalAiEventMap[E]) => void): Unsubscribe;
  destroy(): Promise<void>;
}
```

Все публичные методы и типы — с JSDoc (`@param`, `@returns`, `@throws`, `@example` минимум для `create`, `checkSupport`, `checkDeviceEligibility`, `ensureReady`, `complete`, `sendMessage`, `releaseRuntime`).

### 10.1 События

```ts
export interface LocalAiEventMap {
  'manifest:updated': ManifestDiff;
  'manifest:invalid': { error: Error };
  'device:eligibility-warning': EligibilityReport;
  'download:progress': DownloadProgress;
  'download:completed': { key: string; kind: 'model' | 'embedding' };
  'download:failed': { key: string; kind: 'model' | 'embedding'; error: Error };
  'runtime:model-loaded': { modelId: string; version: number };
  'runtime:embedding-loaded': { embeddingId: string; version: number };
  'runtime:unloaded': { reason: 'manual' | 'background' | 'model-switch' | 'embedding-switch' };
  'vector-store:fallback-active': { reason: string };
  /** Phase 8 addition (см. docs/decisions.md «Full-text search») — тот же opportunistic-primary/
   *  self-tested/silent-fallback паттерн, что и vector-store:fallback-active, для FTS5 → LIKE. */
  'chat-search:fallback-active': { reason: string };
  'vector-store:embedding-changed': { previous?: { id: string; version: number; dimensions: number }; current: { id: string; version: number; dimensions: number }; dimensionsChanged: boolean };
  'chat:created': { chatId: string };
  'chat:deleted': { chatId: string };
  'chat:message-appended': { chatId: string; messageId: string; role: ChatMessage['role'] };
}
```

### 10.2 Типизированные ошибки

```ts
export class LocalAiError extends Error { code: string; }
export class PlatformNotSupportedError extends LocalAiError {}     // §6.1
export class DeviceNotEligibleError extends LocalAiError {}         // §6.2/§6.4
export class ManifestFetchError extends LocalAiError {}
export class ManifestValidationError extends LocalAiError {}
export class DownloadError extends LocalAiError {}
export class ChecksumMismatchError extends DownloadError {}
export class InsufficientStorageError extends DownloadError {}
export class RuntimeInitError extends LocalAiError {}
export class RuntimeBusyError extends LocalAiError {}
export class SessionIncompatibleError extends LocalAiError {}
export class VectorSpaceMismatchError extends LocalAiError {}       // §8.2
export class ContextWindowExceededError extends LocalAiError {}     // §9.7, только при contextStrategy: 'fail'
```

Единый `code` (стабильная строка, не меняется между версиями) — чтобы потребитель мог показывать локализованные сообщения, не завязываясь на текст ошибки.

---

## 11. Управление памятью и жизненным циклом

### 11.0 Почему `releaseRuntime()`, а не `unloadAll()`

Замечание из `docs/corrections.txt`, принято: название `unloadAll()` читается как «выгрузить **вообще всё**» (диск, кеши, состояние), хотя по факту метод освобождает только нативные рантайм-контексты и in-memory кеши, **сохраняя** персистентные данные (чаты, download-state, файлы моделей, session-файлы). Каноничное имя — `releaseRuntime()`, точно описывающее объём действия; `unloadAll()` остаётся алиасом (тот же метод) ради обратной совместимости названия из ранних версий этого ТЗ, но помечена `@deprecated` в JSDoc — новый код должен использовать `releaseRuntime()`.

### 11.1 `releaseRuntime()`

Гарантии — **что освобождается**: LLM- и embedding-контексты (раздельно); опционально закрывает SQLite (`closeDatabase`, по умолчанию `false`); сбрасывает in-memory кеши (распарсенный манифест, «горячий» session-хендл в памяти).

**Что НЕ трогается** (сознательно перечислено явно, а не подразумевается): файлы моделей/эмбеддинга на диске; чаты и сообщения в SQL; `download_state`/незавершённые загрузки; session-**файлы** на диске (только in-memory хендл к ним сбрасывается); локальные eligibility-вердикты (§6.3).

Метод идемпотентен — повторный вызов ничего не ломает.

### 11.2 Автоматизация через `@capacitor/app` (опционально, `autoUnloadOnBackground`)

```text
App.addListener('appStateChange', ({ isActive }) => {
  if (!isActive) client.releaseRuntime();
  // НЕ делаем eager reload на возврат в фокус — следующий вызов сам лениво поднимет контекст.
});
```

По умолчанию `autoUnloadOnBackground: false` — компромисс память vs. задержка возврата решает приложение-потребитель.

### 11.3 Ограничения, которые нужно честно задокументировать

`use_mlock: false` по умолчанию — ОС может держать страницы модели в page cache даже после `release()`. `releaseRuntime()` гарантирует, что библиотека сама больше не держит ссылок/хэндлов — не гарантирует мгновенного возврата памяти ОС.

---

## 12. Документация

- **README.md** — quickstart (`npm install`, `LocalAiClient.checkSupport()`, `LocalAiClient.create`, `ensureReady()`, `createChat()`, `sendMessage()`), честная секция «Platform support».
- **JSDoc на 100% публичного API** — `eslint-plugin-jsdoc` проваливает сборку при пропуске.
- **TypeDoc** — генерация сайта из JSDoc в CI.
- **Гайды** (`docs/guides/`):
  - «Первый запуск»;
  - «Проверка поддержки и совместимости устройства» (`checkSupport()`/`checkDeviceEligibility()`, `eligibilityPolicy`, критерии §6.2);
  - «Множество чатов» (создание/переключение/удаление, `RuntimeBusyError`, session-cache);
  - «Интеграция с собственной историей чатов приложения» (режим B, §9.6: `upsertChat`/`appendMessages`, идемпотентность по `id`, чем `local-ai` в этом режиме не является);
  - «Обновление модели и эмбеддинга по отдельности» (§5.5/§5.6, `vector-store:embedding-changed`);
  - «Память и жизненный цикл» (`releaseRuntime`, `autoUnloadOnBackground`);
  - «Тестирование приложений, использующих `local-ai`» (мокирование `LocalAiClient`);
  - «Формат манифеста» — полная спецификация §5.
- **ADR** (`docs/adr/`) — выбор native-плагина инференса, выбор SQLite-плагина, `sqlite-vec` на iOS, выбор `@capgo/capacitor-downloader`, выбор `@capgo/capacitor-device-info` и калибровка порогов eligibility.

---

## 13. Тестирование

### 13.1 Прямой ответ на вопрос «можно ли тестировать из Node.js»

**Да, большая часть — можно и нужно. Нет — для тонкого нативного моста и реального мобильного инференса/скачивания/device-info.**

| Слой | Тестируется в чистом Node.js? | Как |
|---|---|---|
| `SupportChecker` (комбинации платформа × доступность плагинов → `SupportReport`) | ✅ да | фейковый `PlatformSupportPort`, параметризованные сценарии (web без плагина, native без плагина, native со всем) |
| `EligibilityService` / `evaluateEligibility()` (вся таблица §6.2 как чистая функция) | ✅ да | юнит-тесты на каждую границу (RAM впритык, диск впритык, thermal critical, lowPowerMode, `device === null` → `unknown`) |
| `ManifestService` (парсинг/валидация/независимый diff модели и эмбеддинга) | ✅ да | unit-тесты, без адаптеров |
| `DownloadEngine` (оркестрация, checksum, ретраи) | ✅ да | `NodeRangeDownloadAdapter` поверх локального mock-сервера |
| `ModelRegistry` / orphan cleanup / независимое переключение модели и эмбеддинга | ✅ да | Node FS-адаптер + временная директория |
| `Database` / миграции / `VectorStore` (основной путь) | ✅ да | `better-sqlite3` + npm-пакет `sqlite-vec` |
| `VectorStore` (brute-force фолбэк) | ✅ да | чистый TS |
| `ConversationStore` (CRUD, пагинация, идемпотентность `upsertChat`/`appendMessages` — режимы A и B из §9.6) | ✅ да | чистая SQL-логика, `better-sqlite3`; отдельный кейс «повторный `appendMessages` с пересекающимся набором id не создаёт дублей и не меняет content» |
| Контекстная политика (§9.7): усечение истории по `contextStrategy`/`maxContextTokens` | ✅ да | чистая функция от массива `{content, tokenCount}` + лимит — не требует реальной модели/токенизатора |
| Семантика отмены/сбоя (§9.8): user-сообщение сохраняется до старта генерации, assistant — с `status: 'complete'/'cancelled'/'error'` | ✅ да | фейковый `LlmRuntimePort`, эмулирующий `AbortSignal`-обрыв и брошенную ошибку на середине стрима |
| Выбор chat-template пресета по `ModelArtifact.family`/`chatTemplate` (§4.1) — сама функция сборки промпта из `messages` для фолбэк-пути | ✅ да | чистая функция, юнит-тест на каждый пресет (`qwen`/`llama3`/`gemma`/`mistral`) сверяет результат со снятым эталонным форматированием |
| `VectorSpaceMismatchError` guard (§8.2) | ✅ да | `better-sqlite3` + `sqlite-vec`, сценарий «записали под embedding v1, `search()` под v2 без `reindex()` → бросает» |
| `SessionCache`-оркестрация | ✅ да | фейковый `LlmRuntimePort`, проверяем последовательность вызовов |
| `LifecycleManager` / `releaseRuntime` оркестрация | ✅ да | фейковый `LlmRuntimePort`, идемпотентность, события |
| `RuntimeFacade` — контракт (`complete`/`embed`/`sendMessage`, стриминг, `AbortSignal`, `RuntimeBusyError`) | ✅ да | фейковый `LlmRuntimePort` |
| Реальный инференс GGUF-модели (промпт-форматирование, embedding-shape, `saveSession`/`loadSession`) | ⚠️ частично | `node-llama-cpp` как альтернативный `LlmRuntimePort`-адаптер — **не** сам Capacitor-native-мост |
| Реальный `@capgo/capacitor-device-info` snapshot | ❌ нет | требует устройство/эмулятор — в Node нет системных сенсоров телефона |
| `@capgo/capacitor-downloader` в реальном нативном рантайме (фон, переживание убийства процесса) | ❌ нет | требует Android-эмулятор/устройство или iOS-симулятор |
| Capacitor-адаптеры (`llama-cpp-capacitor`, `@capacitor-community/sqlite`, `@capacitor/filesystem`, `Capacitor.isPluginAvailable` в реальном WebView) | ❌ нет | вне Node.js в принципе |
| Полный E2E (проверить поддержку → проверить eligibility → скачать в фоне → загрузить → сгенерировать ответ на устройстве) | ❌ нет (не Node) | ручной чек-лист + опционально Appium/Detox на эмуляторе |

Это отвечает на требование пользователя: **основной объём автотестов, включая новую логику `checkSupport()`/eligibility и всю логику чатов, гоняется в обычном `node` через `vitest`/`jest`, без эмулятора и без телефона.** Принципиально нельзя прогнать в Node только реальный Capacitor-native-мост и реальные показания сенсоров/загрузчика устройства — явно фиксируется в README.

### 13.2 Структура тестов

```text
test/
  unit/           # core, никаких реальных ресурсов, всё через фейки
  integration/    # core + node-testing адаптеры: реальный SQLite-файл, реальный (локальный) HTTP-сервер, реальная временная директория
  contract/       # один test-suite, параметризован по адаптеру (node-testing / — при наличии окружения — capacitor)
  fixtures/       # маленькие тестовые GGUF (десятки МБ, не 4B!) для node-llama-cpp прогонов
  device-e2e/     # НЕ часть `npm test`; отдельный package.json script + документация запуска на эмуляторе/устройстве
```

### 13.3 Contract-тесты

Один набор сценариев (`VectorStore.search()` + `VectorSpaceMismatchError` на несовпадении пространства, `DownloadEngine` резюм после обрыва на 50%, `releaseRuntime()` идемпотентен, `ConversationStore` CRUD + каскадное удаление, `evaluateEligibility()` границы) написан один раз и параметризован по реализации адаптера.

### 13.4 Тестовые модели

Маленькие GGUF (0.1–0.5B), не 4B, для `node-llama-cpp`-прогонов и ручного device-QA.

### 13.5 CI

`lint` + `typecheck` + `test:unit` + `test:integration` — обязательный gate на каждый PR, обычный Node-раннер. `test:device-e2e` — отдельный, не блокирующий обязательный merge job.

---

## 14. Нефункциональные требования

| Категория | Требование |
|---|---|
| Безопасность | Модель — только с pinned `revision` на Hugging Face. Оба артефакта — обязательная `sha256`-проверка. Только HTTPS. Никакого выполнения кода из скачанных файлов. |
| Приватность | Без телеметрии по умолчанию. Сетевые обращения — только к `manifestUrl`, Hugging Face и URL эмбеддинга. Device-info снимки (§6) не покидают устройство. |
| Устойчивость | Сетевые операции переживают потерю сети без падения процесса. |
| Логирование | Пробрасываемый `logger` (по умолчанию no-op), без `console.log` в проде библиотеки. |
| Локализация | Библиотека не локализует сообщения — стабильные `code` на ошибках. |
| Лицензии зависимостей | `@capgo/capacitor-downloader` — MPL-2.0 (weak copyleft на уровне файлов плагина) — зафиксировать в ADR. `@capgo/capacitor-device-info` — уточнить лицензию при спайке. |
| Данные пользователя | Чаты/сообщения — локальные, без встроенной синхронизации/экспорта в v1. |
| Версионирование | Semver для npm-пакета; breaking changes в публичном API — только major. |

---

## 15. Фазы реализации

| Фаза | Содержание | Критерий готовности |
|---|---|---|
| **0. Спайки** | `llama-cpp-capacitor` (init/completion/embedding/release/saveSession/loadSession); `loadExtension('sqlite-vec')` на Android и iOS; `@capgo/capacitor-downloader` (резюм после сворачивания и после убийства процесса, `wifi-only`, формат `destination`); `@capgo/capacitor-device-info` (реальные поля snapshot, точность RAM/thermal на паре реальных устройств Android/iOS); точные строки для `Capacitor.isPluginAvailable()` по каждому плагину; потоковый SHA-256 по времени | ADR по каждому пункту |
| **1. Скелет core** | Структура пакета (§3.1), все порты (включая `PlatformSupportPort`, `DeviceInfoPort`, `DownloadTransportPort`), `ManifestService` с независимым diff, `SupportChecker`, `EligibilityService` (чистая функция §6.2) + Node-тесты, каркас CI | `npm test` зелёный на логике манифеста, support и eligibility |
| **2. Download engine** | `DownloadEngine` поверх `DownloadTransportPort`, `NodeRangeDownloadAdapter`, `download_state` в SQL, checksum-верификация | Contract-тест «обрыв на 50% → resume → sha256 валиден» зелёный |
| **3. SQL: система + чаты + вектора + MVP-чаты (режим A)** | Миграции (включая `vector_space`, `chat_messages.status`), `installed_artifacts`/`kv_store`/`download_state`/`chats`/`chat_messages`, `ConversationStore` — `ConversationApi` MVP (`createChat`/`listChats`/`deleteChat`/`getMessages`), `VectorStore` (sqlite-vec + фолбэк) с жёстким `VectorSpaceMismatchError`-guard (§8.2) | Node-тесты: CRUD чатов, каскадное удаление, `VectorStore.search()` на обоих путях + guard-тест на несовпадении пространства |
| **4. Runtime + facade + eligibility-гейт + chat template** | `LlmRuntimePort` (включая `countTokens`), `RuntimeFacade` (с разрешением chat-template по `ModelArtifact.chatTemplate`, §4.1), `CompletionStream`/`CompletionOptions`, `LocalAiClient.checkSupport/checkDeviceEligibility/ensureModelReady/ensureEmbeddingReady/complete/embed`, Node-адаптер `node-llama-cpp`, Capacitor-адаптеры (`llama-cpp-capacitor`, `@capgo/capacitor-device-info`) | Логика фасада зелёная в Node, включая юнит-тесты на пресеты chat-template; ручной smoke-тест на слабом и мощном эмуляторе — `checkDeviceEligibility` даёт разумные вердикты |
| **5. Session-cache + множественные чаты + контекстная политика + `ConversationSyncApi`** | `SessionCache`, `sendMessage()` (MVP), `RuntimeBusyError`, контекстная политика §9.7 (`contextStrategy`/`maxContextTokens`), семантика отмены §9.8 (`status` на сообщениях), независимое обновление модели/эмбеддинга (§5.5/§5.6) с корректной инвалидацией session-файлов, затем `ConversationSyncApi` (`upsertChat`/`appendMessages`, режим B) как надстройка | Node-тест: переключение чатов не теряет историю; длинная переписка усекается по политике, не падает; отмена сохраняет частичный ответ со `status: 'cancelled'`; заметно быстрее второй ответ в том же чате |
| **6. Lifecycle + orphan cleanup** | `releaseRuntime`/`reload`, `autoUnloadOnBackground`, независимый orphan cleanup для модели/эмбеддинга | Node-тест идемпотентности; ручной прогон на устройстве |
| **7. Документация и харденинг** | README, JSDoc-покрытие 100%, TypeDoc-сайт, ADR-архив, таксономия ошибок, пример-приложение (2+ чата, один из них — в режиме B, обновление эмбеддинга отдельно от модели, экран «устройство не поддерживается/не тянет») | Пример-приложение собирается и проходит ручной happy-path |
| **8 (опционально, вне v1)** | Ветвление сообщений, многослотовый LRU session-cache, полнотекстовый поиск по чатам, экспорт/бэкап, `updateMessage`/`deleteMessages` | Отдельное ТЗ по запросу |

---

## 16. Открытые вопросы (нужно решение владельца продукта)

1. **Имя npm-пакета / scope** и лицензия самой библиотеки (важно и для совместимости с MPL-2.0 у `@capgo/capacitor-downloader`).
2. **Конкретная модель и эмбеддинг** для дефолтного манифеста (репозиторий на HF, commit SHA, URL эмбеддинга, реальные `compatibleModelIds`, а также реальные `minRamGb`/`recommendedRamGb` — цифры §6.2 нужно откалибровать бенчмарком, а не доверять эмпирике из этого документа вслепую).
3. **Хостинг файла эмбеддинга** — свой CDN/сервер? Подтвердить совместимость с `@capgo/capacitor-downloader` (кастомные заголовки авторизации, если нужны).
4. **Нужен ли Web/Electron вообще как деградированный режим** (SQL/чаты/downloads работают, инференса нет) — `checkSupport()` теперь это программно обслуживает, но нужно решить, стоит ли вообще прицельно поддерживать non-native сборку.
5. **Обязателен ли `VectorStore`/`sqlite-vec` в v1**, или можно выпустить первую версию с чатами + системными таблицами без готового векторного поиска?
6. **Ограничение на количество/размер чатов** — нужен ли лимит, или неограниченно на усмотрение приложения?
7. **Нужно ли ветвление сообщений (regenerate/edit-and-resubmit)** в v1 — влияет на схему `chat_messages` (§9.5).
7a. **Нужна ли синхронизация редактирования/удаления отдельных сообщений** из БД приложения-хозяина (режим B, §9.6) — в v1 `appendMessages` только добавляет, `content` иммутабелен.
8. **Многослотовый session-cache** — нужен ли в v1 или простого однослотового достаточно (§9.3)?
9. **Политика ретеншена `previousModels[]`/`previousEmbeddings[]`** в манифесте.
10. **Шифрование локальной БД** — нужно ли для целевого приложения.
11. **Монорепо vs single-package** — если библиотека будет использоваться из нескольких приложений с разными потребностями в адаптерах.
12. **CI-инфраструктура для device-e2e** — доступ к macOS-раннерам/Android-эмуляторам, или device-тесты остаются полностью ручными.
13. **Подтверждение выбора `@capgo/capacitor-downloader`** по итогам Phase 0 спайка (резюм после убийства процесса — ключевой дифференциатор).
14. **Дефолтная `eligibilityPolicy`** — блокировать ли устройства с вердиктом `'no'` по умолчанию (`block`), или всегда оставлять решение на приложении (`warn` везде)? В этом ТЗ дефолт — `no → block`, `tight/unknown → warn`, но это продуктовое решение, не техническое.
15. **Насколько строго доверять iOS thermal/low-power сигналам** — публичные API iOS ограничены (нет температуры CPU/GPU впрямую), стоит ли вообще опираться на них в eligibility или ограничиться RAM/диском на iOS.
16. **Стоит ли выпускать `ConversationSyncApi` (`upsertChat`/`appendMessages`, режим B, §9.6) в первом релизе вообще**, или сознательно отложить до отдельного минорного выпуска после стабилизации MVP-набора (`ConversationApi`) — по замечанию из `docs/corrections.txt` про раздувание поверхности API; в Фазах (§15) это уже разнесено по времени (Phase 3 vs Phase 5), но вопрос «войдёт ли в первый npm-релиз» — отдельное решение.
17. **Дефолт `contextStrategy`** (§9.7) — в ТЗ по умолчанию `'truncate-oldest'` (тихо отбрасывает старые сообщения из промпта), альтернатива — `'fail'` (явная ошибка, ничего не отбрасывается молча). Первое лучше для UX «чат никогда не падает», второе честнее и не рискует незаметно потерять важный ранний контекст — нужно продуктовое решение.
18. **Показывать ли `status: 'cancelled'`/`'error'` сообщения в UI по умолчанию** (частичный ответ виден как есть, или приложение сначала решает, прятать ли) — библиотека просто сохраняет и отдаёт `status`, но ожидание от разработчика приложения стоит явно задокументировать примером.
19. **Нужен ли `LlmRuntimePort.countTokens()`** как обязательная часть контракта (точный подсчёт токенов для §9.7), или на первое время достаточно эвристики «символы / 4» без реального вызова токенизатора модели — влияет на то, можно ли простой формулой считать `maxContextTokens` ещё до загрузки модели в память.

---

## 17. Риски

| Риск | Митигация |
|---|---|
| `llama-cpp-capacitor` не готов/заброшен/API разошёлся с README | Спайк Phase 0; порт `LlmRuntimePort` изолирует core от конкретного плагина |
| `sqlite-vec` не грузится на iOS через `loadExtension` | Brute-force TS-фолбэк с задокументированным потолком, contract-тесты |
| `@capgo/capacitor-downloader` не переживает убийство процесса / не резюмится, как ожидалось | Спайк Phase 0 до commit на плагин; запасной адаптер поверх `CapacitorHttp` с ручным Range-циклом (уже спроектирован как Node-эталон, §7.3) |
| `@capgo/capacitor-device-info` недоступен/неточен на части устройств (особенно iOS thermal) | `DeviceInfoPort` — soft-dependency, вердикт `'unknown'` вместо падения; `eligibilityPolicy` для `'unknown'` по умолчанию `'warn'`, не `'block'` |
| Дефолтные пороги `minRamGb`/`recommendedRamGb` (§6.2) неточны для реальных устройств | Явно помечены как «стартовая точка, требует калибровки»; хранятся в манифесте, не в коде — правятся без релиза библиотеки |
| MPL-2.0 у download-плагина конфликтует с политикой лицензий проекта | Явный ADR-чек до интеграции; фолбэк-адаптер без сторонней лицензии |
| Потоковый SHA-256 на устройстве слишком медленный для UX | Замер в Phase 0; фоновое хеширование с прогрессом |
| Hugging Face rate-limit/региональная недоступность | Пиннинг revision + типизированная ошибка + resume не теряет прогресс |
| Расхождение поведения Node-тестового адаптера и настоящего Capacitor-адаптера | Contract-тесты как source of truth + обязательный ручной smoke-тест на устройстве при изменении native-пути |
| Эмбеддинг обновляется чаще модели, приложение забывает обработать `vector-store:embedding-changed` и получает семантически неверный, но технически валидный результат поиска | ~~Раньше — только событие + надежда, что приложение обработает.~~ Теперь **жёсткий guard**: `VectorStore` хранит `vector_space` и сравнивает его с текущим активным эмбеддингом при каждом `upsert`/`search`, несовпадение → `VectorSpaceMismatchError`, а не тихий неверный результат (§8.2) |
| Много чатов + общий рантайм → пользователь ожидает параллельные ответы, получает `RuntimeBusyError` | Явно задокументированное ограничение с рекомендуемым UX-паттерном |
| Session-cache файлы растут на диске при активном использовании многих чатов | v1 — только один «горячий» слот (§9.3) |
| Слишком строгий `eligibilityPolicy: 'block'` по умолчанию раздражает пользователей на границе порога (`'tight'` трактуется как обычный `'no'` в UI приложения) | Явно различаем `'tight'` (предупреждение) и `'no'` (блок) в API и документации, не сливаем в один булев флаг |
| `releaseRuntime()` вызывается чаще, чем нужно, UX деградирует | `autoUnloadOnBackground` — осознанный opt-in, не default |
| Длинная переписка превышает `contextLength` модели без явной политики → падение или неопределённое поведение рантайма | `contextStrategy`/`maxContextTokens` (§9.7), дефолт `'truncate-oldest'` — тихо не роняет чат, но помечен как открытый продуктовый вопрос (§16.17) |
| Неясно, что происходит с частичным ответом при отмене/сбое генерации → тестами это не покрыть, поведение будет расходиться между реализациями | Явная таблица статусов `complete`/`cancelled`/`error` (§9.8), user-сообщение сохраняется до старта генерации |
| Приложение вручную собирает сырой prompt в обход chat-template модели → деградация качества при смене модели в манифесте | API принципиально не принимает сырую prompt-строку, только `messages`; шаблон разрешается `RuntimeFacade` по `ModelArtifact.chatTemplate`/GGUF-метаданным (§4.1) |
| `llama-cpp-capacitor` (или выбранный по итогам спайка плагин) не применяет chat-template из GGUF-метаданных сам, а фолбэк-реестр шаблонов (Qwen/Llama/Gemma/Mistral) в библиотеке не покрывает нужное семейство | Явный override `ModelArtifact.chatTemplate`; Phase 0 спайк проверяет это до commit на архитектуру; реестр расширяем без релиза-breaking change (новый пресет — не breaking) |
| Гибридный `AsyncIterable & Promise` (первый черновик API) было бы сложно реализовать/тестировать надёжно | Заменено на явный `CompletionStream<T>` (`for await` + `.result`), см. §10.0 — устраняет саму причину риска |

---

## 18. Источники

- Внутренние: [`docs/initial/2026-08-08-local-ai-llama-cpp-plan.md`](./initial/2026-08-08-local-ai-llama-cpp-plan.md), [`docs/initial/2026-08-08-local-ai-knowledge-rag-plan.md`](./initial/2026-08-08-local-ai-knowledge-rag-plan.md), [`docs/initial/research1.txt`](./initial/research1.txt), [`docs/initial/research2.txt`](./initial/research2.txt)
- `llama-cpp-capacitor` / `arusatech/llama-cpp` — npm/GitHub (API инференса, session save/load, LoRA — не используется)
- `sqlite-vec` (`asg017/sqlite-vec`) — векторное расширение SQLite, кроссплатформенное, есть Node-биндинги
- `@capacitor-community/sqlite` — Capacitor SQLite-плагин, `loadExtension`/`enableLoadExtension`
- **`@capgo/capacitor-downloader`** (GitHub `Cap-go/capacitor-downloader`, npm `@capgo/capacitor-downloader`) — основной download-транспорт, MPL-2.0
- **`@capgo/capacitor-device-info`** (GitHub `Cap-go/capacitor-device-info`) — CPU/память/GPU/storage/thermal/low-power/сенсоры, снимок или мониторинг; источник для `DeviceInfoPort`
- Capacitor core API — `Capacitor.isNativePlatform()`, `Capacitor.getPlatform()`, `Capacitor.isPluginAvailable()` — официальный механизм для `checkSupport()`
- `@capacitor/filesystem`, `@capacitor/app`, `@capacitor/device` — официальная документация Capacitor
- `node-llama-cpp` (`withcatai/node-llama-cpp`) — Node-биндинги llama.cpp, тестовый адаптер, не прод-рантайм
- `ggml-org/llama.cpp` wiki — «Templates supported by `llama_chat_apply_template`» — подтверждение, что GGUF несёт `tokenizer.chat_template` (Jinja2) в метаданных и llama.cpp применяет его нативно (`minja`) без внешних Python-зависимостей; основа для §4.1
- Замечания по API-эргономике, безопасности векторного поиска, политике контекстного окна и семантике отмены — `docs/corrections.txt` (внешняя рецензия черновика v3 этого ТЗ, учтена в v4)
- Оценка RAM для 4B Q4_K_M (~2.2–2.9 GB) и рекомендация «минимум 8 GB RAM для телефонов на 3–4B моделях» — из общедоступных практических гайдов по деплою GGUF-моделей на мобильные устройства (2026); цифры зафиксированы как стартовая точка для калибровки, не как гарантия
- Hugging Face — модели семейства Qwen3 (LLM 4B-класс и Embedding 0.6B-класс) как ориентир мультиязычности для дефолтного манифеста (окончательный выбор — открытый вопрос §16.2)
