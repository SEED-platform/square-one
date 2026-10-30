#!/bin/bash

set -e
cd "$(dirname "$0")/.."
poetry run ty check
