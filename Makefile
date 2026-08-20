.PHONY: help dev install install-python install-angular test test-python test-angular \
        lint lint-python lint-angular format typecheck build clean

# Show this list when `make` is run with no target.
.DEFAULT_GOAL := help

help: ## Show this help message.
	@echo "Usage: make [target]"
	@echo ""
	@echo "Available targets:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## /{ printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

dev: ## Launch the Flask backend (poetry) and Angular frontend (npm) together.
	./dev.sh

install: install-python install-angular ## Install Python (Poetry) and Angular (npm) dependencies.

install-python: ## Install Python dependencies with Poetry.
	poetry install

install-angular: ## Install Angular dependencies with npm.
	cd angular-app && npm install
	@[ -f angular-app/src/environments/environment.ts ] || \
		cp angular-app/src/environments/environment.ts.template angular-app/src/environments/environment.ts

test: test-python test-angular ## Run the full test suite (Python + Angular).

test-python: ## Run the Python test suite.
	cd flask_app && poetry run pytest --disable-warnings

test-angular: ## Run the Angular test suite.
	cd angular-app && npm test

lint: lint-python lint-angular ## Run all lint/format checks (mirrors CI's pre-commit step).

lint-python: ## Run pre-commit checks on the Python code.
	poetry run pre-commit run --all-files

lint-angular: ## Run eslint on the Angular code.
	cd angular-app && npm run lint

format: ## Auto-fix formatting/lint issues where possible.
	poetry run ruff format .
	poetry run ruff check --fix .
	cd angular-app && npm run lint:fix

typecheck: ## Run mypy type checking on the Python code.
	./scripts/run_mypy.sh

build: ## Build the Angular app for production.
	cd angular-app && npm run build

clean: ## Remove build artifacts and caches.
	rm -rf angular-app/dist angular-app/.angular flask_app/htmlcov
	rm -rf .pytest_cache .ruff_cache
	find . -type d -name "__pycache__" -not -path "./node_modules/*" -not -path "./angular-app/node_modules/*" -exec rm -rf {} +
