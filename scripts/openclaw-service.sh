#!/bin/bash

# OpenClaw Service Manager
# Usage: openclaw {start|stop|restart|status|logs}

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
MLX_PORT=8080
MLX_HOST="127.0.0.1"
MLX_MODEL="/Users/kempb/Projects/openclaw/models/Ministral-3-14B-Instruct-2512-4bit"
GATEWAY_PORT=18789
GATEWAY_BIND="loopback"

# Paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
LOG_DIR="${HOME}/.openclaw/logs"
MLX_PID_FILE="${HOME}/.openclaw/mlx-server.pid"
GATEWAY_PID_FILE="${HOME}/.openclaw/gateway.pid"
MLX_LOG="${LOG_DIR}/mlx-server.log"
GATEWAY_LOG="${LOG_DIR}/gateway.log"

# Ensure log directory exists
mkdir -p "${LOG_DIR}"

# Check if process is running
is_running() {
    local pid_file=$1
    if [ -f "${pid_file}" ]; then
        local pid=$(cat "${pid_file}")
        if ps -p "${pid}" > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Check if MLX server is responding
check_mlx_ready() {
    curl -s -f "http://${MLX_HOST}:${MLX_PORT}/v1/models" > /dev/null 2>&1
    return $?
}

# Start MLX server
start_mlx() {
    if is_running "${MLX_PID_FILE}"; then
        echo -e "${YELLOW}MLX server already running${NC}"
        return 0
    fi

    echo -e "${YELLOW}Starting MLX server...${NC}"

    cd /Users/kempb/Projects && \
    uv run python -m mlx_lm.server \
        --model "${MLX_MODEL}" \
        --host "${MLX_HOST}" \
        --port "${MLX_PORT}" \
        > "${MLX_LOG}" 2>&1 &

    local pid=$!
    echo "${pid}" > "${MLX_PID_FILE}"
    echo -e "${GREEN}MLX server started (PID: ${pid})${NC}"

    # Wait for ready
    echo -e "${YELLOW}Waiting for MLX server to be ready...${NC}"
    for i in {1..60}; do
        if check_mlx_ready; then
            echo -e "${GREEN}MLX server is ready!${NC}"
            return 0
        fi
        sleep 1
    done

    echo -e "${RED}MLX server failed to start. Check logs: ${MLX_LOG}${NC}"
    return 1
}

# Start gateway
start_gateway() {
    if is_running "${GATEWAY_PID_FILE}"; then
        echo -e "${YELLOW}Gateway already running${NC}"
        return 0
    fi

    echo -e "${YELLOW}Starting OpenClaw gateway...${NC}"

    cd "${PROJECT_DIR}"
    node scripts/run-node.mjs gateway --bind "${GATEWAY_BIND}" --port "${GATEWAY_PORT}" --force \
        > "${GATEWAY_LOG}" 2>&1 &

    local pid=$!
    echo "${pid}" > "${GATEWAY_PID_FILE}"
    echo -e "${GREEN}Gateway started (PID: ${pid})${NC}"
    echo -e "${BLUE}Gateway running at http://localhost:${GATEWAY_PORT}${NC}"
}

# Stop process
stop_process() {
    local name=$1
    local pid_file=$2

    if ! is_running "${pid_file}"; then
        # Try to find by name anyway
        local pids=$(pgrep -f "${name}" || true)
        if [ -n "${pids}" ]; then
            echo -e "${YELLOW}Found stray ${name} processes: ${pids}${NC}"
            echo "${pids}" | xargs kill 2>/dev/null || true
            sleep 1
            echo -e "${GREEN}${name} stopped${NC}"
        else
            echo -e "${YELLOW}${name} not running${NC}"
        fi
        [ -f "${pid_file}" ] && rm "${pid_file}"
        return 0
    fi

    local pid=$(cat "${pid_file}")
    echo -e "${YELLOW}Stopping ${name} (PID: ${pid})...${NC}"

    kill "${pid}" 2>/dev/null || true
    sleep 2

    # Force kill if still running
    if ps -p "${pid}" > /dev/null 2>&1; then
        echo -e "${YELLOW}Force stopping ${name}...${NC}"
        kill -9 "${pid}" 2>/dev/null || true
    fi

    rm "${pid_file}"
    echo -e "${GREEN}${name} stopped${NC}"
}

# Stop services
stop_services() {
    echo -e "${GREEN}Stopping OpenClaw services...${NC}"
    stop_process "Gateway" "${GATEWAY_PID_FILE}"
    stop_process "MLX server" "${MLX_PID_FILE}"
}

# Start services
start_services() {
    echo -e "${GREEN}Starting OpenClaw services...${NC}"
    start_mlx || exit 1
    echo ""
    start_gateway
    echo ""
    echo -e "${GREEN}All services started successfully!${NC}"
}

# Show status
show_status() {
    echo -e "${GREEN}OpenClaw Service Status${NC}"
    echo "================================"

    # MLX server
    if is_running "${MLX_PID_FILE}"; then
        local pid=$(cat "${MLX_PID_FILE}")
        echo -e "MLX Server:  ${GREEN}RUNNING${NC} (PID: ${pid})"
        if check_mlx_ready; then
            echo -e "             ${GREEN}Ready${NC} at http://${MLX_HOST}:${MLX_PORT}"
        else
            echo -e "             ${YELLOW}Starting...${NC}"
        fi
    else
        echo -e "MLX Server:  ${RED}STOPPED${NC}"
    fi

    # Gateway
    if is_running "${GATEWAY_PID_FILE}"; then
        local pid=$(cat "${GATEWAY_PID_FILE}")
        echo -e "Gateway:     ${GREEN}RUNNING${NC} (PID: ${pid})"
        echo -e "             ${BLUE}http://localhost:${GATEWAY_PORT}${NC}"
    else
        echo -e "Gateway:     ${RED}STOPPED${NC}"
    fi

    echo ""
    echo "Logs:"
    echo "  MLX:     ${MLX_LOG}"
    echo "  Gateway: ${GATEWAY_LOG}"
}

# Show logs
show_logs() {
    local service=$1
    case "${service}" in
        mlx)
            echo -e "${GREEN}MLX Server Logs:${NC}"
            tail -f "${MLX_LOG}"
            ;;
        gateway)
            echo -e "${GREEN}Gateway Logs:${NC}"
            tail -f "${GATEWAY_LOG}"
            ;;
        *)
            echo -e "${GREEN}All Logs (Ctrl+C to stop):${NC}"
            tail -f "${MLX_LOG}" "${GATEWAY_LOG}"
            ;;
    esac
}

# Main command handler
case "${1:-}" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        stop_services
        echo ""
        sleep 1
        start_services
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "${2:-}"
        ;;
    *)
        echo "Usage: $(basename "$0") {start|stop|restart|status|logs}"
        echo ""
        echo "Commands:"
        echo "  start    - Start MLX server and gateway"
        echo "  stop     - Stop all services"
        echo "  restart  - Restart all services"
        echo "  status   - Show service status"
        echo "  logs     - Show logs (optional: mlx|gateway)"
        exit 1
        ;;
esac
