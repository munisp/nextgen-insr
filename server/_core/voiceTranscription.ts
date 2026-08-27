/**
 * Voice transcription helper using internal Speech-to-Text service
 *
 * Frontend implementation guide:
 * 1. Capture audio using MediaRecorder API
 * 2. Upload audio to storage (e.g., S3) to get URL
 * 3. Call transcription with the URL
 *
 * Example usage:
 * ```tsx
 * // Frontend component
 * const transcribeMutation = trpc.voice.transcribe.useMutation({
 *   onSuccess: (data) => {
 *     logger.info(data.text); // Full transcription
 *     logger.info(data.language); // Detected language
 *     logger.info(data.segments); // Timestamped segments
 *   }
 * });
 *
 * // After uploading audio to storage
 * transcribeMutation.mutate({
 *   audioUrl: uploadedAudioUrl,
 *   language: 'en', // optional
 *   prompt: 'Transcribe the meeting' // optional
 * });
 * ```
 */
import { ENV } from "./env";

export type TranscribeOptions = {
  audioUrl: string; // URL to the audio file (e.g., S3 URL)
  language?: string; // Optional: specify language code (e.g., "en", "es", "zh")
  prompt?: string; // Optional: custom prompt for the transcription
};

// Native Whisper API segment format
export type WhisperSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

// Native Whisper API response format
export type WhisperResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
};

export type TranscriptionResponse = WhisperResponse; // Return native Whisper API response directly

export type TranscriptionError = {
  error: string;
  code:
    | "FILE_TOO_LARGE"
    | "INVALID_FORMAT"
    | "TRANSCRIPTION_FAILED"
    | "UPLOAD_FAILED"
    | "SERVICE_ERROR"
    | "URL_NOT_ALLOWED";
  details?: string;
};

/**
 * DD-TSSEC (A7-15): SSRF guard for the audio download step. The server must
 * never fetch an arbitrary caller-supplied URL — that is a textbook SSRF
 * into internal services / cloud metadata endpoints.
 *
 * Policy (fail-closed):
 *  - https: scheme only (no http:, file:, data:, gopher:, …)
 *  - no embedded credentials (user:pass@host)
 *  - hostname must appear in the VOICE_TRANSCRIPTION_ALLOWED_HOSTS env
 *    allowlist (comma-separated; an entry also matches its subdomains)
 *  - an EMPTY allowlist allows NOTHING — the fetch is refused
 *  - IP-literal hosts in loopback/private/link-local/metadata ranges are
 *    refused even if allowlisted, as defense-in-depth
 */
export function validateAudioUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "audioUrl is not a valid URL" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: `scheme "${url.protocol}" is not allowed — only https:` };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not allowed" };
  }

  const hostname = url.hostname.toLowerCase();

  // Refuse IP literals in non-public ranges even if an operator allowlists
  // them by mistake (cloud metadata 169.254.169.254, loopback, RFC-1918…).
  const literal = hostname.replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(literal)) {
    const [a, b] = literal.split(".").map(Number);
    const nonPublic =
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0;
    if (nonPublic) {
      return { ok: false, reason: "IP-literal hosts in private/loopback/metadata ranges are not allowed" };
    }
  }
  if (literal === "::1" || literal.startsWith("fe80:") || literal.startsWith("fc") || literal.startsWith("fd")) {
    return { ok: false, reason: "IP-literal hosts in private/loopback/metadata ranges are not allowed" };
  }

  const allowlist = (process.env.VOICE_TRANSCRIPTION_ALLOWED_HOSTS ?? "")
    .split(",")
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length === 0) {
    return {
      ok: false,
      reason:
        "VOICE_TRANSCRIPTION_ALLOWED_HOSTS is not configured — refusing to fetch any URL (fail-closed)",
    };
  }

  const allowed = allowlist.some(
    entry => hostname === entry || hostname.endsWith(`.${entry}`)
  );
  if (!allowed) {
    return { ok: false, reason: `host "${hostname}" is not in the allowed audio hosts list` };
  }

  return { ok: true };
}

/**
 * Transcribe audio to text using the internal Speech-to-Text service
 *
 * @param options - Audio data and metadata
 * @returns Transcription result or error
 */
export async function transcribeAudio(
  options: TranscribeOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  try {
    // Step 1: Validate environment configuration
    if (!ENV.forgeApiUrl) {
      return {
        error: "Voice transcription service is not configured",
        code: "SERVICE_ERROR",
        details: "BUILT_IN_FORGE_API_URL is not set",
      };
    }
    if (!ENV.forgeApiKey) {
      return {
        error: "Voice transcription service authentication is missing",
        code: "SERVICE_ERROR",
        details: "BUILT_IN_FORGE_API_KEY is not set",
      };
    }

    // Step 2: Download audio from URL — DD-TSSEC (A7-15): the URL must pass
    // the SSRF allowlist guard BEFORE any network fetch happens.
    const urlCheck = validateAudioUrl(options.audioUrl);
    if (!urlCheck.ok) {
      return {
        error: "Audio URL is not allowed",
        code: "URL_NOT_ALLOWED",
        details: urlCheck.reason,
      };
    }

    let audioBuffer: Buffer;
    let mimeType: string;
    try {
      // redirect: "manual" — an allowlisted host must not be able to bounce
      // the fetch to an internal/metadata address via a 3xx (SSRF via
      // redirect). Redirect responses are treated as download failures.
      const response = await fetch(options.audioUrl, { redirect: "manual" });
      if (!response.ok) {
        return {
          error: "Failed to download audio file",
          code: "INVALID_FORMAT",
          details: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      audioBuffer = Buffer.from(await response.arrayBuffer());
      mimeType = response.headers.get("content-type") || "audio/mpeg";

      // Check file size (16MB limit)
      const sizeMB = audioBuffer.length / (1024 * 1024);
      if (sizeMB > 16) {
        return {
          error: "Audio file exceeds maximum size limit",
          code: "FILE_TOO_LARGE",
          details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 16MB`,
        };
      }
    } catch (error) {
      return {
        error: "Failed to fetch audio file",
        code: "SERVICE_ERROR",
        details: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // Step 3: Create FormData for multipart upload to Whisper API
    const formData = new FormData();

    // Create a Blob from the buffer and append to form
    const filename = `audio.${getFileExtension(mimeType)}`;
    const audioBlob = new Blob([new Uint8Array(audioBuffer)], {
      type: mimeType,
    });
    formData.append("file", audioBlob, filename);

    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");

    // Add prompt - use custom prompt if provided, otherwise generate based on language
    const prompt =
      options.prompt ||
      (options.language
        ? `Transcribe the user's voice to text, the user's working language is ${getLanguageName(options.language)}`
        : "Transcribe the user's voice to text");
    formData.append("prompt", prompt);

    // Step 4: Call the transcription service
    const baseUrl = ENV.forgeApiUrl.endsWith("/")
      ? ENV.forgeApiUrl
      : `${ENV.forgeApiUrl}/`;

    const fullUrl = new URL("v1/audio/transcriptions", baseUrl).toString();

    const response = await fetch(fullUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "Accept-Encoding": "identity",
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
        details: `${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ""}`,
      };
    }

    // Step 5: Parse and return the transcription result
    const whisperResponse = (await response.json()) as WhisperResponse;

    // Validate response structure
    if (!whisperResponse.text || typeof whisperResponse.text !== "string") {
      return {
        error: "Invalid transcription response",
        code: "SERVICE_ERROR",
        details: "Transcription service returned an invalid response format",
      };
    }

    return whisperResponse; // Return native Whisper API response directly
  } catch (error) {
    // Handle unexpected errors
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}

/**
 * Helper function to get file extension from MIME type
 */
function getFileExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "audio/webm": "webm",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a",
  };

  return mimeToExt[mimeType] || "audio";
}

/**
 * Helper function to get full language name from ISO code
 */
function getLanguageName(langCode: string): string {
  const langMap: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ru: "Russian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ar: "Arabic",
    hi: "Hindi",
    nl: "Dutch",
    pl: "Polish",
    tr: "Turkish",
    sv: "Swedish",
    da: "Danish",
    no: "Norwegian",
    fi: "Finnish",
  };

  return langMap[langCode] || langCode;
}

/**
 * Example tRPC procedure implementation:
 *
 * ```ts
 * // In server/routers.ts
 * import { transcribeAudio } from "./_core/voiceTranscription";
 * import { transcribeAudio } from "./_core/voiceTranscription";
import { logger } from './logger';
 *
 * export const voiceRouter = router({
 *   transcribe: protectedProcedure
 *     .input(z.object({
 *       audioUrl: z.string(),
 *       language: z.string().optional(),
 *       prompt: z.string().optional(),
 *     }))
 *     .mutation(async ({ input, ctx }) => {
 *       const result = await transcribeAudio(input);
 *
 *       // Check if it's an error
 *       if ('error' in result) {
 *         throw new TRPCError({
 *           code: 'BAD_REQUEST',
 *           message: result.error,
 *           cause: result,
 *         });
 *       }
 *
 *       // Optionally save transcription to database
 *       await db.insert(transcriptions).values({
 *         userId: ctx.user.id,
 *         text: result.text,
 *         duration: result.duration,
 *         language: result.language,
 *         audioUrl: input.audioUrl,
 *         createdAt: new Date(),
 *       });
 *
 *       return result;
 *     }),
 * });
 * ```
 */
