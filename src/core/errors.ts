/**
 * Typed error hierarchy for the public API — TZ §10.2. Every subclass sets a
 * stable `code` string that must never change between versions (consumers
 * are expected to switch on `code`, not on `message` or `instanceof` across
 * package boundaries in case of duplicate installs) — see CLAUDE.md.
 */
export class LocalAiError extends Error {
  readonly code: string;

  /** @param code Stable machine-readable error code — never changes once shipped. @param message Human-readable detail. @param options Standard `ErrorOptions` (e.g. `cause`). */
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** TZ §6.1 — `checkSupport()` reports `capabilities.inference === false`. */
export class PlatformNotSupportedError extends LocalAiError {
  /** @param message Human-readable detail, typically `SupportReport.reasons` joined. @param options Standard `ErrorOptions`. */
  constructor(message: string, options?: ErrorOptions) {
    super('platform_not_supported', message, options);
  }
}

/** TZ §6.2/§6.4 — eligibility verdict is `'no'` and `eligibilityPolicy` is `'block'`. */
export class DeviceNotEligibleError extends LocalAiError {
  /** @param message Human-readable detail, typically `EligibilityReport.reasons` joined. @param options Standard `ErrorOptions`. */
  constructor(message: string, options?: ErrorOptions) {
    super('device_not_eligible', message, options);
  }
}

/** Manifest could not be fetched (network/HTTP failure), TZ §5.4. */
export class ManifestFetchError extends LocalAiError {
  /** @param message Human-readable detail. @param options Standard `ErrorOptions`. */
  constructor(message: string, options?: ErrorOptions) {
    super('manifest_fetch_failed', message, options);
  }
}

/** Manifest was fetched but failed schema/consistency validation, TZ §5.2. */
export class ManifestValidationError extends LocalAiError {
  /** @param message Human-readable detail — includes every failed rule, not just the first. @param options Standard `ErrorOptions`. */
  constructor(message: string, options?: ErrorOptions) {
    super('manifest_invalid', message, options);
  }
}

/** Base class for artifact download failures, TZ §7. */
export class DownloadError extends LocalAiError {
  /** @param code Stable machine-readable code for this specific download failure kind. @param message Human-readable detail. @param options Standard `ErrorOptions`. */
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
  }
}

/** Downloaded artifact's SHA-256 does not match the manifest, TZ §7.1/§14. */
export class ChecksumMismatchError extends DownloadError {
  /** @param message Human-readable detail. @param options Standard `ErrorOptions`. */
  constructor(message: string, options?: ErrorOptions) {
    super('checksum_mismatch', message, options);
  }
}

/** Not enough free disk space for the artifact, TZ §6.2. */
export class InsufficientStorageError extends DownloadError {
  /** @param message Human-readable detail. @param options Standard `ErrorOptions`. */
  constructor(message: string, options?: ErrorOptions) {
    super('insufficient_storage', message, options);
  }
}

/** Native LLM/embedding runtime failed to initialize, TZ §10.2. */
export class RuntimeInitError extends LocalAiError {
  /** @param message Human-readable detail. @param options Standard `ErrorOptions`. */
  constructor(message: string, options?: ErrorOptions) {
    super('runtime_init_failed', message, options);
  }
}

/** A generation is already in progress on the single shared runtime context, TZ §9.4. */
export class RuntimeBusyError extends LocalAiError {
  /** @param message Human-readable detail. @param options Standard `ErrorOptions`. */
  constructor(message: string, options?: ErrorOptions) {
    super('runtime_busy', message, options);
  }
}

/** A saved session file is missing/corrupt/incompatible with the current model version, TZ §9.3. */
export class SessionIncompatibleError extends LocalAiError {
  /** @param message Human-readable detail. @param options Standard `ErrorOptions`. */
  constructor(message: string, options?: ErrorOptions) {
    super('session_incompatible', message, options);
  }
}

/** VectorStore guard: the requested embedding space doesn't match `vector_space`, TZ §8.2. */
export class VectorSpaceMismatchError extends LocalAiError {
  /** @param message Human-readable detail — which space was expected vs. given. @param options Standard `ErrorOptions`. */
  constructor(message: string, options?: ErrorOptions) {
    super('vector_space_mismatch', message, options);
  }
}

/** `contextStrategy: 'fail'` and the prompt does not fit `maxContextTokens`, TZ §9.7. */
export class ContextWindowExceededError extends LocalAiError {
  /** @param message Human-readable detail. @param options Standard `ErrorOptions`. */
  constructor(message: string, options?: ErrorOptions) {
    super('context_window_exceeded', message, options);
  }
}

/**
 * `LocalAiConfig` is missing something `LocalAiClient.create()` needs to
 * proceed — most commonly an incomplete `ports` object. `core/**` cannot
 * import concrete adapters (hexagonal boundary, CLAUDE.md), so it cannot
 * fill in a missing port itself; the consumer must supply every
 * `LocalAiPorts` key (typically by spreading a platform's
 * `create*Ports()`-style helper — see `adapters/capacitor/index.ts` — with
 * any test overrides on top).
 */
export class ConfigInvalidError extends LocalAiError {
  /** @param message Human-readable detail — names exactly which config/port is missing or invalid. @param options Standard `ErrorOptions`. */
  constructor(message: string, options?: ErrorOptions) {
    super('config_invalid', message, options);
  }
}
