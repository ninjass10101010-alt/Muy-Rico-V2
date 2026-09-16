#!/usr/bin/env bash
set -euo pipefail
mkdir -p ../admin ../app
cp dist/index.html ../admin/index.html
cp dist/index.html ../app/index.html
