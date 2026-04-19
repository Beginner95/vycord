.PHONY: help build run test migrate-up migrate-down docker-up docker-down clean

help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: ## Build the server
	@cd server && go build -o ../bin/server ./cmd/api

build-sfu: ## Build the SFU server
	@cd server && go build -o ../bin/sfu ./cmd/sfu

run: ## Run the server
	@cd server && go run ./cmd/api

run-sfu: ## Run the SFU server
	@cd server && go run ./cmd/sfu

test: ## Run tests
	@cd server && go test -v ./...

test-coverage: ## Run tests with coverage
	@cd server && go test -v -coverprofile=coverage.out ./...
	@cd server && go tool cover -html=coverage.out -o coverage.html

migrate-up: ## Run all migrations up
	@cd server && go run ./cmd/migrate "postgres://mydiscrod:mydiscrod_secret@localhost:5432/mydiscrod?sslmode=disable" up

migrate-down: ## Run all migrations down
	@cd server && go run ./cmd/migrate "postgres://mydiscrod:mydiscrod_secret@localhost:5432/mydiscrod?sslmode=disable" down

migrate-create: ## Create a new migration (usage: make migrate-create NAME=xxx)
	@echo "-- +migrate Up" > "server/migrations/$(NAME).up.sql"
	@echo "-- +migrate Down" > "server/migrations/$(NAME).down.sql"
	@echo "Created: server/migrations/$(NAME).up.sql"
	@echo "Created: server/migrations/$(NAME).down.sql"

docker-up: ## Start docker services (postgres, redis)
	@docker compose up -d postgres redis

docker-up-all: ## Start all docker services including frontend
	@docker compose up -d

docker-down: ## Stop docker services
	@docker compose down

docker-logs: ## Show docker logs
	@docker compose logs -f

build-client: ## Build frontend docker image
	@docker compose build client

run-client: ## Run frontend in docker (rebuilds if needed)
	@docker compose up -d client

install-deps: ## Install Go dependencies
	@cd server && go mod download

install-migrate: ## Install migrate CLI
	@go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

lint: ## Run linter
	@cd server && golangci-lint run

fmt: ## Format code
	@cd server && go fmt ./...

vet: ## Run go vet
	@cd server && go vet ./...

clean: ## Remove build artifacts
	@rm -rf bin
	@rm -f server/coverage.out server/coverage.html
