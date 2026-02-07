"""
LP Setup Script - Minestarters
One-time setup: Deposit, create pool, register, and add liquidity for a vault.

Usage:
    python setup_lp.py <VAULT_ADDRESS> [--amount <USDC_AMOUNT>]

Example:
    python setup_lp.py 0x1045Bc201BB00D2A8E765bb94EFe7ECc6C950617 --amount 100000
"""

import argparse
import os
import pathlib
from web3 import Web3
from web3.middleware import geth_poa_middleware
from eth_account import Account
from dotenv import load_dotenv

# Force load .env from this directory
env_path = pathlib.Path(__file__).parent / '.env'
load_dotenv(env_path, override=True)

RPC_URL = os.getenv("RPC_URL", "http://localhost:8545")
PRIVATE_KEY = os.getenv("PRIVATE_KEY")

# Contract addresses
FACTORY_ADDRESS = os.getenv("FACTORY_ADDRESS")
DISTRIBUTOR_ADDRESS = os.getenv("DISTRIBUTOR_ADDRESS")
POOL_MANAGER_ADDRESS = os.getenv("POOL_MANAGER_ADDRESS")
NAV_ENGINE_ADDRESS = os.getenv("NAV_ENGINE_ADDRESS")
USDC_ADDRESS = os.getenv("USDC_ADDRESS")

# LP Configuration
LP_ALLOCATION_BPS = 5000  # 50%
DEFAULT_TICK_SPREAD = 1000
POOL_FEE = 3000
TICK_SPACING = 60
DEFAULT_NAV = 10000  # $0.01 fallback

# ABIs
ERC20_ABI = [
    {"inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
        "name": "approve", "outputs": [{"type": "bool"}], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "to", "type": "address"}, {"name": "amount", "type": "uint256"}],
        "name": "transfer", "outputs": [{"type": "bool"}], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "account", "type": "address"}], "name": "balanceOf", "outputs": [
        {"type": "uint256"}], "stateMutability": "view", "type": "function"},
]

NAV_ENGINE_ABI = [
    {"inputs": [{"name": "vault", "type": "address"}], "name": "getCurrentNAV", "outputs": [
        {"type": "uint256"}], "stateMutability": "view", "type": "function"},
]


POOL_MANAGER_ABI = [
    {"inputs": [{"name": "key", "type": "tuple", "components": [{"name": "currency0", "type": "address"}, {"name": "currency1", "type": "address"}, {"name": "fee", "type": "uint24"}, {"name": "tickSpacing", "type": "int24"}, {
        "name": "hooks", "type": "address"}]}, {"name": "sqrtPriceX96", "type": "uint160"}], "name": "initialize", "outputs": [{"type": "int24"}], "stateMutability": "nonpayable", "type": "function"},
]

VAULT_ABI = [
    {"inputs": [{"name": "amount", "type": "uint256"}, {"name": "minShares", "type": "uint256"}],
        "name": "deposit", "outputs": [{"type": "uint256"}], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "shareToken", "outputs": [{"type": "address"}],
        "stateMutability": "view", "type": "function"},
]
