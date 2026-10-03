// 2026-10-03 (W8-B1): @insureportal/channel-core public API.
export * from "./types";
export {
  ConversationStore,
  RedisConversationStore,
  RedisConversationStoreOptions,
} from "./conversationStore";
export { getRedisClient, closeRedisClients } from "./redisClient";
export {
  ChannelEngine,
  ChannelEngineDeps,
  IntentHandler,
} from "./engine";
export {
  PlatformClient,
  PlatformConfig,
  PlatformConfigError,
  PlatformUnavailableError,
  createPlatformClient,
  loadPlatformConfig,
  validatePlatformConfig,
  PLATFORM_TIMEOUT_MIN_MS,
  PLATFORM_TIMEOUT_MAX_MS,
  PLATFORM_TIMEOUT_DEFAULT_MS,
} from "./platformClient";
// 2026-10-03 (W8-B7): canonical conversation-ID extractors, multi-step
// flows, and the Redis test-instance guard.
export {
  ConversationIdError,
  whatsappConversationId,
  telegramChatId,
  webChatSessionId,
} from "./conversationIds";
export {
  FlowDefinition,
  FlowStep,
  FlowDecision,
  DEFAULT_CANCEL_WORDS,
  startFlow,
  continueFlow,
} from "./flows";
export { TestRedisUrlError, assertTestRedisUrl } from "./testRedisGuard";
export {
  ReplyTemplateConfig,
  supportContactLine,
  unavailableReply,
  unknownIntentReply,
  handlerErrorReply,
} from "./replies";
