#!/usr/bin/env bash
# ============================================================
# Frontdesk AI — Dev helper script
# Usage: ./dev.sh [up|down|logs|reset|ps|shell <service>]
# ============================================================
set -euo pipefail

COMPOSE_FILE="infra/docker/docker-compose.yml"
ENV_FILE=".env"
PROJECT_NAME="frontdesk-ai"

# ANSI colours
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Colour

log_info()  { echo -e "${CYAN}[frontdesk]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[frontdesk]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[frontdesk]${NC} $*"; }
log_error() { echo -e "${RED}[frontdesk]${NC} $*" >&2; }

# Ensure .env exists
if [[ ! -f "$ENV_FILE" ]]; then
  log_warn ".env not found — copying from .env.example"
  cp .env.example .env
fi

cmd="${1:-help}"

case "$cmd" in
  up)
    PROFILE="${2:-}"
    FLAGS=""
    if [[ -n "$PROFILE" ]]; then
      FLAGS="--profile $PROFILE"
    fi
    log_info "Starting infrastructure stack (profile: ${PROFILE:-default})..."
    docker compose \
      -f "$COMPOSE_FILE" \
      -p "$PROJECT_NAME" \
      --env-file "$ENV_FILE" \
      $FLAGS \
      up -d --build --remove-orphans
    log_ok "Stack is up. Run './dev.sh logs' to tail logs."
    log_ok "  Postgres:        postgresql://frontdesk:frontdesk_secret@localhost:5432/frontdesk"
    log_ok "  Redis:           redis://localhost:6379"
    log_ok "  Kafka:           localhost:9092"
    log_ok "  Elasticsearch:   http://localhost:9200"
    if [[ "$PROFILE" == "observability" ]]; then
      log_ok "  Jaeger UI:       http://localhost:16686"
      log_ok "  Prometheus:      http://localhost:9090"
      log_ok "  Kibana:          http://localhost:5601"
    fi
    ;;

  down)
    log_info "Stopping infrastructure stack..."
    docker compose \
      -f "$COMPOSE_FILE" \
      -p "$PROJECT_NAME" \
      --env-file "$ENV_FILE" \
      down
    log_ok "Stack stopped."
    ;;

  logs)
    SERVICE="${2:-}"
    docker compose \
      -f "$COMPOSE_FILE" \
      -p "$PROJECT_NAME" \
      logs -f --tail=100 $SERVICE
    ;;

  reset)
    log_warn "This will destroy ALL local data (volumes). Proceed? [y/N]"
    read -r -n1 confirm
    echo
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
      log_info "Tearing down stack and removing volumes..."
      docker compose \
        -f "$COMPOSE_FILE" \
        -p "$PROJECT_NAME" \
        down -v --remove-orphans
      log_ok "Volumes purged. Run './dev.sh up' to start fresh."
    else
      log_info "Aborted."
    fi
    ;;

  ps)
    docker compose \
      -f "$COMPOSE_FILE" \
      -p "$PROJECT_NAME" \
      ps
    ;;

  shell)
    SERVICE="${2:?Usage: ./dev.sh shell <service>}"
    docker compose \
      -f "$COMPOSE_FILE" \
      -p "$PROJECT_NAME" \
      exec "$SERVICE" /bin/sh
    ;;

  help|*)
    echo ""
    echo "  Frontdesk AI — Dev Helper"
    echo ""
    echo "  Usage: ./dev.sh <command> [options]"
    echo ""
    echo "  Commands:"
    echo "    up [observability]   Start the dev stack (add 'observability' for Jaeger/Prom/Kibana)"
    echo "    down                 Stop all containers"
    echo "    logs [service]       Tail logs (optional: specific service)"
    echo "    reset                Destroy all containers and volumes (destructive!)"
    echo "    ps                   Show running containers"
    echo "    shell <service>      Open a shell inside a container"
    echo ""
    ;;
esac
