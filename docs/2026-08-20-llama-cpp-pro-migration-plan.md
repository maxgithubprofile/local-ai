# Переход `llama-cpp-capacitor` → `llama-cpp-pro`

Дата: 2026-08-20. Статус: план, не начато. Живёт в `local-ai`, потому что весь физический объём
работы (порт, адаптер, `package.json`, ADR) — здесь; `forta.chat` в этом переходе только меняет
версию зависимости и пересобирается (см. §5). Продолжение
[Forta Chat's перф-тюнинг-плана](C:\inetpub2025\forta.chat\docs\plans\llama2\2026-08-20-local-ai-perf-tuning-plan.md)
— при сравнении альтернатив нативному плагину всплыл `llama-cpp-pro`. В этот раз проверено не по
README, а по собственному принципу этого репозитория из [ADR 0001](./adr/0001-llama-cpp-capacitor-api.md)
(«не верить README, сверять с реальным пакетом») — через **реальную распакованную tarball** пакета
(`npm pack llama-cpp-pro@0.2.4`, распаковано и прочитано построчно) в сравнении с уже установленным
`llama-cpp-capacitor@0.1.5` в `node_modules`.

## TL;DR

**Это не «другой плагин» — это тот же самый проект под новым именем.** `CHANGELOG.md` пакета,
раздел `[Unreleased]`:

> **Package rename:** npm package and GitHub repository are now **`llama-cpp-pro`** (formerly
> `llama-cpp-capacitor` / `annadata-llama-cpp`). Install with `npm install llama-cpp-pro`. Existing
> `llama-cpp-capacitor` publishes on npm remain available.

Тот же автор (`ai.annadata`/arusatech), тот же Java-пакет (`ai.annadata.plugin.capacitor`), та же
регистрация плагина (`@CapacitorPlugin(name = "LlamaCpp")` — совпадает с [ADR 0001](./adr/0001-llama-cpp-capacitor-api.md)'s
находкой один-в-один). `llama-cpp-capacitor@0.1.5` — это застывший снапшот проекта на декабрь 2024;
разработка продолжилась под новым именем и дошла до `0.2.4` (июль 2026), включая **реальные
бэкенд-фиксы на Android**, которых текущая закреплённая версия не имеет.

| Проверено чем | Вывод |
|---|---|
| `diff` двух `types/*.d.ts` (после нормализации имени модуля) | **Побайтово идентичны.** Ноль отличий в публичном TS API — `initLlama()`, `LlamaContext`, `ContextParams`, `CompletionParams`, все поля |
| `android/build.gradle` | Идентичен (тот же `minSdkVersion`/`compileSdk`/NDK `29.0.13113456`/`abiFilters 'arm64-v8a'`) — minSdk 24 (Android 7, `forta.chat/CLAUDE.md`'s ограничение) не затронут |
| `android/src/main/CMakeLists-arm64.txt` | Тот же CPU-only компилят (`-DLM_GGML_USE_CPU -DLM_GGML_CPU_GENERIC`, Cortex-A76 тюнинг) — GPU (Vulkan/OpenCL) **не скомпилирован в Android-бинарь ни в одном из двух пакетов**, см. §2 |
| Размер прекомпилированного `.so` (`arm64-v8a`) | `llama-cpp-capacitor`: **58.3 MB** (без strip) → `llama-cpp-pro`: **6.8 MB** (stripped) — см. §3 |
| `CHANGELOG.md` записи `[0.2.1]` | Реальные фиксы на Android-стороне: session save/load (было hardcoded zeros!), проброс 20+ сэмплинг-параметров (было только 3), LoRA, multimodal, TTS — см. §4 |
| `peerDependencies["@capacitor/core"]` | `>=6.0.0` — совместимо с Capacitor 8.x в `forta.chat` |

**Вывод: миграция вероятна к выполнению, и это не рискованная замена вендора, а обновление того же
пакета с переименованием.** GPU (Vulkan) на Android — не аргумент за переход (см. §2, отсутствует в
обоих). Аргументы за переход — реальные Android-баги в текущей закреплённой версии (§4) и радикальное
снижение веса APK (§3).

## 1. Что не изменилось (не аргумент ни за, ни против)

TS-типы, структура `cpp/`-исходников (тот же вендоренный набор `ggml.c`/`llama-*.cpp`/`chat.cpp` и
т.д.), архитектура плагина (top-level `initLlama()` → `LlamaContext`-инстанс с методами) — всё
идентично. `LlamaCppCapacitorAdapter` (`src/adapters/capacitor/llama-cpp-capacitor.adapter.ts`) не
потребует переписывания логики, только смены источника типов/импорта (см. §5).

## 2. GPU на Android — по-прежнему отсутствует в обоих пакетах

Из более раннего обсуждения (Vulkan/OpenCL) — проверено и в новом пакете: `cpp/` в `llama-cpp-pro`
содержит `ggml-cpu/`, а также **`ggml-metal.*`** (новое — Metal-бэкенд для iOS/macOS, отсутствовал в
`llama-cpp-capacitor`), но **не** `ggml-vulkan`/`ggml-opencl`/`ggml-cuda`. `android/src/main/CMakeLists-arm64.txt`
компилирует ровно тот же список источников, что и раньше, с тем же `-DLM_GGML_USE_CPU`, без единого
упоминания `GGML_VULKAN`/`GGML_OPENCL`. Пакет также содержит `cmake/ggml-backends.cmake`, который
**может** собрать `libggml-vulkan.so`/`libggml-cuda.so`/`libggml-hip.so` — но это для **десктопного
sidecar** (`sidecar/CMakeLists.txt`, Electron), требует отдельный полный чекаут апстримного
`llama.cpp` (`LLAMA_CPP_UPSTREAM`) и вообще не участвует в Android-сборке. README-шная фраза про
«Vulkan» относится к десктопу/iOS-Metal, не к Android — ровно то расхождение с README, которое
стоило проверить руками, а не поверить строке в описании пакета.

**Итог по GPU: миграция на `llama-cpp-pro` ничего не меняет по части ускорения на Android.** Отдельный
Vulkan-спайк (если решится делаться) остаётся отдельной, гораздо более дорогой задачей независимо от
того, какой из двух пакетов используется.

## 3. Размер `.so` — конкретный, измеримый выигрыш

```
llama-cpp-capacitor/android/.../jniLibs/arm64-v8a/libllama-cpp-arm64.so  58 354 360 байт (~58.3 MB)
llama-cpp-pro/android/.../jniLibs/arm64-v8a/libllama-cpp-arm64.so         7 095 896 байт (~6.8 MB)
```

`CHANGELOG.md`, версия `[0.2.1]`, раздел «Changed»:
> **App store size**: Build only **arm64-v8a** for Android (drop armeabi-v7a); strip iOS framework
> and Android `.so` debug symbols. See `APP_STORE_SIZE.md`.

`forta.chat`'s собственный план (`C:\inetpub2025\forta.chat\docs\plans\llama2\README.md`) фиксирует
замер: «`local-ai` + 4 нативных плагина добавляют **+24 MB** (сжато) на `arm64-v8a` (debug-сборка) —
почти целиком один файл, `libllama-cpp-arm64.so`». Если новая версия действительно даёт ~8.6× меньший
бинарь (несжатый размер; сжатое соотношение в APK нужно перепроверить отдельным замером, не
экстраполировать линейно) — это прямое попадание в основную цель проекта-потребителя (одинаково
стабильная работа на слабых/старых Android-устройствах, где место на диске и объём загрузки APK тоже
ограничение, отдельно от скорости инференса).

## 4. Реальные Android-баги, зафиксированные как исправленные в `[0.2.1]`

Прямые цитаты из `CHANGELOG.md` (не вывод/интерпретация — переписаны как есть):

- **Session save/load**: *«Android — Session management: Java `loadSession`/`saveSession` now call
  `loadSessionNative`/`saveSessionNative` backed by `llama_state_load_file`/`llama_state_save_file`»*
  — в разделе «Fixed»: *«iOS/Android `loadSession`/`saveSession`: Was returning hardcoded zeros — now
  persists/restores actual KV-cache state.»*
- **Проброс сэмплинг-параметров**: *«Android — Completion param propagation: All 20+ sampling
  parameters now extracted from `JSObject` and forwarded to `common_params::sampling` (previously only
  `temperature`, `n_predict`, `prompt`)»*.
- **Rerank/bench/LoRA/Multimodal/TTS** — аналогично, были заглушками/моками на Android до `0.2.1`.

### Прямое следствие для уже сделанной и запланированной работы

1. **`SessionCache`** (`src/core/conversations/session-cache.ts`) уже вызывает
   `saveSession`/`loadSession` из `LocalAiClient.sendMessage()`. Это реализовано на уровне
   JS/TS-кода `local-ai` корректно. **Но если баг из CHANGELOG относится и к версии `0.1.5`**
   (не проверено напрямую — CHANGELOG не даёт точной версии, с которой был баг, только то, что фикс
   вошёл в `0.2.1`) — вызовы `saveSession`/`loadSession` на Android в `forta.chat`'s текущей сборке
   могли **молча ничего не делать** всё это время, что прямо объясняет часть жалоб «долго отвечает»
   (KV-кэш никогда реально не переиспользуется между сообщениями, даже когда код думает, что
   переиспользует). **Требует верификации на устройстве** до и после миграции — см. §7.
2. **`forta.chat`'s перф-тюнинг-план, пункты 1-3** (`enable_thinking`, `n_threads`,
   `n_batch`/`n_ubatch`) — если на Android в `0.1.5` реально прокидывались в нативный слой только
   `temperature`/`n_predict`/`prompt` (как явно написано в CHANGELOG), то **любые другие поля,
   которые сейчас передаются в `initLlama()`/`completion()` на Android, потенциально no-op**. Это
   меняет порядок работ — см. §8.

## 5. Что физически меняется — по репозиториям

### `local-ai` (этот репозиторий)

1. `package.json`:
   - `peerDependencies.llama-cpp-capacitor` (`>=0.1.5`) → `peerDependencies["llama-cpp-pro"]` (`>=0.2.4`).
   - `peerDependenciesMeta` — тот же ключ.
   - `devDependencies["llama-cpp-capacitor"]` (`^0.1.5`) → `devDependencies["llama-cpp-pro"]` (`^0.2.4`).
2. `src/adapters/capacitor/llama-cpp-capacitor.adapter.ts`:
   - `import { initLlama } from 'llama-cpp-capacitor'` → `from 'llama-cpp-pro'` (и второй `import
     type`). Тело адаптера **не меняется** — API идентичен (§ TL;DR).
   - Рассмотреть переименование файла в `llama-cpp-pro.adapter.ts` и класса
     `LlamaCppCapacitorAdapter` → `LlamaCppProAdapter` — **отдельное решение**, не обязательное для
     функциональности (плагин-имя в манифесте Capacitor остаётся `'LlamaCpp'` независимо от имени
     npm-пакета/класса-обёртки). Если переименовывать — синхронно везде: `src/adapters/capacitor/index.ts`'s
     export, `docs/adr/0005-native-plugin-name-constants.md`'s таблица, все doc-комментарии,
     перечисленные ниже.
3. Обновить doc-комментарии, ссылающиеся на старое имя пакета по существу (не историю):
   `src/core/ports/llm-runtime.port.ts:5`, `src/core/runtime/runtime-facade.ts:49` (упоминание
   конкретно версии/бага — уточнить, актуален ли он ещё в `0.2.4`, см. §7),
   `src/core/runtime/reasoning-content.ts:3`, `src/core/utils/async-token-queue.ts:3`.
4. **Новый ADR** — `docs/adr/0008-llama-cpp-pro-migration.md` (следующий свободный номер — `0006`/
   `0007` уже заняты streaming-sha256-timing/sqlite-plugin-choice), по образцу ADR 0001: фиксирует
   находки этого документа (diff `.d.ts` побайтово, размер `.so`, CHANGELOG-цитаты) как формальное
   решение библиотеки, не только план-документ.
5. `docs/adr/0005-native-plugin-name-constants.md`'s таблица (плагин `inference` →
   `llama-cpp-capacitor@0.1.5` → строка `'LlamaCpp'`) — обновить версию пакета в этой строке.
6. Тесты (`test/unit/adapters/llama-cpp-capacitor.adapter.test.ts`) — `vi.mock('llama-cpp-capacitor', ...)`
   → `vi.mock('llama-cpp-pro', ...)`, при переименовании файла — переименовать и сам тестовый файл.

### `forta.chat` (`C:\inetpub2025\forta.chat`, потребитель)

1. `package.json:76` — `"llama-cpp-capacitor": "^0.1.5"` → `"llama-cpp-pro": "^0.2.4"`.
2. `npm install` — подтянет новый пакет (locked через `package-lock.json`, тоже обновится). `local-ai`
   продолжает устанавливаться как `file:`-зависимость (`device-ai-loop.md`'s объяснение symlink-механики
   не меняется этим переходом).
3. `npx cap sync android` — перегенерирует `android/capacitor.settings.gradle`,
   `android/app/capacitor.build.gradle`, `android/app/src/main/assets/capacitor.plugins.json` (все три
   — автогенерируемые файлы, уже сейчас содержат `llama-cpp-capacitor`, руками не трогать, только
   пересобрать).
4. `src/entities/local-ai/lib/create-client.ts` — **не требует изменений по существу**: импортирует
   класс через `local-ai/adapters/capacitor` (не напрямую из `llama-cpp-capacitor`/`llama-cpp-pro`),
   так что переименование внутри `local-ai` (если решено переименовать класс, см. выше) — единственное,
   что здесь может потребовать правки (`LlamaCppCapacitorAdapter` → `LlamaCppProAdapter` в
   деструктуризации `await import(...)`).
5. `docs/plans/llama2/decisions.md`'s замер «+24 MB APK» — оставить как есть (исторический замер),
   добавить новую запись после повторного замера на `llama-cpp-pro` (см. §7).

## 6. Что НЕ трогаем в этом плане

- `docs/2026-08-10-local-ai-library-tz.md`, `docs/initial/**`, `docs/typedoc/media/**` (авто-сгенерированное
  зеркало typedoc) — исторические/архивные документы, фиксирующие решение на момент Phase 0 (спайк
  0.1). Переписывать историю не нужно; при желании — одна сноска в начале `decisions.md` вида «см. ADR
  0008 — пакет с 2026-08 называется `llama-cpp-pro`», не более.
- iOS/Web/Electron-специфичные части нового пакета (Metal, WASM, `desktop/`-Electron-sidecar) — вне
  объёма, `forta.chat`'s AI-таб — Android-only на первой итерации (`isNative`/`checkSupport()`).

## 7. Верификация перед тем, как считать миграцию завершённой

Согласование с `forta.chat`'s `device-ai-loop.md` (`C:\inetpub2025\forta.chat\docs\plans\llama2\device-ai-loop.md`)
— все пункты требуют реального устройства, не проходят в `npm run test`/`vitest`:

1. **Session persistence реально работает** (§4 п.1) — до миграции: замерить задержку до первого
   токена второго подряд сообщения в одном чате (должна теоретически быть быстрее первого, если
   `SessionCache` реально переиспользует KV-кэш). После миграции — повторить тот же замер тем же
   методом. Если «до» и «после» неотличимы — либо баг был не в `llama-cpp-capacitor@0.1.5` (CHANGELOG
   не называет точную версию бага), либо в `SessionCache`'s собственной логике есть отдельная
   проблема — заводить отдельный баг в `local-ai`, не считать частью этого плана.
2. **Размер APK** — собрать debug/release APK на `llama-cpp-pro`, сравнить с зафиксированным в
   `forta.chat`'s `decisions.md` замером «+24 MB» на `llama-cpp-capacitor`. Записать новое число туда же.
3. **Полный smoke через `device-ai-loop.md`'s loop** — скачивание модели, загрузка в рантайм, отправка
   сообщения, стриминг, отмена генерации, переключение между чатами (session cache slots) — все пункты
   `forta.chat`'s `qa-checklist-phase7.md`, не только новые для этого перехода.
4. **Регрессия на известный jinja-баг** (`llama-cpp-capacitor.adapter.ts`'s комментарий, «Cannot
   destructure property 'minja' of undefined», зафиксирован 2026-08-19) — проверить, всё ещё ли
   воспроизводится с той же моделью на `0.2.4`; если исправлен — можно рассмотреть упрощение
   fallback-логики адаптера отдельной задачей (не частью этой миграции, чтобы не смешивать «обновили
   пакет» и «убрали defensive-код» в одном PR — второе стоит делать отдельно и осторожно, только после
   того как баг подтверждённо не воспроизводится на нескольких моделях/устройствах, не одного
   успешного прогона).
5. **`runtime-facade.ts`'s баг** («Android JNI layer silently substitutes hardcoded `n_predict = 50`»)
   — тоже проверить, не исчез ли в `0.2.4` (CHANGELOG прямо не упоминает, но раз 20+ параметров теперь
   реально прокидываются — вероятно, связано). Если фикс подтверждён — код, который сейчас защищается
   от этого (`DEFAULT_COMPLETION_MAX_TOKENS`-принудительная подстановка в `RuntimeFacade.complete()`),
   **не убирать** — это полезный choke-point независимо от конкретного плагина (принцип «не
   завязываться на баги одного плагина»), просто комментарий можно уточнить, что баг был специфичен
   для `<0.2.1`.

## 8. Порядок относительно `forta.chat`'s перф-тюнинг-плана

**Рекомендация: выполнить эту миграцию ДО [перф-тюнинг-плана](C:\inetpub2025\forta.chat\docs\plans\llama2\2026-08-20-local-ai-perf-tuning-plan.md),
не после и не параллельно.** Причина — §4 п.2: если на Android в `0.1.5` реально прокидывались в
нативный слой только 3 параметра из объекта, то часть работы перф-плана (`n_threads`, возможно
`enable_thinking`, точно `n_batch`/`n_ubatch`/`flash_attn`/`cache_type_k/v`, которых в старом
CHANGELOG-списке «only temperature, n_predict, prompt» точно не было) **может не доходить до
нативного кода вообще** на текущей версии, независимо от того, насколько правильно она реализована
на TS-стороне. Замер эффекта каждой фазы перф-плана (её собственная таблица `tgAvg` до/после) не
будет достоверным, пока не подтверждено, что параметры физически долетают до `llama.cpp`.

Обновление статуса: `forta.chat`'s перф-план должен получить эту миграцию как **Фазу 0**,
предшествующую всем шести пунктам — правка уже внесена туда (блок-цитата в начале документа).

## 9. Чеклист перед коммитом/PR

**`local-ai` (этот репозиторий):**
- [ ] `npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build`
- [ ] Новый ADR `0008` записан (§5 п.4)
- [ ] `docs/adr/0005`'s таблица обновлена (§5 п.5)

**`forta.chat`:**
- [ ] `npm run build && npm run lint && npx vue-tsc --noEmit && npm run test`
- [ ] `npx cap sync android` прогнан, автогенерируемые файлы (§5) актуальны
- [ ] Полный прогон §7 на реальном устройстве через `device-ai-loop.md`
- [ ] Новый замер APK записан в `decisions.md`
- [ ] Code review (масштаб «замена зависимости + верификация», не архитектурный рефакторинг)

## 10. Риски и откат

- **Риск низкий** относительно типового «смени вендора» — подтверждено байт-в-байт идентичным API,
  идентичным `build.gradle`/CMake, тем же автором/пакетом под новым именем.
- **Главный неизвестный** — версии `0.2.2`-`0.2.4` **не описаны в `CHANGELOG.md`** (последняя запись
  — `[0.2.1]` от 2025-07-07, `[Unreleased]` содержит только факт переименования; текущая опубликованная
  версия — `0.2.4`). Это разрыв в документации самого пакета — ровно та ситуация, которую ADR 0001
  уже проходил («не верить README»): между `0.2.1` и `0.2.4` могли быть недокументированные изменения
  API/поведения. Проверка реального дифа сделана только против `0.2.4` напрямую (не против
  промежуточных версий) — принимаем `0.2.4` как единственную точку сверки и полагаемся на §7's
  реальную верификацию на устройстве как на главный источник истины, не на CHANGELOG.
- **Откат** — `file:`/`npm install` откатывается тривиально (`package.json` обратно на
  `llama-cpp-capacitor@^0.1.5`, `npm install`, `cap sync`) — обе версии пакета продолжают публиковаться
  на npm (CHANGELOG explicitly: «Existing `llama-cpp-capacitor` publishes on npm remain available»),
  так что откат не блокирован снятием старого пакета с реестра.
