#!/bin/bash
# Run mypy type checking for Square One

echo "Running mypy type checking..."
cd "$(dirname "$0")/.."
poetry run mypy --config-file mypy.ini

echo ""
echo "Type checking complete."
echo "To fix errors gradually, consider:"
echo "1. Adding return type annotations to __init__ methods (-> None)"
echo "2. Adding type annotations to function parameters"
echo "3. Adding proper return type annotations"
echo "4. Using proper type hints for dictionaries and lists"
echo ""
echo "For more information, see: https://mypy.readthedocs.io/"
