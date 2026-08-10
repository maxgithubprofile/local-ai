/**
 * Typed error hierarchy for the public API — TZ §10.2. Every subclass sets a
 * stable `code` string that must never change between versions (consumers
 * are expected to switch on `code`, not on `message` or `instanceof` across
 * package boundaries in case of duplicate installs) — see CLAUDE.md.
 */
export class LocalAiError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** TZ §6.1 — `checkSupport()` reports `capabilities.inference === false`. */
export class PlatformNotSupportedError extends LocalAiError {
  constructor(message: string, options?: ErrorOptions) {
    super('platform_not_supported', message, options);
  }
}

/** TZ §6.2/§6.4 — eligibility verdict is `'no'` and `eligibilityPolicy` is `'block'`. */
export class DeviceNotEligibleError extends LocalAiError {
  constructor(message: string, options?: ErrorOptions) {
    super('device_not_eligible', message, options);
  }
}

/** Manifest could not be fetched (network/HTTP failure), TZ §5.4. */
export class ManifestFetchError extends LocalAiError {
  constructor(message: string, options?: ErrorOptions) {
    super('manifest_fetch_failed', message, options);
  }
}

/** Manifest was fetched but failed schema/consistency validation, TZ §5.2. */
export class ManifestValidationError extends LocalAiError {
  constructor(message: string, options?: ErrorOptions) {
    super('manifest_invalid', message, options);
  }
}

/** Base class for artifact download failures, TZ §7. */
export class DownloadError extends LocalAiError {
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
  }
}

/** Downloaded artifact's SHA-256 does not match the manifest, TZ §7.1/§14. */
export class ChecksumMismatchError extends DownloadError {
  constructor(message: string, options?: ErrorOptions) {
    super('checksum_mismatch', message, options);
  }
}

/** Not enough free disk space for the artifact, TZ §6.2. */
export class InsufficientStorageError extends DownloadError {
  constructor(message: string, options?: ErrorOptions) {
    super('insufficient_storage', message, options);
  }
}

/** Native LLM/embedding runtime failed to initialize, TZ §10.2. */
export class RuntimeInitError extends LocalAiError {
  constructor(message: string, options?: ErrorOptions) {
    super('runtime_init_failed', message, options);
  }
}

/** A generation is already in progress on the single shared runtime context, TZ §9.4. */
export class RuntimeBusyError extends LocalAiError {
  constructor(message: string, options?: ErrorOptions) {
    super('runtime_busy', message, options);
  }
}

/** A saved session file is missing/corrupt/incompatible with the current model version, TZ §9.3. */
export class SessionIncompatibleError extends LocalAiError {
  constructor(message: string, options?: ErrorOptions) {
    super('session_incompatible', message, options);
  }
}

/** VectorStore guard: the requested embedding space doesn't match `vector_space`, TZ §8.2. */
export class VectorSpaceMismatchError extends LocalAiError {
  constructor(message: string, options?: ErrorOptions) {
    super('vector_space_mismatch', message, options);
  }
}

/** `contextStrategy: 'fail'` and the prompt does not fit `maxContextTokens`, TZ §9.7. */
export class ContextWindowExceededError extends LocalAiError {
  constructor(message: string, options?: ErrorOptions) {
    super('context_window_exceeded', message, options);
  }
}
