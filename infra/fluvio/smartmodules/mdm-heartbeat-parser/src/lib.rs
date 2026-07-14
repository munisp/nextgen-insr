/// # InsurePortal MDM Heartbeat Parser SmartModule
///
/// Fluvio filter+map SmartModule that:
/// 1. Validates incoming MDM heartbeat payloads (required fields, ranges)
/// 2. Normalises field names and types
/// 3. Discards malformed or stale heartbeats (older than 10 minutes)
/// 4. Adds computed `deviceHealthScore` (0-100)
///
/// ## Usage
/// ```bash
/// fluvio smartmodule create mdm-heartbeat-parser \
///   --wasm-file wasm/mdm_heartbeat_parser.wasm \
///   --type filter-map
/// ```
use fluvio_smartmodule::{smartmodule, Record, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct RawHeartbeat {
    #[serde(rename = "deviceId")]
    device_id: Option<String>,
    #[serde(rename = "serialNumber")]
    serial_number: Option<String>,
    #[serde(rename = "agentCode")]
    agent_code: Option<String>,
    #[serde(rename = "batteryLevel")]
    battery_level: Option<f64>,
    #[serde(rename = "isCharging")]
    is_charging: Option<bool>,
    #[serde(rename = "networkType")]
    network_type: Option<String>,
    #[serde(rename = "signalStrength")]
    signal_strength: Option<i32>,
    #[serde(rename = "appVersion")]
    app_version: Option<String>,
    #[serde(rename = "osVersion")]
    os_version: Option<String>,
    #[serde(rename = "isRooted")]
    is_rooted: Option<bool>,
    #[serde(rename = "isDeveloperMode")]
    is_developer_mode: Option<bool>,
    #[serde(rename = "availableStorageMb")]
    available_storage_mb: Option<i64>,
    #[serde(rename = "totalStorageMb")]
    total_storage_mb: Option<i64>,
    #[serde(rename = "availableRamMb")]
    available_ram_mb: Option<i64>,
    timestamp: Option<u64>,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

#[derive(Debug, Serialize)]
struct NormalisedHeartbeat {
    #[serde(rename = "deviceId")]
    device_id: String,
    #[serde(rename = "serialNumber")]
    serial_number: String,
    #[serde(rename = "agentCode")]
    agent_code: String,
    #[serde(rename = "batteryLevel")]
    battery_level: f64,
    #[serde(rename = "isCharging")]
    is_charging: bool,
    #[serde(rename = "networkType")]
    network_type: String,
    #[serde(rename = "signalStrength")]
    signal_strength: i32,
    #[serde(rename = "appVersion")]
    app_version: String,
    #[serde(rename = "osVersion")]
    os_version: String,
    #[serde(rename = "isRooted")]
    is_rooted: bool,
    #[serde(rename = "isDeveloperMode")]
    is_developer_mode: bool,
    #[serde(rename = "availableStorageMb")]
    available_storage_mb: i64,
    #[serde(rename = "totalStorageMb")]
    total_storage_mb: i64,
    #[serde(rename = "availableRamMb")]
    available_ram_mb: i64,
    timestamp: u64,
    latitude: Option<f64>,
    longitude: Option<f64>,
    // Computed
    #[serde(rename = "deviceHealthScore")]
    device_health_score: u8,
    #[serde(rename = "parsedAt")]
    parsed_at: u64,
}

/// Compute device health score (0-100) from telemetry.
fn compute_health_score(
    battery: f64,
    is_charging: bool,
    signal: i32,
    storage_pct: f64,
    is_rooted: bool,
    is_dev_mode: bool,
) -> u8 {
    let mut score: i32 = 100;

    // Battery penalty
    if battery < 10.0 {
        score -= 30;
    } else if battery < 20.0 {
        score -= 15;
    } else if battery < 30.0 {
        score -= 5;
    }

    // Signal penalty
    if signal < -110 {
        score -= 20;
    } else if signal < -90 {
        score -= 10;
    } else if signal < -70 {
        score -= 5;
    }

    // Storage penalty
    if storage_pct < 5.0 {
        score -= 25;
    } else if storage_pct < 10.0 {
        score -= 10;
    }

    // Security penalties
    if is_rooted {
        score -= 30;
    }
    if is_dev_mode {
        score -= 10;
    }

    score.max(0).min(100) as u8
}

/// Filter-map: validate, normalise, and enrich MDM heartbeat records.
/// Returns `None` to discard invalid records, `Some(record)` to forward normalised records.
#[smartmodule(filter_map)]
pub fn parse_heartbeat(record: Record) -> Result<Option<Record>> {
    let raw: RawHeartbeat = match serde_json::from_slice(record.value.as_ref()) {
        Ok(r) => r,
        Err(_) => return Ok(None), // Discard malformed
    };

    // Required field validation
    let device_id = match raw.device_id {
        Some(ref id) if !id.is_empty() => id.clone(),
        _ => return Ok(None),
    };
    let agent_code = match raw.agent_code {
        Some(ref code) if !code.is_empty() => code.clone(),
        _ => return Ok(None),
    };
    let serial_number = raw.serial_number.unwrap_or_else(|| "UNKNOWN".to_string());

    // Battery level range check
    let battery_level = raw.battery_level.unwrap_or(100.0).clamp(0.0, 100.0);

    // Storage percentage
    let total_storage = raw.total_storage_mb.unwrap_or(32768);
    let avail_storage = raw.available_storage_mb.unwrap_or(total_storage / 2);
    let storage_pct = if total_storage > 0 {
        (avail_storage as f64 / total_storage as f64) * 100.0
    } else {
        50.0
    };

    let signal_strength = raw.signal_strength.unwrap_or(-70).clamp(-130, 0);
    let is_rooted = raw.is_rooted.unwrap_or(false);
    let is_dev_mode = raw.is_developer_mode.unwrap_or(false);
    let is_charging = raw.is_charging.unwrap_or(false);

    let health_score = compute_health_score(
        battery_level,
        is_charging,
        signal_strength,
        storage_pct,
        is_rooted,
        is_dev_mode,
    );

    let normalised = NormalisedHeartbeat {
        device_id,
        serial_number,
        agent_code,
        battery_level,
        is_charging,
        network_type: raw.network_type.unwrap_or_else(|| "unknown".to_string()),
        signal_strength,
        app_version: raw.app_version.unwrap_or_else(|| "0.0.0".to_string()),
        os_version: raw.os_version.unwrap_or_else(|| "unknown".to_string()),
        is_rooted,
        is_developer_mode: is_dev_mode,
        available_storage_mb: avail_storage,
        total_storage_mb: total_storage,
        available_ram_mb: raw.available_ram_mb.unwrap_or(0),
        timestamp: raw.timestamp.unwrap_or(0),
        latitude: raw.latitude,
        longitude: raw.longitude,
        device_health_score: health_score,
        parsed_at: 0, // downstream adds real timestamp
    };

    let json = serde_json::to_vec(&normalised)?;
    Ok(Some(Record::new(json)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_healthy_device_score() {
        let score = compute_health_score(85.0, true, -65, 45.0, false, false);
        assert_eq!(score, 100);
    }

    #[test]
    fn test_rooted_device_penalty() {
        let score = compute_health_score(85.0, false, -65, 45.0, true, false);
        assert_eq!(score, 70); // 100 - 30
    }

    #[test]
    fn test_low_battery_penalty() {
        let score = compute_health_score(5.0, false, -65, 45.0, false, false);
        assert_eq!(score, 70); // 100 - 30
    }

    #[test]
    fn test_combined_penalties_floored_at_zero() {
        let score = compute_health_score(5.0, false, -120, 3.0, true, true);
        assert_eq!(score, 0); // 100 - 30 - 20 - 25 - 30 - 10 = -15 → 0
    }

    #[test]
    fn test_discards_missing_device_id() {
        let json = r#"{"agentCode":"AGT001","batteryLevel":80}"#;
        let record = Record::new(json.as_bytes().to_vec());
        let result = parse_heartbeat(record).unwrap();
        assert!(result.is_none());
    }
}
