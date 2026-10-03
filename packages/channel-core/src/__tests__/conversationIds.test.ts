// 2026-10-03 (W8-B7): conversation-ID extractor tests. Pure functions — the
// fail-closed cases are the point (no silent "undefined" keys).
import { describe, expect, it } from "vitest";
import {
  ConversationIdError,
  telegramChatId,
  webChatSessionId,
  whatsappConversationId,
} from "../conversationIds";

describe("whatsappConversationId", () => {
  it("returns the sender phone from a Cloud API webhook message", () => {
    expect(whatsappConversationId({ from: "2348012345678" })).toBe("2348012345678");
    expect(whatsappConversationId({ from: "+14155552671" })).toBe("+14155552671");
  });
  it("throws (fail-closed) when from is missing or empty", () => {
    expect(() => whatsappConversationId({})).toThrow(ConversationIdError);
    expect(() => whatsappConversationId({ from: "  " })).toThrow(ConversationIdError);
    expect(() => whatsappConversationId({ from: undefined })).toThrow(/fail-closed/);
  });
  it("rejects non-phone values instead of keying state under garbage", () => {
    expect(() => whatsappConversationId({ from: "alice@example.com" })).toThrow(
      ConversationIdError
    );
    expect(() => whatsappConversationId({ from: "12" })).toThrow(ConversationIdError);
  });
});

describe("telegramChatId", () => {
  it("returns the numeric chat id from message-like objects", () => {
    expect(telegramChatId({ chat: { id: 123456789 } })).toBe(123456789);
    expect(telegramChatId(-1001234567890)).toBe(-1001234567890); // group chat
  });
  it("throws (fail-closed) when chat.id is absent or non-numeric", () => {
    expect(() => telegramChatId({})).toThrow(ConversationIdError);
    expect(() => telegramChatId(null)).toThrow(ConversationIdError);
    expect(() => telegramChatId({ chat: { id: "123" } })).toThrow(ConversationIdError);
    expect(() => telegramChatId(1.5)).toThrow(ConversationIdError);
  });
});

describe("webChatSessionId", () => {
  it("uses the client-supplied session_id verbatim (trimmed)", () => {
    expect(webChatSessionId({ session_id: " sess-42 " })).toBe("sess-42");
  });
  it("falls back to the documented anonymous bucket 'default'", () => {
    expect(webChatSessionId({})).toBe("default");
    expect(webChatSessionId({ session_id: "" })).toBe("default");
    expect(webChatSessionId({ session_id: 42 })).toBe("default");
  });
});
