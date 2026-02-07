#!/bin/bash
# LP Setup Script
# Usage: ./startup.sh <VAULT_ADDRESS> [USDC_AMOUNT]

set -e

cd "$(dirname "$0")"

VAULT_ADDRESS="${1:-}"
AMOUNT="${2:-100000}"

if [ -z "$VAULT_ADDRESS" ]; then
    echo "Usage: ./startup.sh <VAULT_ADDRESS> [USDC_AMOUNT]"
    echo ""
    echo "Example:"
    echo "  ./startup.sh 0x367F7BF37F7E2D6EA3De96D8caDB0c3eAe4C13BE"
    echo "  ./startup.sh 0x367F7BF37F7E2D6EA3De96D8caDB0c3eAe4C13BE 50000"
    exit 1
fi

echo "Setting up LP for vault: $VAULT_ADDRESS"
echo "USDC amount: $AMOUNT"

python3 setup_lp.py "$VAULT_ADDRESS" --amount "$AMOUNT"
