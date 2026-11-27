-- Seed data for platform gaps (PR #70)
-- Fills all empty/stub tables with realistic Nigerian insurance data
-- Run: PGPASSWORD=insuretech psql -h localhost -U insuretech -d insuretech -f seed-gaps.sql

-- Fix rate table product types to match insurance_products categories
UPDATE premium_rate_tables SET "productType"='Motor' WHERE "productType"='Auto';

-- Telematics Devices
CREATE TABLE IF NOT EXISTS telematics_devices (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL DEFAULT 1,
  "deviceId" VARCHAR(64) NOT NULL,
  name VARCHAR(255),
  device_type VARCHAR(64),
  make VARCHAR(128),
  model VARCHAR(128),
  imei VARCHAR(20),
  vehicle_vin VARCHAR(20),
  install_date TIMESTAMP,
  last_ping TIMESTAMP,
  avg_daily_km NUMERIC(8,2),
  harsh_braking_events INTEGER DEFAULT 0,
  speeding_events INTEGER DEFAULT 0,
  night_driving_pct INTEGER DEFAULT 0,
  driver_score INTEGER DEFAULT 80,
  status VARCHAR(32) DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO telematics_devices (id, "userId", "deviceId", name, device_type, make, model, imei, vehicle_vin, install_date, last_ping, avg_daily_km, harsh_braking_events, speeding_events, night_driving_pct, driver_score, status)
VALUES
  (1, 1, 'TEL-001', 'OBD-II GPS Tracker', 'OBD-II', 'Teltonika', 'FMB920', '352625066123456', 'WVWZZZ3CZWE12345', '2026-01-15', NOW() - INTERVAL '1 hour', 45.00, 3, 1, 12, 85, 'Active'),
  (2, 1, 'TEL-002', 'Dashcam + GPS', 'Dashcam', 'Viofo', 'A229 Pro', '352625066789012', 'WBAPH5C55BA12345', '2026-02-01', NOW() - INTERVAL '2 hours', 62.00, 5, 4, 25, 78, 'Active'),
  (3, 2, 'TEL-003', 'Fleet Management Unit', 'Fleet_GPS', 'CalAmp', 'LMU-5530', '352625066345678', '1FTFW1ET7DFA1234', '2026-03-01', NOW() - INTERVAL '30 minutes', 120.00, 8, 6, 40, 72, 'Active'),
  (4, 3, 'TEL-004', 'Smart Tag', 'Bluetooth', 'Apple', 'AirTag', '000000000000001', 'JN1TANT31Z00001', '2026-04-15', NOW() - INTERVAL '3 hours', 28.00, 1, 0, 5, 92, 'Active'),
  (5, 4, 'TEL-005', 'Fleet Tracker Pro', 'Satellite', 'Globalstar', 'STX3', '352625066901234', 'WDBUF61J21A12345', '2026-01-01', NOW() - INTERVAL '45 minutes', 95.00, 6, 3, 30, 76, 'Active')
ON CONFLICT (id) DO NOTHING;

-- Agent escalation limits
ALTER TABLE agents ADD COLUMN IF NOT EXISTS "escalationLimit" numeric(15,2) DEFAULT 500000;
UPDATE agents SET "escalationLimit" = CASE WHEN id <= 2 THEN 1000000 WHEN id <= 4 THEN 500000 ELSE 200000 END;

-- Training enrollments
INSERT INTO training_enrollments (id, course_id, agent_id, status, progress, score, started_at, completed_at)
VALUES
  (1, 1, 1, 'completed', 100, 92, NOW() - INTERVAL '30 days', NOW() - INTERVAL '25 days'),
  (2, 2, 1, 'completed', 100, 88, NOW() - INTERVAL '20 days', NOW() - INTERVAL '18 days'),
  (3, 3, 1, 'in_progress', 65, NULL, NOW() - INTERVAL '10 days', NULL),
  (4, 1, 2, 'completed', 100, 85, NOW() - INTERVAL '15 days', NOW() - INTERVAL '12 days'),
  (5, 7, 2, 'in_progress', 40, NULL, NOW() - INTERVAL '5 days', NULL)
ON CONFLICT (id) DO NOTHING;
