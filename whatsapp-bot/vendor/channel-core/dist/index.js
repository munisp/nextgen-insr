"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlerErrorReply = exports.unknownIntentReply = exports.unavailableReply = exports.supportContactLine = exports.loadPlatformConfig = exports.createPlatformClient = exports.PlatformUnavailableError = exports.PlatformConfigError = exports.PlatformClient = exports.ChannelEngine = exports.closeRedisClients = exports.getRedisClient = exports.RedisConversationStore = void 0;
// 2026-10-03 (W8-B1): @insureportal/channel-core public API.
__exportStar(require("./types"), exports);
var conversationStore_1 = require("./conversationStore");
Object.defineProperty(exports, "RedisConversationStore", { enumerable: true, get: function () { return conversationStore_1.RedisConversationStore; } });
var redisClient_1 = require("./redisClient");
Object.defineProperty(exports, "getRedisClient", { enumerable: true, get: function () { return redisClient_1.getRedisClient; } });
Object.defineProperty(exports, "closeRedisClients", { enumerable: true, get: function () { return redisClient_1.closeRedisClients; } });
var engine_1 = require("./engine");
Object.defineProperty(exports, "ChannelEngine", { enumerable: true, get: function () { return engine_1.ChannelEngine; } });
var platformClient_1 = require("./platformClient");
Object.defineProperty(exports, "PlatformClient", { enumerable: true, get: function () { return platformClient_1.PlatformClient; } });
Object.defineProperty(exports, "PlatformConfigError", { enumerable: true, get: function () { return platformClient_1.PlatformConfigError; } });
Object.defineProperty(exports, "PlatformUnavailableError", { enumerable: true, get: function () { return platformClient_1.PlatformUnavailableError; } });
Object.defineProperty(exports, "createPlatformClient", { enumerable: true, get: function () { return platformClient_1.createPlatformClient; } });
Object.defineProperty(exports, "loadPlatformConfig", { enumerable: true, get: function () { return platformClient_1.loadPlatformConfig; } });
var replies_1 = require("./replies");
Object.defineProperty(exports, "supportContactLine", { enumerable: true, get: function () { return replies_1.supportContactLine; } });
Object.defineProperty(exports, "unavailableReply", { enumerable: true, get: function () { return replies_1.unavailableReply; } });
Object.defineProperty(exports, "unknownIntentReply", { enumerable: true, get: function () { return replies_1.unknownIntentReply; } });
Object.defineProperty(exports, "handlerErrorReply", { enumerable: true, get: function () { return replies_1.handlerErrorReply; } });
//# sourceMappingURL=index.js.map