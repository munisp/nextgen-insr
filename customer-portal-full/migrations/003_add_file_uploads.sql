-- Migration 003: File uploads tracking table

CREATE TABLE IF NOT EXISTS file_uploads (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER REFERENCES users(id),
  "tenantId" VARCHAR(50) DEFAULT 'default',
  filename VARCHAR(500) NOT NULL,
  "originalName" VARCHAR(500) NOT NULL,
  "mimeType" VARCHAR(100),
  size INTEGER,
  "storageKey" VARCHAR(1000) NOT NULL,
  "storageProvider" VARCHAR(20) DEFAULT 'local',
  "entityType" VARCHAR(50),
  "entityId" INTEGER,
  url TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_uploads_entity ON file_uploads("entityType", "entityId");
CREATE INDEX IF NOT EXISTS idx_file_uploads_user ON file_uploads("userId");

INSERT INTO _migrations (name, checksum) VALUES ('003_add_file_uploads', 'uploads_v1')
ON CONFLICT (name) DO NOTHING;
