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
} from "./platformClient";
export {
  ReplyTemplateConfig,
  supportContactLine,
  unavailableReply,
  unknownIntentReply,
  handlerErrorReply,
} from "./replies";
