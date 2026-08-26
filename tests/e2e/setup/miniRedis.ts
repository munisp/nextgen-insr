/**
 * miniRedis.ts — minimal in-process RESP (Redis protocol) server.
 *
 * LOCAL TEST FALLBACK ONLY. The CI e2e job runs against a real redis:7
 * service via REDIS_URL; this exists so a local `pnpm test:e2e` run does not
 * hang for ~30s per Redis touch (ioredis reconnect backoff) when no Redis is
 * installed on the developer machine.
 *
 * It implements exactly the command surface the app exercises in tests:
 *   PING, QUIT                       — health checks / shutdown
 *   SCRIPT LOAD, EVALSHA, EVAL       — rate-limit-redis sliding-window script
 *   GET, SET (EX/PX/NX/XX), INCR, PTTL, PEXPIRE, DEL — rate-limit primitives
 *     plus the distributed-lock (SET PX NX) and token-blacklist (SET EX)
 *     surface the integration suite exercises (fail-closed locks, F6-1).
 *
 * The rate-limit Lua script semantics are re-implemented faithfully
 * (fixed-window counter with PX expiry), so rate limiting behaves the same
 * as with real Redis at the request level.
 */
import net from "node:net";
import crypto from "node:crypto";

type Value = { value: string; expiresAt: number | null };

function encodeSimple(s: string): Buffer {
  return Buffer.from(`+${s}\r\n`);
}
function encodeError(s: string): Buffer {
  return Buffer.from(`-${s}\r\n`);
}
function encodeInt(n: number): Buffer {
  return Buffer.from(`:${n}\r\n`);
}
function encodeBulk(s: string | null): Buffer {
  if (s === null) return Buffer.from("$-1\r\n");
  return Buffer.from(`$${Buffer.byteLength(s)}\r\n${s}\r\n`);
}
function encodeArray(items: Buffer[]): Buffer {
  return Buffer.concat([
    Buffer.from(`*${items.length}\r\n`),
    ...items,
  ]);
}

/** Parse one RESP command (array of bulk strings) from buf.
 *  Returns [args, bytesConsumed] or null when incomplete. */
function parseCommand(
  buf: Buffer,
  start: number
): [string[], number] | null {
  if (buf.length <= start || buf[start] !== 0x2a /* * */) return null;
  let pos = start + 1;
  const readLine = (): Buffer | null => {
    const idx = buf.indexOf("\r\n", pos);
    if (idx === -1) return null;
    const line = buf.subarray(pos, idx);
    pos = idx + 2;
    return line;
  };
  const countLine = readLine();
  if (!countLine) return null;
  const count = Number(countLine.toString());
  if (!Number.isFinite(count) || count < 0) return null;
  const args: string[] = [];
  for (let i = 0; i < count; i++) {
    if (buf[pos] !== 0x24 /* $ */) return null;
    pos++;
    const lenLine = readLine();
    if (!lenLine) return null;
    const len = Number(lenLine.toString());
    if (buf.length < pos + len + 2) return null;
    args.push(buf.subarray(pos, pos + len).toString());
    pos += len + 2; // skip value + CRLF
  }
  return [args, pos];
}

export interface MiniRedis {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function startMiniRedis(port = 6380): Promise<MiniRedis> {
  const store = new Map<string, Value>();
  const scripts = new Map<string, string>(); // sha -> script text

  const now = () => Date.now();
  const getEntry = (key: string): Value | undefined => {
    const v = store.get(key);
    if (v && v.expiresAt !== null && v.expiresAt <= now()) {
      store.delete(key);
      return undefined;
    }
    return v;
  };
  const pttl = (key: string): number => {
    const v = getEntry(key);
    if (!v) return -2; // key does not exist
    if (v.expiresAt === null) return -1; // no expiry
    return Math.max(0, v.expiresAt - now());
  };

  /** Faithful re-implementation of rate-limit-redis increment script. */
  const runIncrement = (key: string, resetOnChange: string, windowMs: string): Buffer => {
    const window = Number(windowMs);
    let timeToExpire = pttl(key);
    let totalHits: number;
    if (timeToExpire <= 0) {
      store.set(key, { value: "1", expiresAt: now() + window });
      totalHits = 1;
      timeToExpire = window;
    } else {
      const entry = getEntry(key)!;
      totalHits = Number(entry.value) + 1;
      entry.value = String(totalHits);
      if (resetOnChange === "1") {
        entry.expiresAt = now() + window;
        timeToExpire = window;
      }
    }
    return encodeArray([encodeInt(totalHits), encodeInt(timeToExpire)]);
  };

  const runGetScript = (key: string): Buffer => {
    const entry = getEntry(key);
    return encodeArray([
      entry ? encodeBulk(entry.value) : encodeBulk(null),
      encodeInt(pttl(key)),
    ]);
  };

  const execute = (args: string[], socket: net.Socket): Buffer => {
    const cmd = (args[0] ?? "").toUpperCase();
    switch (cmd) {
      case "PING":
        return encodeSimple("PONG");
      case "QUIT":
        setImmediate(() => socket.end());
        return encodeSimple("OK");
      case "SCRIPT": {
        // SCRIPT LOAD <lua>
        const script = args[2] ?? "";
        const sha = crypto.createHash("sha1").update(script).digest("hex");
        scripts.set(sha, script);
        return encodeBulk(sha);
      }
      case "EVAL":
      case "EVALSHA": {
        const script =
          cmd === "EVAL" ? (args[1] ?? "") : (scripts.get(args[1] ?? "") ?? "");
        if (cmd === "EVALSHA" && !script) {
          return encodeError("NOSCRIPT No matching script. Please use EVAL.");
        }
        const numKeys = Number(args[2] ?? "0");
        const key = args[3] ?? "";
        const argv = args.slice(3 + numKeys);
        if (script.includes("INCR")) {
          return runIncrement(key, argv[0] ?? "0", argv[1] ?? "60000");
        }
        if (script.includes("GET")) {
          return runGetScript(key);
        }
        return encodeArray([]);
      }
      case "GET": {
        const entry = getEntry(args[1] ?? "");
        return encodeBulk(entry ? entry.value : null);
      }
      case "SET": {
        // SET key value [EX s | PX ms] [NX | XX]
        const key = args[1] ?? "";
        const value = args[2] ?? "";
        let expiresAt: number | null = null;
        const pxIdx = args.findIndex(a => a.toUpperCase() === "PX");
        if (pxIdx !== -1) expiresAt = now() + Number(args[pxIdx + 1] ?? "0");
        const exIdx = args.findIndex(a => a.toUpperCase() === "EX");
        if (exIdx !== -1) expiresAt = now() + Number(args[exIdx + 1] ?? "0") * 1000;
        const nx = args.some(a => a.toUpperCase() === "NX");
        const xx = args.some(a => a.toUpperCase() === "XX");
        const existing = getEntry(key);
        // NX: set only when absent (nil reply otherwise — ioredis maps nil to
        // null, which acquireLock relies on for fail-closed lock semantics).
        if (nx && existing) return encodeBulk(null);
        // XX: set only when present.
        if (xx && !existing) return encodeBulk(null);
        store.set(key, { value, expiresAt });
        return encodeSimple("OK");
      }
      case "INCR": {
        const key = args[1] ?? "";
        const entry = getEntry(key) ?? { value: "0", expiresAt: null };
        entry.value = String(Number(entry.value) + 1);
        store.set(key, entry);
        return encodeInt(Number(entry.value));
      }
      case "PTTL":
        return encodeInt(pttl(args[1] ?? ""));
      case "PEXPIRE": {
        const key = args[1] ?? "";
        const entry = getEntry(key);
        if (!entry) return encodeInt(0);
        entry.expiresAt = now() + Number(args[2] ?? "0");
        return encodeInt(1);
      }
      case "DEL": {
        let removed = 0;
        for (const key of args.slice(1)) if (store.delete(key)) removed++;
        return encodeInt(removed);
      }
      case "SELECT":
        return encodeSimple("OK");
      case "INFO":
        return encodeBulk("# Server\r\nredis_version:7.0.0-mini\r\n");
      default:
        return encodeError(`ERR unknown command '${cmd}'`);
    }
  };

  const openSockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));
    let buf = Buffer.alloc(0);
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      let offset = 0;
      for (;;) {
        const parsed = parseCommand(buf, offset);
        if (!parsed) break;
        const [args, next] = parsed;
        offset = next;
        try {
          socket.write(execute(args, socket));
        } catch (err) {
          socket.write(encodeError(`ERR ${String(err)}`));
        }
      }
      buf = buf.subarray(offset);
    });
    socket.on("error", () => {
      /* client went away — ignore */
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  return {
    port: boundPort,
    url: `redis://127.0.0.1:${boundPort}`,
    close: () =>
      new Promise<void>(resolve => {
        // Force-close any lingering client sockets (ioredis keep-alive),
        // otherwise server.close() waits for them indefinitely.
        for (const s of openSockets) s.destroy();
        server.close(() => resolve());
        server.unref();
      }),
  };
}
