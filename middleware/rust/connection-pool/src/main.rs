//! InsurePortal Connection Pool Manager — Manages connection pools for all
//! middleware backends (PostgreSQL, Redis, OpenSearch, Kafka) with health
//! monitoring, automatic reconnection, and connection draining.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, atomic::{AtomicU64, AtomicBool, Ordering}};
use std::time::{Duration, Instant};

/// Connection pool statistics
#[derive(Debug, Clone)]
struct PoolStats {
    active: u64,
    idle: u64,
    total: u64,
    max_size: u64,
    wait_count: u64,
    timeout_count: u64,
    created_total: u64,
    closed_total: u64,
    avg_acquire_ms: f64,
}

/// Connection pool configuration
#[derive(Clone)]
struct PoolConfig {
    name: String,
    backend_type: BackendType,
    host: String,
    port: u16,
    min_idle: u64,
    max_size: u64,
    max_lifetime: Duration,
    idle_timeout: Duration,
    acquire_timeout: Duration,
    health_check_interval: Duration,
    enable_ssl: bool,
}

#[derive(Clone, Debug)]
enum BackendType {
    PostgreSQL,
    Redis,
    OpenSearch,
    Kafka,
    TigerBeetle,
}

/// Simulated connection
struct Connection {
    id: u64,
    created_at: Instant,
    last_used: Instant,
    healthy: AtomicBool,
}

impl Connection {
    fn new(id: u64) -> Self {
        let now = Instant::now();
        Self {
            id,
            created_at: now,
            last_used: now,
            healthy: AtomicBool::new(true),
        }
    }

    fn is_expired(&self, max_lifetime: Duration) -> bool {
        self.created_at.elapsed() > max_lifetime
    }

    fn is_idle_too_long(&self, idle_timeout: Duration) -> bool {
        self.last_used.elapsed() > idle_timeout
    }
}

/// Connection pool
struct ConnectionPool {
    config: PoolConfig,
    idle_conns: Mutex<Vec<Connection>>,
    active_count: AtomicU64,
    total_created: AtomicU64,
    total_closed: AtomicU64,
    wait_count: AtomicU64,
    timeout_count: AtomicU64,
    next_id: AtomicU64,
}

impl ConnectionPool {
    fn new(config: PoolConfig) -> Arc<Self> {
        let pool = Arc::new(Self {
            config: config.clone(),
            idle_conns: Mutex::new(Vec::new()),
            active_count: AtomicU64::new(0),
            total_created: AtomicU64::new(0),
            total_closed: AtomicU64::new(0),
            wait_count: AtomicU64::new(0),
            timeout_count: AtomicU64::new(0),
            next_id: AtomicU64::new(1),
        });

        // Pre-warm with min_idle connections
        {
            let mut idle = pool.idle_conns.lock().unwrap();
            for _ in 0..config.min_idle {
                let id = pool.next_id.fetch_add(1, Ordering::SeqCst);
                idle.push(Connection::new(id));
                pool.total_created.fetch_add(1, Ordering::SeqCst);
            }
        }

        println!(
            "[Pool:{}] Initialized {:?} pool: min_idle={}, max_size={}, host={}:{}",
            config.name, config.backend_type, config.min_idle, config.max_size,
            config.host, config.port
        );

        pool
    }

    fn acquire(&self) -> Option<u64> {
        self.wait_count.fetch_add(1, Ordering::SeqCst);

        let mut idle = self.idle_conns.lock().unwrap();

        // Remove expired/unhealthy connections
        idle.retain(|c| {
            if c.is_expired(self.config.max_lifetime) || !c.healthy.load(Ordering::SeqCst) {
                self.total_closed.fetch_add(1, Ordering::SeqCst);
                false
            } else {
                true
            }
        });

        // Try to get an idle connection
        if let Some(conn) = idle.pop() {
            self.active_count.fetch_add(1, Ordering::SeqCst);
            return Some(conn.id);
        }

        // Create new if under max
        let total = self.active_count.load(Ordering::SeqCst) + idle.len() as u64;
        if total < self.config.max_size {
            let id = self.next_id.fetch_add(1, Ordering::SeqCst);
            self.active_count.fetch_add(1, Ordering::SeqCst);
            self.total_created.fetch_add(1, Ordering::SeqCst);
            return Some(id);
        }

        self.timeout_count.fetch_add(1, Ordering::SeqCst);
        None
    }

    fn release(&self, conn_id: u64) {
        self.active_count.fetch_sub(1, Ordering::SeqCst);
        let mut idle = self.idle_conns.lock().unwrap();
        idle.push(Connection::new(conn_id));
    }

    fn stats(&self) -> PoolStats {
        let idle = self.idle_conns.lock().unwrap();
        let active = self.active_count.load(Ordering::SeqCst);
        PoolStats {
            active,
            idle: idle.len() as u64,
            total: active + idle.len() as u64,
            max_size: self.config.max_size,
            wait_count: self.wait_count.load(Ordering::SeqCst),
            timeout_count: self.timeout_count.load(Ordering::SeqCst),
            created_total: self.total_created.load(Ordering::SeqCst),
            closed_total: self.total_closed.load(Ordering::SeqCst),
            avg_acquire_ms: 0.5, // Simulated
        }
    }

    fn drain(&self) {
        let mut idle = self.idle_conns.lock().unwrap();
        let count = idle.len();
        idle.clear();
        self.total_closed.fetch_add(count as u64, Ordering::SeqCst);
        println!("[Pool:{}] Drained {} idle connections", self.config.name, count);
    }
}

/// Pool manager for all backends
struct PoolManager {
    pools: HashMap<String, Arc<ConnectionPool>>,
}

impl PoolManager {
    fn new() -> Self {
        let mut pools = HashMap::new();

        let configs = vec![
            PoolConfig {
                name: "postgres-primary".into(),
                backend_type: BackendType::PostgreSQL,
                host: "postgres-primary".into(), port: 5432,
                min_idle: 10, max_size: 100,
                max_lifetime: Duration::from_secs(1800),
                idle_timeout: Duration::from_secs(300),
                acquire_timeout: Duration::from_secs(5),
                health_check_interval: Duration::from_secs(30),
                enable_ssl: true,
            },
            PoolConfig {
                name: "postgres-replica".into(),
                backend_type: BackendType::PostgreSQL,
                host: "postgres-replica".into(), port: 5432,
                min_idle: 5, max_size: 50,
                max_lifetime: Duration::from_secs(1800),
                idle_timeout: Duration::from_secs(300),
                acquire_timeout: Duration::from_secs(5),
                health_check_interval: Duration::from_secs(30),
                enable_ssl: true,
            },
            PoolConfig {
                name: "redis-master".into(),
                backend_type: BackendType::Redis,
                host: "redis-master".into(), port: 6379,
                min_idle: 20, max_size: 200,
                max_lifetime: Duration::from_secs(3600),
                idle_timeout: Duration::from_secs(600),
                acquire_timeout: Duration::from_secs(2),
                health_check_interval: Duration::from_secs(15),
                enable_ssl: false,
            },
            PoolConfig {
                name: "opensearch".into(),
                backend_type: BackendType::OpenSearch,
                host: "opensearch-node-1".into(), port: 9200,
                min_idle: 5, max_size: 30,
                max_lifetime: Duration::from_secs(3600),
                idle_timeout: Duration::from_secs(600),
                acquire_timeout: Duration::from_secs(10),
                health_check_interval: Duration::from_secs(30),
                enable_ssl: false,
            },
            PoolConfig {
                name: "tigerbeetle".into(),
                backend_type: BackendType::TigerBeetle,
                host: "tigerbeetle-1".into(), port: 3001,
                min_idle: 5, max_size: 20,
                max_lifetime: Duration::from_secs(7200),
                idle_timeout: Duration::from_secs(900),
                acquire_timeout: Duration::from_secs(3),
                health_check_interval: Duration::from_secs(15),
                enable_ssl: false,
            },
        ];

        for config in configs {
            let name = config.name.clone();
            pools.insert(name, ConnectionPool::new(config));
        }

        Self { pools }
    }

    fn all_stats(&self) -> Vec<(String, PoolStats)> {
        self.pools.iter()
            .map(|(name, pool)| (name.clone(), pool.stats()))
            .collect()
    }
}

fn main() {
    println!("=== InsurePortal Connection Pool Manager ===\n");

    let manager = PoolManager::new();

    // Simulate workload
    println!("\n--- Simulating workload ---");
    for (name, pool) in &manager.pools {
        // Acquire and release some connections
        let mut acquired = Vec::new();
        for _ in 0..5 {
            if let Some(id) = pool.acquire() {
                acquired.push(id);
            }
        }
        for id in &acquired {
            pool.release(*id);
        }
    }

    // Print stats
    println!("\n--- Pool Statistics ---");
    for (name, stats) in manager.all_stats() {
        println!(
            "  {}: active={} idle={} total={}/{} waits={} timeouts={} created={} closed={} avg_acquire={:.1}ms",
            name, stats.active, stats.idle, stats.total, stats.max_size,
            stats.wait_count, stats.timeout_count, stats.created_total,
            stats.closed_total, stats.avg_acquire_ms
        );
    }
}
