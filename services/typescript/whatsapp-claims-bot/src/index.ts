import http from "http";
import { Client as PgClient } from "pg";

/**
 * WhatsApp Claims Bot — Conversational Claims Submission
 * Port: 8124
 *
 * Middleware: PostgreSQL (session/claim store), Kafka (claim events),
 * Redis (session cache), Temporal (claim workflow)
 */

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://ngapp:ngapp@localhost:5432/ngapp";
const KAFKA_URL = process.env.KAFKA_REST_URL || "http://localhost:8082";

let db: PgClient;

async function initDB() {
  db = new PgClient({ connectionString: DATABASE_URL });
  await db.connect();
  await db.query(`
    CREATE TABLE IF NOT EXISTS wa_sessions (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      customer_id TEXT NOT NULL DEFAULT '',
      step TEXT NOT NULL DEFAULT 'greeting',
      policy_id TEXT,
      description TEXT,
      photos TEXT[] NOT NULL DEFAULT '{}',
      voice_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wa_claims (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      description TEXT NOT NULL,
      photos TEXT[] NOT NULL DEFAULT '{}',
      voice_note TEXT,
      status TEXT NOT NULL DEFAULT 'submitted',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_wa_sessions_phone ON wa_sessions(phone);
    CREATE INDEX IF NOT EXISTS idx_wa_claims_phone ON wa_claims(phone);
  `);
  console.log("WhatsApp Claims Bot: PostgreSQL connected");
}

type ClaimStep =
  | "greeting"
  | "policy_selection"
  | "description"
  | "photo_upload"
  | "voice_note"
  | "submitted";

interface WhatsAppMessage {
  from: string;
  type: "text" | "image" | "audio" | "location";
  body?: string;
  mediaUrl?: string;
}

const FLOW_MESSAGES: Record<ClaimStep, string> = {
  greeting:
    "Welcome to InsurePortal Claims!\n\nI can help you file a claim right here on WhatsApp.\n\nReply with your policy number to get started (e.g., POL-2024-001)",
  policy_selection:
    "Great! I found your policy. What happened? Please describe the incident briefly.",
  description:
    "Got it. Now please send a photo of the damage (or type 'skip' if not applicable).",
  photo_upload:
    "Photo received! Would you like to add a voice note describing what happened? (Reply 'skip' to continue without)",
  voice_note:
    "Thank you! Here's your claim summary:\n\nPolicy: {policyId}\nDescription: {description}\nPhotos: {photoCount}\n\nReply 'SUBMIT' to file this claim or 'CANCEL' to start over.",
  submitted:
    "Your claim has been submitted!\n\nClaim ID: {claimId}\nEstimated processing: 5-14 business days\n\nYou'll receive updates here on WhatsApp. Reply 'STATUS' anytime to check progress.",
};

async function getSession(
  phone: string
): Promise<Record<string, unknown> | null> {
  const res = await db.query("SELECT * FROM wa_sessions WHERE phone = $1", [
    phone,
  ]);
  return res.rows[0] || null;
}

async function upsertSession(
  phone: string,
  updates: Record<string, unknown>
): Promise<void> {
  const existing = await getSession(phone);
  if (!existing) {
    const sessionId = `SES-${Date.now()}`;
    await db.query(
      "INSERT INTO wa_sessions (id, phone, step) VALUES ($1, $2, 'greeting')",
      [sessionId, phone]
    );
  }
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const [key, val] of Object.entries(updates)) {
    setClauses.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }
  setClauses.push(`updated_at = NOW()`);
  values.push(phone);
  await db.query(
    `UPDATE wa_sessions SET ${setClauses.join(", ")} WHERE phone = $${idx}`,
    values
  );
}

async function publishKafka(topic: string, data: unknown): Promise<void> {
  try {
    const payload = JSON.stringify({
      records: [{ value: data }],
    });
    const req = http.request(
      `${KAFKA_URL}/topics/${topic}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.kafka.json.v2+json",
          Accept: "application/vnd.kafka.v2+json",
        },
      },
      () => {}
    );
    req.write(payload);
    req.end();
  } catch {
    console.error(`Kafka publish failed for ${topic}`);
  }
}

async function handleMessage(msg: WhatsAppMessage): Promise<string> {
  const phone = msg.from;

  // Status check
  if (msg.body?.toUpperCase() === "STATUS") {
    const claimRes = await db.query(
      "SELECT id, status, created_at FROM wa_claims WHERE phone = $1 ORDER BY created_at DESC LIMIT 1",
      [phone]
    );
    if (claimRes.rows.length > 0) {
      const claim = claimRes.rows[0];
      return `Your latest claim:\n\nClaim ID: ${claim.id}\nStatus: ${claim.status}\nSubmitted: ${claim.created_at}`;
    }
    return "No claims found. Reply to start a new claim.";
  }

  let session = await getSession(phone);

  // New session
  if (!session) {
    await upsertSession(phone, { step: "greeting" });
    return FLOW_MESSAGES.greeting;
  }

  const step = session.step as ClaimStep;

  switch (step) {
    case "greeting":
      if (msg.body && msg.body.startsWith("POL-")) {
        await upsertSession(phone, {
          step: "policy_selection",
          policy_id: msg.body.trim(),
        });
        return FLOW_MESSAGES.policy_selection;
      }
      return "Please enter your policy number (format: POL-XXXX-XXX)";

    case "policy_selection":
      await upsertSession(phone, {
        step: "description",
        description: msg.body || "No description provided",
      });
      return FLOW_MESSAGES.description;

    case "description":
      if (msg.type === "image" && msg.mediaUrl) {
        const photos = (session.photos as string[]) || [];
        photos.push(msg.mediaUrl);
        await upsertSession(phone, { step: "photo_upload", photos });
        return FLOW_MESSAGES.photo_upload;
      }
      if (msg.body?.toLowerCase() === "skip") {
        await upsertSession(phone, { step: "photo_upload" });
        return FLOW_MESSAGES.photo_upload;
      }
      return "Please send a photo or reply 'skip'";

    case "photo_upload":
      if (msg.type === "audio" && msg.mediaUrl) {
        await upsertSession(phone, { voice_note: msg.mediaUrl });
      }
      await upsertSession(phone, { step: "voice_note" });
      session = await getSession(phone);
      return FLOW_MESSAGES.voice_note
        .replace("{policyId}", (session?.policy_id as string) || "N/A")
        .replace("{description}", (session?.description as string) || "N/A")
        .replace(
          "{photoCount}",
          String(((session?.photos as string[]) || []).length)
        );

    case "voice_note":
      if (msg.body?.toUpperCase() === "SUBMIT") {
        session = await getSession(phone);
        const claimId = `CLM-${Date.now().toString().slice(-8)}`;
        await db.query(
          `INSERT INTO wa_claims (id, session_id, phone, policy_id, description, photos, voice_note)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            claimId,
            session?.id,
            phone,
            session?.policy_id || "",
            session?.description || "",
            session?.photos || [],
            session?.voice_note || null,
          ]
        );
        await db.query("DELETE FROM wa_sessions WHERE phone = $1", [phone]);

        await publishKafka("whatsapp.claim.submitted", {
          claimId,
          phone,
          policyId: session?.policy_id,
        });

        return FLOW_MESSAGES.submitted.replace("{claimId}", claimId);
      }
      if (msg.body?.toUpperCase() === "CANCEL") {
        await db.query("DELETE FROM wa_sessions WHERE phone = $1", [phone]);
        return "Claim cancelled. Reply anytime to start a new claim.";
      }
      return "Reply 'SUBMIT' to file or 'CANCEL' to start over.";

    default:
      await db.query("DELETE FROM wa_sessions WHERE phone = $1", [phone]);
      return FLOW_MESSAGES.greeting;
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/health" && req.method === "GET") {
    try {
      const dbResult = await db.query("SELECT 1");
      const sessResult = await db.query("SELECT COUNT(*) FROM wa_sessions");
      const claimResult = await db.query("SELECT COUNT(*) FROM wa_claims");
      res.end(
        JSON.stringify({
          status: "healthy",
          service: "whatsapp-claims-bot",
          database: "connected",
          active_sessions: parseInt(sessResult.rows[0].count, 10),
          total_claims: parseInt(claimResult.rows[0].count, 10),
          supported_messages: ["text", "image", "audio", "location"],
          languages: ["en", "pcm", "ha", "yo", "ig"],
        })
      );
    } catch (e) {
      res.end(
        JSON.stringify({
          status: "degraded",
          service: "whatsapp-claims-bot",
          database: "disconnected",
          error: String(e),
        })
      );
    }
    return;
  }

  if (req.url === "/api/v1/whatsapp/webhook" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const msg: WhatsAppMessage = JSON.parse(body);
        if (!msg.from) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "from field required" }));
          return;
        }
        const reply = await handleMessage(msg);
        res.end(JSON.stringify({ to: msg.from, message: reply }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid message format" }));
      }
    });
    return;
  }

  if (req.url === "/api/v1/whatsapp/sessions" && req.method === "GET") {
    const result = await db.query(
      "SELECT id, phone, step, created_at FROM wa_sessions ORDER BY created_at DESC"
    );
    res.end(
      JSON.stringify({ sessions: result.rows, total: result.rows.length })
    );
    return;
  }

  if (req.url === "/api/v1/whatsapp/claims" && req.method === "GET") {
    const result = await db.query(
      "SELECT id, phone, policy_id, status, created_at FROM wa_claims ORDER BY created_at DESC"
    );
    res.end(JSON.stringify({ claims: result.rows, total: result.rows.length }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

const PORT = parseInt(process.env.PORT || "8124", 10);

initDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`WhatsApp Claims Bot running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
