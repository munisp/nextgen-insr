/**
 * voiceTranscription SSRF guard (DD-TSSEC, A7-15).
 *
 * The transcription helper downloads audio from a caller-supplied URL. The
 * validateAudioUrl policy is fail-closed: https-only, no embedded
 * credentials, hostname must be in VOICE_TRANSCRIPTION_ALLOWED_HOSTS, an
 * empty allowlist allows nothing, and private/metadata IP literals are
 * refused even when allowlisted.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { validateAudioUrl } from "../voiceTranscription";

const ENV_KEY = "VOICE_TRANSCRIPTION_ALLOWED_HOSTS";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

describe("validateAudioUrl (SSRF guard)", () => {
  it("rejects everything when the allowlist is unconfigured (fail-closed)", () => {
    delete process.env[ENV_KEY];
    const res = validateAudioUrl("https://cdn.example.com/audio.mp3");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not configured/);
  });

  it("rejects non-https schemes even for allowlisted hosts", () => {
    process.env[ENV_KEY] = "cdn.example.com";
    for (const url of [
      "http://cdn.example.com/audio.mp3",
      "file:///etc/passwd",
      "data:audio/mpeg;base64,AAAA",
      "gopher://cdn.example.com/",
    ]) {
      expect(validateAudioUrl(url).ok).toBe(false);
    }
  });

  it("rejects hosts outside the allowlist", () => {
    process.env[ENV_KEY] = "cdn.example.com";
    const res = validateAudioUrl("https://evil.attacker.com/audio.mp3");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not in the allowed/);
  });

  it("rejects suffix-lookalike hosts (evilcdn.example.com.evil.org)", () => {
    process.env[ENV_KEY] = "cdn.example.com";
    expect(
      validateAudioUrl("https://cdn.example.com.evil.org/audio.mp3").ok
    ).toBe(false);
  });

  it("accepts an exact allowlisted host and its subdomains", () => {
    process.env[ENV_KEY] = "cdn.example.com, storage.example.org";
    expect(validateAudioUrl("https://cdn.example.com/a/b.mp3").ok).toBe(true);
    expect(validateAudioUrl("https://eu.cdn.example.com/a.mp3").ok).toBe(true);
    expect(validateAudioUrl("https://storage.example.org/x.wav").ok).toBe(true);
  });

  it("rejects URLs with embedded credentials", () => {
    process.env[ENV_KEY] = "cdn.example.com";
    expect(
      validateAudioUrl("https://user:pass@cdn.example.com/a.mp3").ok
    ).toBe(false);
  });

  it("rejects cloud-metadata and private IP literals even when allowlisted", () => {
    process.env[ENV_KEY] =
      "169.254.169.254, 127.0.0.1, 10.0.0.5, 192.168.1.1, 172.16.0.1";
    for (const host of [
      "169.254.169.254",
      "127.0.0.1",
      "10.0.0.5",
      "192.168.1.1",
      "172.16.0.1",
    ]) {
      expect(validateAudioUrl(`https://${host}/latest/meta-data`).ok).toBe(false);
    }
  });

  it("rejects malformed URLs", () => {
    process.env[ENV_KEY] = "cdn.example.com";
    expect(validateAudioUrl("not a url").ok).toBe(false);
  });
});
