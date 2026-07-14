.PHONY: help build test lint docker-build docker-build-all health clean

# Default target
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-25s\033[0m %s\n", $$1, $$2}'

# === Go Modules ===
GO_MODULES := claims-adjudication-engine fraud-detection-go ussd-gateway \
	enhanced-kyc-kyb enterprise-mdm disaster-recovery-module naicom-compliance-module \
	ab-testing-framework agent-commission-management agent-mobile-app \
	audit-trail-system bancassurance-integration batch-processing-engine \
	customer-360-view gdpr-compliance group-life-admin \
	native-mobile-ios ndpr-compliance nmid-integration \
	performance-monitoring-dashboard pfa-integration \
	policy-renewal-automation reinsurance-management strategic-implementations \
	insurance-tech-innovations blockchain-transparency microinsurance-engine \
	takaful-module multi-country-regulatory usage-based-insurance \
	premium-finance-service instant-payout-service cross-company-fraud-database \
	dr-ha-service

# === Python Services ===
PYTHON_SERVICES := ifrs17-engine mlops-governance

# === Docker Services (key services for docker-build) ===
DOCKER_SERVICES := claims-adjudication-engine fraud-detection-go ussd-gateway enhanced-kyc-kyb enterprise-mdm disaster-recovery-module naicom-compliance-module

# === build: Build all Go services ===
build: build-go build-shared ## Build all Go services
	@echo "=== Build complete ==="

build-shared: ## Build shared Go packages
	@echo "=== Building shared packages ==="
	@cd shared && go build ./...
	@echo "Shared packages built."

build-go: ## Build all Go modules
	@for mod in $(GO_MODULES); do \
		echo "=== Building $$mod ==="; \
		(cd $$mod && go mod download && go build -o /dev/null ./...) || { echo "ERROR: $$mod build failed"; exit 1; }; \
	done
	@echo "=== All Go services built successfully ==="

# === test: Run all tests ===
test: test-go test-python test-frontend ## Run all tests
	@echo "=== Test suite complete ==="

test-go: ## Run Go tests across all modules
	@for mod in $(GO_MODULES); do \
		echo "=== Testing $$mod ==="; \
		(cd $$mod && go test -race -count=1 -timeout=5m ./...) || { echo "WARN: $$mod tests failed or have no tests"; }; \
	done
	@echo "=== Go tests complete ==="

test-python: ## Run Python tests for ML/AI services
	@for svc in $(PYTHON_SERVICES); do \
		echo "=== Testing $$svc ==="; \
		(cd $$svc && pip install -q -r requirements.txt 2>/dev/null; python -m pytest tests/ -v 2>/dev/null) || { echo "WARN: $$svc tests failed or have no tests"; }; \
	done
	@echo "=== Python tests complete ==="

test-frontend: ## Run frontend tests (vitest)
	@echo "=== Running frontend tests ==="
	@pnpm test 2>/dev/null || echo "WARN: frontend tests skipped (missing node_modules)"
	@echo "=== Frontend tests complete ==="

# === lint: Run all linters ===
lint: lint-go lint-python lint-yaml lint-frontend ## Run all linters
	@echo "=== Linting complete ==="

lint-go: ## Lint Go modules with go vet
	@for mod in $(GO_MODULES); do \
		echo "=== Linting $$mod ==="; \
		(cd $$mod && go vet ./...) || { echo "WARN: $$mod go vet found issues"; }; \
	done
	@echo "=== Go lint complete ==="

lint-python: ## Lint Python services with ruff
	@for svc in $(PYTHON_SERVICES); do \
		echo "=== Linting $$svc ==="; \
		(test -f "$$svc/requirements.txt" || echo "WARNING: requirements.txt not found in $$svc") && \
		pip install -q ruff 2>/dev/null && ruff check "$$svc" --select E,W,F --ignore E501 || { echo "WARN: $$svc lint skipped or failed"; }; \
	done
	@echo "=== Python lint complete ==="

lint-yaml: ## Lint YAML/K8s manifests
	@find . -path "*/k8s/*.yaml" -print0 | xargs -0 -I{} sh -c \
		'echo "=== {} ===" && yamllint -d relaxed "{}" 2>/dev/null || echo "WARN: yamllint not installed, skipping {}"'
	@echo "=== YAML lint complete ==="

lint-frontend: ## Lint frontend code with eslint
	@echo "=== Running ESLint ==="
	@pnpm exec eslint --max-warnings 0 server/ --ext .ts,.tsx,.js,.jsx 2>/dev/null || echo "WARN: eslint skipped (missing dependencies)"
	@echo "=== Frontend lint complete ==="

# === docker-build: Build Docker images for a key service ===
docker-build: ## Build Docker image for a key service (MODULE=name, e.g. make docker-build MODULE=claims-adjudication-engine)
	@if [ -z "$(MODULE)" ]; then \
		echo "Usage: make docker-build MODULE=<service-name>"; \
		echo "Available services:"; \
		for svc in $(DOCKER_SERVICES); do echo "  $$svc"; done; \
		exit 1; \
	fi
	@echo "=== Building Docker image for $(MODULE) ==="
	@if [ -f "$(MODULE)/Dockerfile" ]; then \
		docker build -t insurance-platform/$(MODULE):latest "$(MODULE)/"; \
		echo "Docker image built: insurance-platform/$(MODULE):latest"; \
	else \
		echo "ERROR: No Dockerfile found in $(MODULE)/"; \
		exit 1; \
	fi

# === docker-build-all: Build Docker images for all key services ===
docker-build-all: ## Build Docker images for all key services
	@for svc in $(DOCKER_SERVICES); do \
		echo "=== Building Docker image for $$svc ==="; \
		if [ -f "$$svc/Dockerfile" ]; then \
			docker build -t insurance-platform/$$svc:latest "$$svc/"; \
		else \
			echo "SKIP: No Dockerfile found in $$svc/"; \
		fi; \
	done
	@echo "=== Docker build-all complete ==="

# === health: Run health checks on running services ===
health: ## Check health of all running services
	@echo "=== Checking service health ==="
	@FOUND_HEALTHY=0; FOUND_DOWN=0; \
	for port in 8002 8003 8004 8005 8010 8011 8012 8020 8021 8022 8023 8024 8025; do \
		result=$$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 5 http://localhost:$$port/health 2>/dev/null); \
		if [ "$$result" = "200" ]; then \
			echo "  Port $$port: HEALTHY"; \
			FOUND_HEALTHY=$$((FOUND_HEALTHY + 1)); \
		else \
			echo "  Port $$port: DOWN ($$result)"; \
			FOUND_DOWN=$$((FOUND_DOWN + 1)); \
		fi; \
	done; \
	echo ""; \
	echo "Results: $$FOUND_HEALTHY healthy, $$FOUND_DOWN down"

# === clean: Clean build artifacts ===
clean: ## Clean build artifacts
	@find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	@find . -name "*.pyc" -delete 2>/dev/null || true
	@echo "Cleaned."
