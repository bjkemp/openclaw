#!/bin/bash

# Install openclaw command to system PATH

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_SCRIPT="${SCRIPT_DIR}/openclaw-service.sh"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}OpenClaw Command Installer${NC}"
echo "================================"

# Try to install to /usr/local/bin
if [ -w /usr/local/bin ]; then
    echo -e "${YELLOW}Creating symlink in /usr/local/bin...${NC}"
    ln -sf "${SERVICE_SCRIPT}" /usr/local/bin/openclaw
    echo -e "${GREEN}Installed! You can now use: openclaw${NC}"
    exit 0
fi

# Fall back to shell config
detect_shell() {
    if [ -n "${ZSH_VERSION}" ]; then
        echo "zsh"
    elif [ -n "${BASH_VERSION}" ]; then
        echo "bash"
    else
        basename "${SHELL}"
    fi
}

SHELL_TYPE=$(detect_shell)
case "${SHELL_TYPE}" in
    zsh)
        RC_FILE="${HOME}/.zshrc"
        ;;
    bash)
        RC_FILE="${HOME}/.bashrc"
        # Try .bash_profile on macOS
        [ ! -f "${RC_FILE}" ] && [ -f "${HOME}/.bash_profile" ] && RC_FILE="${HOME}/.bash_profile"
        ;;
    *)
        RC_FILE="${HOME}/.profile"
        ;;
esac

echo -e "${YELLOW}Cannot write to /usr/local/bin${NC}"
echo -e "${YELLOW}Adding alias to ${RC_FILE}${NC}"

# Check if alias already exists
if grep -q "alias openclaw=" "${RC_FILE}" 2>/dev/null; then
    echo -e "${YELLOW}Alias already exists, updating...${NC}"
    # Remove old alias
    sed -i.bak '/alias openclaw=/d' "${RC_FILE}"
fi

# Add alias
echo "" >> "${RC_FILE}"
echo "# OpenClaw service manager" >> "${RC_FILE}"
echo "alias openclaw='${SERVICE_SCRIPT}'" >> "${RC_FILE}"

echo -e "${GREEN}Installed!${NC}"
echo ""
echo -e "${BLUE}Run this to activate in current shell:${NC}"
echo -e "  source ${RC_FILE}"
echo ""
echo -e "${BLUE}Or open a new terminal and use:${NC}"
echo -e "  openclaw start|stop|restart|status|logs"
