package vault

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"
)

// Client provides access to HashiCorp Vault secrets.
// Falls back to environment variables if Vault is not configured.
type Client struct {
	addr   string
	token  string
	client *http.Client
	cache  map[string]map[string]string
	mu     sync.RWMutex
	ttl    time.Duration
}

// New creates a Vault client. If VAULT_ADDR or VAULT_TOKEN are not set,
// all lookups fall back to environment variables.
func New() *Client {
	return &Client{
		addr:   os.Getenv("VAULT_ADDR"),
		token:  os.Getenv("VAULT_TOKEN"),
		client: &http.Client{Timeout: 5 * time.Second},
		cache:  make(map[string]map[string]string),
		ttl:    5 * time.Minute,
	}
}

// GetSecret retrieves a secret from Vault KV v2. Falls back to the env var
// named envFallback if Vault is unreachable.
func (c *Client) GetSecret(path, key, envFallback string) string {
	if c.addr == "" || c.token == "" {
		return os.Getenv(envFallback)
	}

	c.mu.RLock()
	if cached, ok := c.cache[path]; ok {
		if v, ok := cached[key]; ok {
			c.mu.RUnlock()
			return v
		}
	}
	c.mu.RUnlock()

	secrets, err := c.readKV(path)
	if err != nil {
		return os.Getenv(envFallback)
	}

	c.mu.Lock()
	c.cache[path] = secrets
	c.mu.Unlock()

	if v, ok := secrets[key]; ok {
		return v
	}
	return os.Getenv(envFallback)
}

// GetDatabaseURL builds a PostgreSQL connection string from Vault secrets.
func (c *Client) GetDatabaseURL() string {
	if c.addr == "" || c.token == "" {
		if url := os.Getenv("DATABASE_URL"); url != "" {
			return url
		}
		host := envOr("DB_HOST", "localhost")
		port := envOr("DB_PORT", "5432")
		user := envOr("DB_USERNAME", "ubuntu")
		pass := envOr("DB_PASSWORD", "")
		name := envOr("DB_NAME", "insureportal")
		ssl := envOr("DB_SSLMODE", "disable")
		return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s", user, pass, host, port, name, ssl)
	}

	host := c.GetSecret("insureportal/global/database", "host", "DB_HOST")
	port := c.GetSecret("insureportal/global/database", "port", "DB_PORT")
	user := c.GetSecret("insureportal/global/database", "username", "DB_USERNAME")
	pass := c.GetSecret("insureportal/global/database", "password", "DB_PASSWORD")
	name := c.GetSecret("insureportal/global/database", "name", "DB_NAME")
	ssl := c.GetSecret("insureportal/global/database", "sslmode", "DB_SSLMODE")

	if host == "" {
		host = "localhost"
	}
	if port == "" {
		port = "5432"
	}
	if ssl == "" {
		ssl = "require"
	}

	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s", user, pass, host, port, name, ssl)
}

func (c *Client) readKV(path string) (map[string]string, error) {
	url := fmt.Sprintf("%s/v1/%s", c.addr, path)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Vault-Token", c.token)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("vault: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var response struct {
		Data struct {
			Data map[string]interface{} `json:"data"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, err
	}

	result := make(map[string]string)
	for k, v := range response.Data.Data {
		result[k] = fmt.Sprintf("%v", v)
	}
	return result, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
