package falkordb

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// FalkorDBClient provides graph database operations using FalkorDB (Redis-based graph DB)
type FalkorDBClient struct {
	client       *redis.Client
	graphName    string
	metrics      *GraphMetrics
	metricsMutex sync.RWMutex
}

// GraphMetrics tracks graph database performance
type GraphMetrics struct {
	QueriesExecuted   int64         `json:"queries_executed"`
	NodesCreated      int64         `json:"nodes_created"`
	EdgesCreated      int64         `json:"edges_created"`
	AverageLatencyMs  float64       `json:"average_latency_ms"`
	TotalLatencyMs    int64         `json:"total_latency_ms"`
	Errors            int64         `json:"errors"`
}

// Node represents a graph node
type Node struct {
	ID         string                 `json:"id"`
	Labels     []string               `json:"labels"`
	Properties map[string]interface{} `json:"properties"`
}

// Edge represents a graph edge/relationship
type Edge struct {
	ID         string                 `json:"id"`
	Type       string                 `json:"type"`
	SourceID   string                 `json:"source_id"`
	TargetID   string                 `json:"target_id"`
	Properties map[string]interface{} `json:"properties"`
}

// QueryResult represents the result of a graph query
type QueryResult struct {
	Nodes        []Node                   `json:"nodes"`
	Edges        []Edge                   `json:"edges"`
	Records      []map[string]interface{} `json:"records"`
	ExecutionMs  float64                  `json:"execution_ms"`
	NodesCreated int                      `json:"nodes_created"`
	NodesDeleted int                      `json:"nodes_deleted"`
	EdgesCreated int                      `json:"edges_created"`
	EdgesDeleted int                      `json:"edges_deleted"`
}

// FraudNetwork represents a fraud detection network
type FraudNetwork struct {
	Nodes           []FraudNode       `json:"nodes"`
	Edges           []FraudEdge       `json:"edges"`
	RiskScore       float64           `json:"risk_score"`
	FraudIndicators []string          `json:"fraud_indicators"`
	Clusters        []FraudCluster    `json:"clusters"`
}

// FraudNode represents a node in the fraud network
type FraudNode struct {
	ID         string  `json:"id"`
	Type       string  `json:"type"`
	RiskScore  float64 `json:"risk_score"`
	IsFlagged  bool    `json:"is_flagged"`
	Properties map[string]interface{} `json:"properties"`
}

// FraudEdge represents an edge in the fraud network
type FraudEdge struct {
	SourceID     string  `json:"source_id"`
	TargetID     string  `json:"target_id"`
	Type         string  `json:"type"`
	Weight       float64 `json:"weight"`
	IsSuspicious bool    `json:"is_suspicious"`
}

// FraudCluster represents a cluster of potentially fraudulent entities
type FraudCluster struct {
	ID          string   `json:"id"`
	NodeIDs     []string `json:"node_ids"`
	RiskScore   float64  `json:"risk_score"`
	Description string   `json:"description"`
}

// CustomerRelationship represents customer relationship data
type CustomerRelationship struct {
	CustomerID       string                   `json:"customer_id"`
	RelatedCustomers []RelatedCustomer        `json:"related_customers"`
	SharedPolicies   []string                 `json:"shared_policies"`
	SharedAgents     []string                 `json:"shared_agents"`
	NetworkScore     float64                  `json:"network_score"`
}

// RelatedCustomer represents a related customer
type RelatedCustomer struct {
	CustomerID   string  `json:"customer_id"`
	Relationship string  `json:"relationship"`
	Strength     float64 `json:"strength"`
}

// NewFalkorDBClient creates a new FalkorDB client
func NewFalkorDBClient(redisAddr string, graphName string) (*FalkorDBClient, error) {
	if redisAddr == "" {
		log.Fatal("FATAL: REDIS_ADDR environment variable is required")
	}
	if graphName == "" {
		graphName = "insurance_graph"
	}

	client := redis.NewClient(&redis.Options{
		Addr:         redisAddr,
		Password:     "",
		DB:           0,
		DialTimeout:  10 * time.Second,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		PoolSize:     10,
	})

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to FalkorDB: %w", err)
	}

	return &FalkorDBClient{
		client:    client,
		graphName: graphName,
		metrics:   &GraphMetrics{},
	}, nil
}

// ExecuteQuery executes a Cypher query against FalkorDB
func (c *FalkorDBClient) ExecuteQuery(ctx context.Context, query string, params map[string]interface{}) (*QueryResult, error) {
	startTime := time.Now()
	c.recordQuery()

	// Build the GRAPH.QUERY command
	args := []interface{}{"GRAPH.QUERY", c.graphName, query}
	if params != nil {
		paramsJSON, _ := json.Marshal(params)
		args = append(args, "--params", string(paramsJSON))
	}

	result, err := c.client.Do(ctx, args...).Result()
	if err != nil {
		c.recordError()
		return nil, fmt.Errorf("query execution failed: %w", err)
	}

	executionMs := float64(time.Since(startTime).Milliseconds())
	c.recordLatency(int64(executionMs))

	// Parse result
	queryResult := &QueryResult{
		ExecutionMs: executionMs,
		Records:     make([]map[string]interface{}, 0),
	}

	// Parse FalkorDB result format
	if resultSlice, ok := result.([]interface{}); ok {
		queryResult = c.parseQueryResult(resultSlice)
		queryResult.ExecutionMs = executionMs
	}

	return queryResult, nil
}

func (c *FalkorDBClient) parseQueryResult(result []interface{}) *QueryResult {
	qr := &QueryResult{
		Nodes:   make([]Node, 0),
		Edges:   make([]Edge, 0),
		Records: make([]map[string]interface{}, 0),
	}

	if len(result) < 2 {
		return qr
	}

	// Parse header and data
	if header, ok := result[0].([]interface{}); ok {
		if data, ok := result[1].([]interface{}); ok {
			for _, row := range data {
				if rowSlice, ok := row.([]interface{}); ok {
					record := make(map[string]interface{})
					for i, col := range rowSlice {
						if i < len(header) {
							if colName, ok := header[i].(string); ok {
								record[colName] = col
							}
						}
					}
					qr.Records = append(qr.Records, record)
				}
			}
		}
	}

	// Parse statistics if available
	if len(result) > 2 {
		if stats, ok := result[2].([]interface{}); ok {
			for _, stat := range stats {
				if statStr, ok := stat.(string); ok {
					// Parse statistics like "Nodes created: 1"
					var count int
					if _, err := fmt.Sscanf(statStr, "Nodes created: %d", &count); err == nil {
						qr.NodesCreated = count
					}
					if _, err := fmt.Sscanf(statStr, "Relationships created: %d", &count); err == nil {
						qr.EdgesCreated = count
					}
				}
			}
		}
	}

	return qr
}

// CreateCustomerNode creates a customer node in the graph
func (c *FalkorDBClient) CreateCustomerNode(ctx context.Context, customer map[string]interface{}) error {
	customerID := customer["customer_id"].(string)
	name := customer["name"].(string)
	segment := customer["segment"].(string)
	riskScore := customer["risk_score"].(float64)

	query := fmt.Sprintf(`
		CREATE (c:Customer {
			id: '%s',
			name: '%s',
			segment: '%s',
			risk_score: %f,
			created_at: datetime()
		})
		RETURN c
	`, customerID, name, segment, riskScore)

	_, err := c.ExecuteQuery(ctx, query, nil)
	if err != nil {
		return fmt.Errorf("failed to create customer node: %w", err)
	}

	c.metricsMutex.Lock()
	c.metrics.NodesCreated++
	c.metricsMutex.Unlock()

	return nil
}

// CreatePolicyNode creates a policy node in the graph
func (c *FalkorDBClient) CreatePolicyNode(ctx context.Context, policy map[string]interface{}) error {
	policyID := policy["policy_id"].(string)
	policyType := policy["policy_type"].(string)
	premium := policy["premium"].(float64)
	status := policy["status"].(string)

	query := fmt.Sprintf(`
		CREATE (p:Policy {
			id: '%s',
			type: '%s',
			premium: %f,
			status: '%s',
			created_at: datetime()
		})
		RETURN p
	`, policyID, policyType, premium, status)

	_, err := c.ExecuteQuery(ctx, query, nil)
	if err != nil {
		return fmt.Errorf("failed to create policy node: %w", err)
	}

	c.metricsMutex.Lock()
	c.metrics.NodesCreated++
	c.metricsMutex.Unlock()

	return nil
}

// CreateClaimNode creates a claim node in the graph
func (c *FalkorDBClient) CreateClaimNode(ctx context.Context, claim map[string]interface{}) error {
	claimID := claim["claim_id"].(string)
	claimType := claim["claim_type"].(string)
	amount := claim["amount"].(float64)
	status := claim["status"].(string)
	fraudScore := claim["fraud_score"].(float64)

	query := fmt.Sprintf(`
		CREATE (cl:Claim {
			id: '%s',
			type: '%s',
			amount: %f,
			status: '%s',
			fraud_score: %f,
			created_at: datetime()
		})
		RETURN cl
	`, claimID, claimType, amount, status, fraudScore)

	_, err := c.ExecuteQuery(ctx, query, nil)
	if err != nil {
		return fmt.Errorf("failed to create claim node: %w", err)
	}

	c.metricsMutex.Lock()
	c.metrics.NodesCreated++
	c.metricsMutex.Unlock()

	return nil
}

// CreateRelationship creates a relationship between two nodes
func (c *FalkorDBClient) CreateRelationship(ctx context.Context, sourceID, targetID, relType string, properties map[string]interface{}) error {
	propsStr := ""
	if properties != nil {
		propsJSON, _ := json.Marshal(properties)
		propsStr = string(propsJSON)
	}

	query := fmt.Sprintf(`
		MATCH (a {id: '%s'}), (b {id: '%s'})
		CREATE (a)-[r:%s %s]->(b)
		RETURN r
	`, sourceID, targetID, relType, propsStr)

	_, err := c.ExecuteQuery(ctx, query, nil)
	if err != nil {
		return fmt.Errorf("failed to create relationship: %w", err)
	}

	c.metricsMutex.Lock()
	c.metrics.EdgesCreated++
	c.metricsMutex.Unlock()

	return nil
}

// DetectFraudNetwork analyzes the graph for fraud patterns
func (c *FalkorDBClient) DetectFraudNetwork(ctx context.Context, customerIDs []string) (*FraudNetwork, error) {
	network := &FraudNetwork{
		Nodes:           make([]FraudNode, 0),
		Edges:           make([]FraudEdge, 0),
		FraudIndicators: make([]string, 0),
		Clusters:        make([]FraudCluster, 0),
	}

	// Query for suspicious patterns
	// Pattern 1: Multiple claims from connected customers
	multiClaimQuery := `
		MATCH (c1:Customer)-[:HAS_POLICY]->(p:Policy)-[:HAS_CLAIM]->(cl:Claim)
		WHERE cl.fraud_score > 0.5
		MATCH (c1)-[:RELATED_TO]-(c2:Customer)-[:HAS_POLICY]->(:Policy)-[:HAS_CLAIM]->(cl2:Claim)
		WHERE cl2.fraud_score > 0.5
		RETURN c1, c2, cl, cl2
		LIMIT 100
	`

	result, err := c.ExecuteQuery(ctx, multiClaimQuery, nil)
	if err != nil {
		// Continue with partial results
		network.FraudIndicators = append(network.FraudIndicators, "Query error: "+err.Error())
	} else {
		for _, record := range result.Records {
			// Process fraud network nodes
			if c1, ok := record["c1"].(map[string]interface{}); ok {
				network.Nodes = append(network.Nodes, FraudNode{
					ID:        fmt.Sprintf("%v", c1["id"]),
					Type:      "customer",
					RiskScore: 0.7,
					IsFlagged: true,
				})
			}
		}
	}

	// Pattern 2: Ring of connected policies
	ringQuery := `
		MATCH path = (c:Customer)-[:HAS_POLICY*2..5]-(c)
		WHERE length(path) > 2
		RETURN nodes(path) as ring_nodes, relationships(path) as ring_edges
		LIMIT 50
	`

	ringResult, err := c.ExecuteQuery(ctx, ringQuery, nil)
	if err == nil && len(ringResult.Records) > 0 {
		network.FraudIndicators = append(network.FraudIndicators, "Circular policy relationships detected")
	}

	// Pattern 3: Shared contact information
	sharedInfoQuery := `
		MATCH (c1:Customer), (c2:Customer)
		WHERE c1 <> c2 AND (c1.phone = c2.phone OR c1.email = c2.email OR c1.address = c2.address)
		RETURN c1.id as customer1, c2.id as customer2, 
			   CASE WHEN c1.phone = c2.phone THEN 'phone' 
			        WHEN c1.email = c2.email THEN 'email' 
			        ELSE 'address' END as shared_field
		LIMIT 100
	`

	sharedResult, err := c.ExecuteQuery(ctx, sharedInfoQuery, nil)
	if err == nil && len(sharedResult.Records) > 0 {
		network.FraudIndicators = append(network.FraudIndicators, "Shared contact information detected")
		for _, record := range sharedResult.Records {
			network.Edges = append(network.Edges, FraudEdge{
				SourceID:     fmt.Sprintf("%v", record["customer1"]),
				TargetID:     fmt.Sprintf("%v", record["customer2"]),
				Type:         fmt.Sprintf("SHARED_%v", record["shared_field"]),
				Weight:       0.8,
				IsSuspicious: true,
			})
		}
	}

	// Calculate overall risk score
	if len(network.Nodes) > 0 {
		totalRisk := 0.0
		for _, node := range network.Nodes {
			totalRisk += node.RiskScore
		}
		network.RiskScore = totalRisk / float64(len(network.Nodes))
	}

	// Identify clusters using community detection
	network.Clusters = c.detectFraudClusters(network.Nodes, network.Edges)

	return network, nil
}

func (c *FalkorDBClient) detectFraudClusters(nodes []FraudNode, edges []FraudEdge) []FraudCluster {
	clusters := make([]FraudCluster, 0)

	// Simple clustering based on connected components
	nodeMap := make(map[string]bool)
	for _, node := range nodes {
		nodeMap[node.ID] = true
	}

	// Build adjacency list
	adjacency := make(map[string][]string)
	for _, edge := range edges {
		adjacency[edge.SourceID] = append(adjacency[edge.SourceID], edge.TargetID)
		adjacency[edge.TargetID] = append(adjacency[edge.TargetID], edge.SourceID)
	}

	// Find connected components
	visited := make(map[string]bool)
	clusterID := 0

	for nodeID := range nodeMap {
		if visited[nodeID] {
			continue
		}

		// BFS to find connected component
		component := make([]string, 0)
		queue := []string{nodeID}

		for len(queue) > 0 {
			current := queue[0]
			queue = queue[1:]

			if visited[current] {
				continue
			}
			visited[current] = true
			component = append(component, current)

			for _, neighbor := range adjacency[current] {
				if !visited[neighbor] {
					queue = append(queue, neighbor)
				}
			}
		}

		if len(component) > 1 {
			clusters = append(clusters, FraudCluster{
				ID:          fmt.Sprintf("cluster_%d", clusterID),
				NodeIDs:     component,
				RiskScore:   0.75,
				Description: fmt.Sprintf("Connected fraud cluster with %d entities", len(component)),
			})
			clusterID++
		}
	}

	return clusters
}

// GetCustomerRelationships gets all relationships for a customer
func (c *FalkorDBClient) GetCustomerRelationships(ctx context.Context, customerID string) (*CustomerRelationship, error) {
	query := fmt.Sprintf(`
		MATCH (c:Customer {id: '%s'})
		OPTIONAL MATCH (c)-[r:RELATED_TO]-(related:Customer)
		OPTIONAL MATCH (c)-[:HAS_POLICY]->(p:Policy)<-[:HAS_POLICY]-(shared:Customer)
		OPTIONAL MATCH (c)-[:MANAGED_BY]->(a:Agent)<-[:MANAGED_BY]-(agentShared:Customer)
		RETURN c, 
			   collect(DISTINCT {id: related.id, type: type(r)}) as related_customers,
			   collect(DISTINCT p.id) as shared_policies,
			   collect(DISTINCT a.id) as shared_agents
	`, customerID)

	result, err := c.ExecuteQuery(ctx, query, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get customer relationships: %w", err)
	}

	relationship := &CustomerRelationship{
		CustomerID:       customerID,
		RelatedCustomers: make([]RelatedCustomer, 0),
		SharedPolicies:   make([]string, 0),
		SharedAgents:     make([]string, 0),
	}

	if len(result.Records) > 0 {
		record := result.Records[0]
		
		if related, ok := record["related_customers"].([]interface{}); ok {
			for _, r := range related {
				if rMap, ok := r.(map[string]interface{}); ok {
					relationship.RelatedCustomers = append(relationship.RelatedCustomers, RelatedCustomer{
						CustomerID:   fmt.Sprintf("%v", rMap["id"]),
						Relationship: fmt.Sprintf("%v", rMap["type"]),
						Strength:     0.5,
					})
				}
			}
		}

		if policies, ok := record["shared_policies"].([]interface{}); ok {
			for _, p := range policies {
				relationship.SharedPolicies = append(relationship.SharedPolicies, fmt.Sprintf("%v", p))
			}
		}

		if agents, ok := record["shared_agents"].([]interface{}); ok {
			for _, a := range agents {
				relationship.SharedAgents = append(relationship.SharedAgents, fmt.Sprintf("%v", a))
			}
		}
	}

	// Calculate network score
	relationship.NetworkScore = float64(len(relationship.RelatedCustomers)+len(relationship.SharedPolicies)+len(relationship.SharedAgents)) / 10.0
	if relationship.NetworkScore > 1.0 {
		relationship.NetworkScore = 1.0
	}

	return relationship, nil
}

// FindShortestPath finds the shortest path between two entities
func (c *FalkorDBClient) FindShortestPath(ctx context.Context, sourceID, targetID string, maxHops int) (*QueryResult, error) {
	query := fmt.Sprintf(`
		MATCH path = shortestPath((a {id: '%s'})-[*..%d]-(b {id: '%s'}))
		RETURN path, length(path) as path_length
	`, sourceID, maxHops, targetID)

	return c.ExecuteQuery(ctx, query, nil)
}

// GetGraphStatistics returns statistics about the graph
func (c *FalkorDBClient) GetGraphStatistics(ctx context.Context) (map[string]interface{}, error) {
	stats := make(map[string]interface{})

	// Count nodes by label
	nodeCountQuery := `
		MATCH (n)
		RETURN labels(n) as label, count(n) as count
	`
	nodeResult, err := c.ExecuteQuery(ctx, nodeCountQuery, nil)
	if err == nil {
		nodeCounts := make(map[string]int)
		for _, record := range nodeResult.Records {
			if label, ok := record["label"].(string); ok {
				if count, ok := record["count"].(int); ok {
					nodeCounts[label] = count
				}
			}
		}
		stats["node_counts"] = nodeCounts
	}

	// Count relationships by type
	edgeCountQuery := `
		MATCH ()-[r]->()
		RETURN type(r) as type, count(r) as count
	`
	edgeResult, err := c.ExecuteQuery(ctx, edgeCountQuery, nil)
	if err == nil {
		edgeCounts := make(map[string]int)
		for _, record := range edgeResult.Records {
			if relType, ok := record["type"].(string); ok {
				if count, ok := record["count"].(int); ok {
					edgeCounts[relType] = count
				}
			}
		}
		stats["edge_counts"] = edgeCounts
	}

	// Add client metrics
	c.metricsMutex.RLock()
	stats["client_metrics"] = c.metrics
	c.metricsMutex.RUnlock()

	return stats, nil
}

// GetMetrics returns client metrics
func (c *FalkorDBClient) GetMetrics() GraphMetrics {
	c.metricsMutex.RLock()
	defer c.metricsMutex.RUnlock()
	return *c.metrics
}

func (c *FalkorDBClient) recordQuery() {
	c.metricsMutex.Lock()
	defer c.metricsMutex.Unlock()
	c.metrics.QueriesExecuted++
}

func (c *FalkorDBClient) recordLatency(latencyMs int64) {
	c.metricsMutex.Lock()
	defer c.metricsMutex.Unlock()
	c.metrics.TotalLatencyMs += latencyMs
	if c.metrics.QueriesExecuted > 0 {
		c.metrics.AverageLatencyMs = float64(c.metrics.TotalLatencyMs) / float64(c.metrics.QueriesExecuted)
	}
}

func (c *FalkorDBClient) recordError() {
	c.metricsMutex.Lock()
	defer c.metricsMutex.Unlock()
	c.metrics.Errors++
}

// Close closes the FalkorDB client
func (c *FalkorDBClient) Close() error {
	return c.client.Close()
}
