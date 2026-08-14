.PHONY: dev install install-python install-angular test test-python test-angular \
        lint lint-python lint-angular format typecheck build clean

# Launch the Flask backend (poetry) and Angular frontend (npm) together.
dev:
	./dev.sh

# Install Python (Poetry) and Angular (npm) dependencies.
install: install-python install-angular

install-python:
	poetry install

install-angular:
	cd angular-app && npm install
	@[ -f angular-app/src/environments/environment.ts ] || \
		cp angular-app/src/environments/environment.ts.template angular-app/src/environments/environment.ts

# Run the full test suite (Python + Angular).
test: test-python test-angular

test-python:
	cd flask_app && poetry run pytest --disable-warnings

test-angular:
	cd angular-app && npm test

# Run all lint/format checks (mirrors CI's pre-commit step).
lint: lint-python lint-angular

lint-python:
	poetry run pre-commit run --all-files

lint-angular:
	cd angular-app && npm run lint

# Auto-fix formatting/lint issues where possible.
format:
	poetry run ruff format .
	poetry run ruff check --fix .
	cd angular-app && npm run lint:fix

# Run mypy type checking on the Python code.
typecheck:
	./scripts/run_mypy.sh

# Build the Angular app for production.
build:
	cd angular-app && npm run build

# Remove build artifacts and caches.
clean:
	rm -rf angular-app/dist angular-app/.angular flask_app/htmlcov
	rm -rf .pytest_cache .ruff_cache
	find . -type d -name "__pycache__" -not -path "./node_modules/*" -not -path "./angular-app/node_modules/*" -exec rm -rf {} +
