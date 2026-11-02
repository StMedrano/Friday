#!/usr/bin/env bash
set -euo pipefail

MODEL="${FRIDAY_LOCAL_AI_MODEL:-qwen3:4b-instruct}"

docker compose --profile local-ai up -d ollama
docker compose exec -T ollama ollama pull "$MODEL"
docker compose exec -T ollama ollama list
