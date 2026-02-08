// Wallet Balance Executor
// Watches for wallet balance above/below threshold
// Simplified version using JSON-RPC (no viem dependency for now)

const RPC_ENDPOINTS = {
  base: 'https://mainnet.base.org',
  ethereum: 'https://eth.llamarpc.com',
  optimism: 'https://mainnet.optimism.io',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
};

async function getBalance(address, chain) {
  const rpcUrl = RPC_ENDPOINTS[chain];
  if (!rpcUrl) {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [address, 'latest'],
      id: 1,
    }),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message);
  }

  // Convert hex balance to ETH
  const balanceWei = BigInt(data.result);
  const balanceEth = Number(balanceWei) / 1e18;
  return balanceEth;
}

const walletBalanceExecutor = {
  describe() {
    return {
      id: 'wallet-balance',
      name: 'Wallet Balance Alert',
      category: 'wallet',
      description: 'Get notified when a wallet balance goes above or below a threshold',
      configSchema: {
        type: 'object',
        required: ['address', 'threshold', 'direction'],
        properties: {
          address: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{40}$',
            description: 'Wallet address to watch',
          },
          threshold: {
            type: 'number',
            minimum: 0,
            description: 'Balance threshold in ETH',
          },
          direction: {
            type: 'string',
            enum: ['above', 'below'],
            description: 'Alert when balance goes above or below threshold',
          },
          chain: {
            type: 'string',
            enum: ['base', 'ethereum', 'optimism', 'arbitrum'],
            default: 'base',
            description: 'Which chain to monitor',
          },
        },
      },
    };
  },

  validate(config) {
    const errors = [];
    
    if (!config.address || !config.address.match(/^0x[a-fA-F0-9]{40}$/)) {
      errors.push('Invalid address format');
    }
    if (typeof config.threshold !== 'number' || config.threshold < 0) {
      errors.push('Threshold must be a non-negative number');
    }
    if (!['above', 'below'].includes(config.direction)) {
      errors.push('Direction must be "above" or "below"');
    }
    if (config.chain && !RPC_ENDPOINTS[config.chain]) {
      errors.push(`Unsupported chain: ${config.chain}`);
    }
    
    return { valid: errors.length === 0, errors };
  },

  async check(config) {
    const chain = config.chain || 'base';
    const balanceEth = await getBalance(config.address, chain);
    
    const triggered = config.direction === 'above'
      ? balanceEth > config.threshold
      : balanceEth < config.threshold;

    return {
      triggered,
      data: {
        address: config.address,
        chain,
        balance: balanceEth,
        threshold: config.threshold,
        direction: config.direction,
        condition: `${balanceEth.toFixed(6)} ETH is ${config.direction} ${config.threshold} ETH`,
      },
    };
  },
};

module.exports = walletBalanceExecutor;
