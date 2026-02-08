// MoltMarket - Unified on-chain intelligence layer
// Combines wallet tracking analytics + wallet monitoring webhooks (x402-sentinel)
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Wallet monitoring components (from x402-sentinel)
const store = require('./store');
const billing = require('./billing');
const { getExecutor } = require('./executors');
const { 
  PLATFORM_FEE, 
  OPERATOR_SHARE, 
  POLLING_INTERVALS, 
  TTL_OPTIONS, 
  MAX_RETRIES_LIMIT, 
  DEFAULT_POLLING,
  FREE_TIER,
  SLA_CONFIG,
  MONITORING_ALIASES 
} = require('./models');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/market');
const WALLETS_FILE = path.join(DATA_DIR, 'wallets.json');
const TRANSACTIONS_FILE = path.join(DATA_DIR, 'transactions.json');

// Platform wallet (receives 20% fee)
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || process.env.WALLET_ADDRESS || '0x1468B3fa064b44bA184aB34FD9CD9eB34E43f197';

// ============================================
// PART 1: EXISTING MOLTMARKET (WALLET TRACKING & ANALYTICS)
// ============================================

// Ensure data files exist
function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(WALLETS_FILE)) {
    fs.writeFileSync(WALLETS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(TRANSACTIONS_FILE)) {
    fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify([], null, 2));
  }
}

function loadWallets() {
  ensureDataFiles();
  try {
    return JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveWallets(wallets) {
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2));
}

function loadTransactions() {
  ensureDataFiles();
  try {
    return JSON.parse(fs.readFileSync(TRANSACTIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveTransactions(transactions) {
  fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(transactions, null, 2));
}

// Mock data generator
function generateMockTransactions(wallets) {
  const now = Date.now();
  const chains = ['base', 'ethereum', 'optimism', 'arbitrum'];
  const types = ['transfer', 'swap', 'bridge', 'contract'];
  
  return wallets.flatMap(wallet => {
    const count = Math.floor(Math.random() * 3) + 1;
    return Array.from({ length: count }, (_, i) => ({
      id: uuidv4(),
      wallet: wallet.address,
      walletLabel: wallet.label,
      chain: wallet.chain || chains[Math.floor(Math.random() * chains.length)],
      type: types[Math.floor(Math.random() * types.length)],
      amount: (Math.random() * 10).toFixed(4),
      token: ['ETH', 'USDC', 'USDT', 'DAI'][Math.floor(Math.random() * 4)],
      timestamp: new Date(now - Math.random() * 86400000 * 7).toISOString(),
      hash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      from: '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      to: '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      mock: true
    }));
  });
}

// Health check
router.get('/health', async (req, res) => {
  const wallets = loadWallets();
  const transactions = loadTransactions();
  const watchers = await store.getWatchers();
  
  res.json({ 
    status: 'ok', 
    service: 'moltmarket',
    features: ['wallet-tracking', 'wallet-monitoring', 'webhooks', 'sla'],
    wallets: wallets.length,
    transactions: transactions.length,
    activeWatchers: watchers.filter(w => w.status === 'active').length,
    timestamp: new Date().toISOString() 
  });
});

// Serve dashboard
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all tracked wallets
router.get('/api/wallets', (req, res) => {
  try {
    const wallets = loadWallets();
    res.json(wallets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add wallet to track
router.post('/api/wallets', (req, res) => {
  try {
    const { address, label, chain } = req.body;
    
    if (!address || !label) {
      return res.status(400).json({ error: 'address and label are required' });
    }
    
    const wallets = loadWallets();
    
    if (wallets.find(w => w.address.toLowerCase() === address.toLowerCase())) {
      return res.status(409).json({ error: 'Wallet already tracked' });
    }
    
    const wallet = {
      id: uuidv4(),
      address: address.toLowerCase(),
      label,
      chain: chain || 'base',
      balance: '0',
      addedAt: new Date().toISOString(),
      lastChecked: null
    };
    
    wallets.push(wallet);
    saveWallets(wallets);
    
    const existingTxs = loadTransactions();
    const mockTxs = generateMockTransactions([wallet]);
    saveTransactions([...existingTxs, ...mockTxs]);
    
    res.status(201).json(wallet);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove wallet
router.delete('/api/wallets/:address', (req, res) => {
  try {
    let wallets = loadWallets();
    const address = req.params.address.toLowerCase();
    const index = wallets.findIndex(w => w.address === address);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    
    wallets.splice(index, 1);
    saveWallets(wallets);
    
    let transactions = loadTransactions();
    transactions = transactions.filter(tx => tx.wallet !== address);
    saveTransactions(transactions);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get transactions with filters
router.get('/api/transactions', (req, res) => {
  try {
    let transactions = loadTransactions();
    const { wallet, chain, minAmount } = req.query;
    
    if (wallet) {
      transactions = transactions.filter(tx => 
        tx.wallet.toLowerCase() === wallet.toLowerCase()
      );
    }
    
    if (chain) {
      transactions = transactions.filter(tx => tx.chain === chain);
    }
    
    if (minAmount) {
      const min = parseFloat(minAmount);
      transactions = transactions.filter(tx => parseFloat(tx.amount) >= min);
    }
    
    transactions.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
    
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get aggregate stats
router.get('/api/stats', async (req, res) => {
  try {
    const wallets = loadWallets();
    const transactions = loadTransactions();
    const watchers = await store.getWatchers();
    const payments = await store.getPayments();
    
    // Transaction volume
    const totalVolume = transactions.reduce((sum, tx) => 
      sum + parseFloat(tx.amount), 0
    );
    
    // Active wallets
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentTxs = transactions.filter(tx => 
      new Date(tx.timestamp) > weekAgo
    );
    const activeWallets = new Set(recentTxs.map(tx => tx.wallet)).size;
    
    // Trending wallets
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentDayTxs = transactions.filter(tx => 
      new Date(tx.timestamp) > dayAgo
    );
    const walletActivity = {};
    recentDayTxs.forEach(tx => {
      walletActivity[tx.wallet] = (walletActivity[tx.wallet] || 0) + 1;
    });
    const trendingWallets = Object.entries(walletActivity)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([address, count]) => {
        const wallet = wallets.find(w => w.address === address);
        return {
          address,
          label: wallet?.label || 'Unknown',
          transactionCount: count
        };
      });
    
    // Chain distribution
    const chainStats = {};
    transactions.forEach(tx => {
      chainStats[tx.chain] = (chainStats[tx.chain] || 0) + 1;
    });
    
    // Watcher stats
    const activeWatcherCount = watchers.filter(w => w.status === 'active').length;
    const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
    
    res.json({
      // Analytics (existing)
      totalVolume: totalVolume.toFixed(4),
      transactionCount: transactions.length,
      activeWallets,
      trackedWallets: wallets.length,
      trendingWallets,
      chainDistribution: chainStats,
      
      // Monitoring (new)
      activeWatchers: activeWatcherCount,
      totalWatchers: watchers.length,
      totalMonitoringRevenue: `$${totalRevenue.toFixed(4)}`,
      
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PART 2: WALLET MONITORING (x402-sentinel features)
// ============================================

// Auto-seed marketplace if empty
async function autoSeed() {
  const operators = await store.getOperators();
  if (operators.length > 0) return;
  
  console.log('🌱 Auto-seeding marketplace...');
  
  const operator = await store.createOperator({
    name: 'SparkOC',
    wallet: PLATFORM_WALLET,
    description: 'Platform operator. Built-in watchers for wallet balances and token prices.',
    website: 'https://moltos.ai',
  });
  
  await store.createWatcherType({
    operatorId: operator.id,
    name: 'Wallet Balance Alert',
    category: 'wallet',
    description: 'Get notified when a wallet balance goes above or below a threshold.',
    price: 0.01,
    executorId: 'wallet-balance',
  });
  
  await store.createWatcherType({
    operatorId: operator.id,
    name: 'Token Price Alert',
    category: 'price',
    description: 'Get notified when a token price crosses a threshold.',
    price: 0.01,
    executorId: 'token-price',
  });
  
  console.log('✅ Marketplace seeded');
}

// Initialize on first load
autoSeed().catch(err => console.error('Auto-seed failed:', err));

// Get monitoring aliases
router.get('/api/monitoring/aliases', (req, res) => {
  res.json({
    aliases: MONITORING_ALIASES,
    description: 'Preset monitoring intervals for common use cases'
  });
});

// Create watcher with alias support
router.post('/api/monitoring/watchers', async (req, res) => {
  try {
    const { 
      typeId, 
      config, 
      webhook, 
      customerId: rawCustomerId,
      alias, // fast/normal/slow/whale
      billingCycle = 'one-time',
      pollingInterval: rawPollingInterval,
      ttl = DEFAULT_POLLING.ttl,
      retryPolicy = DEFAULT_POLLING.retryPolicy
    } = req.body;
    const customerId = rawCustomerId || req.headers['x-customer-id'] || 'anonymous';
    
    // Apply alias if provided
    let pollingInterval = rawPollingInterval;
    let finalTTL = ttl;
    
    if (alias && MONITORING_ALIASES[alias]) {
      const aliasConfig = MONITORING_ALIASES[alias];
      pollingInterval = aliasConfig.pollingInterval;
      if (aliasConfig.ttl !== undefined) {
        finalTTL = aliasConfig.ttl;
      }
    }
    
    // Use the sentinel watcher creation logic
    const result = await createSingleWatcher({
      typeId,
      config,
      webhook,
      customerId,
      billingCycle,
      pollingInterval: pollingInterval || DEFAULT_POLLING.pollingInterval,
      ttl: finalTTL,
      retryPolicy
    });
    
    if (result.idempotent) {
      return res.status(200).json({
        ...result,
        message: 'Returning existing watcher (idempotent request)',
      });
    }
    
    res.status(201).json({
      ...result,
      message: `Watcher created with ${alias || 'custom'} monitoring.`,
    });
  } catch (error) {
    console.error('Error creating watcher:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to create a single watcher
async function createSingleWatcher(config) {
  const { 
    typeId, 
    config: watcherConfig, 
    webhook, 
    customerId,
    billingCycle = 'one-time',
    pollingInterval,
    ttl = DEFAULT_POLLING.ttl,
    retryPolicy = DEFAULT_POLLING.retryPolicy
  } = config;
  
  // Validate polling configuration
  if (pollingInterval && !POLLING_INTERVALS.includes(pollingInterval)) {
    throw new Error(`Invalid pollingInterval. Allowed: ${POLLING_INTERVALS.join(', ')}`);
  }
  
  if (ttl !== null && !TTL_OPTIONS.slice(0, -1).includes(ttl)) {
    throw new Error(`Invalid ttl. Allowed: ${TTL_OPTIONS.join(', ')}`);
  }
  
  // Idempotency check
  const fulfillmentHash = store.generateFulfillmentHash({ 
    typeId, config: watcherConfig, webhook, customerId 
  });
  
  const existingReceipt = await store.getReceiptByHash(fulfillmentHash);
  if (existingReceipt) {
    const existingWatcher = await store.getWatcher(existingReceipt.watcherId);
    return {
      success: true,
      idempotent: true,
      watcher: existingWatcher ? {
        id: existingWatcher.id,
        typeId: existingWatcher.typeId,
        status: existingWatcher.status,
      } : { id: existingReceipt.watcherId },
      receipt: existingReceipt
    };
  }
  
  // Customer management
  let customer = await store.getCustomer(customerId);
  if (!customer) {
    customer = await store.createCustomer({ id: customerId, tier: 'free' });
  }
  
  // Get watcher type
  const type = await store.getWatcherType(typeId);
  if (!type) {
    throw new Error('Watcher type not found');
  }
  
  // Free tier check
  if (customer.tier === 'free' && customer.freeWatchersUsed >= FREE_TIER.MAX_WATCHERS) {
    throw new Error(`Free tier limit exceeded: ${customer.freeWatchersUsed}/${FREE_TIER.MAX_WATCHERS} watchers used`);
  }
  
  // Get operator
  const operator = await store.getOperator(type.operatorId);
  if (!operator) {
    throw new Error('Operator not found');
  }
  
  // Validate webhook
  if (!webhook || !webhook.startsWith('http')) {
    throw new Error('Valid webhook URL required');
  }

  // Validate billing cycle
  if (!['one-time', 'weekly', 'monthly'].includes(billingCycle)) {
    throw new Error('billingCycle must be "one-time", "weekly", or "monthly"');
  }

  // Calculate next billing date
  let nextBillingAt = null;
  if (billingCycle !== 'one-time') {
    const now = new Date();
    if (billingCycle === 'weekly') {
      nextBillingAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (billingCycle === 'monthly') {
      const nextMonth = new Date(now);
      nextMonth.setMonth(now.getMonth() + 1);
      nextBillingAt = nextMonth.toISOString();
    }
  }
  
  // Validate config
  if (type.executorId) {
    const executor = getExecutor(type.executorId);
    if (executor?.validate) {
      const validation = executor.validate(watcherConfig);
      if (!validation.valid) {
        throw new Error(`Invalid config: ${validation.errors.join(', ')}`);
      }
    }
  }
  
  // Create watcher
  const watcher = await store.createWatcher({
    typeId,
    operatorId: type.operatorId,
    customerId,
    config: watcherConfig,
    webhook,
    billingCycle,
    nextBillingAt,
    pollingInterval: pollingInterval || DEFAULT_POLLING.pollingInterval,
    ttl,
    retryPolicy,
  });
  
  // Record payment
  const network = process.env.NETWORK || 'eip155:8453';
  const payment = await store.createPayment({
    watcherId: watcher.id,
    operatorId: type.operatorId,
    customerId: watcher.customerId,
    amount: type.price,
    operatorShare: type.price * OPERATOR_SHARE,
    platformShare: type.price * PLATFORM_FEE,
    network,
  });
  
  // Create receipt
  const receipt = await store.createReceipt({
    watcherId: watcher.id,
    typeId: type.id,
    amount: type.price,
    chain: network,
    rail: 'x402',
    fulfillmentHash,
    customerId: watcher.customerId,
    operatorId: type.operatorId,
    paymentId: payment.id,
  });
  
  // Update stats
  await store.incrementOperatorStats(type.operatorId, 'watchersCreated');
  await store.incrementWatcherTypeStats(typeId, 'instances');
  
  return {
    success: true,
    idempotent: false,
    watcher: {
      id: watcher.id,
      typeId: watcher.typeId,
      status: watcher.status,
    },
    receipt,
    payment: {
      amount: payment.amount,
      operatorShare: payment.operatorShare,
      platformShare: payment.platformShare,
    }
  };
}

// List available watcher types
router.get('/api/monitoring/types', async (req, res) => {
  try {
    const types = await store.getWatcherTypes({ status: 'active' });
    res.json({
      types: types.map(t => ({
        id: t.id,
        name: t.name,
        category: t.category,
        description: t.description,
        price: t.price,
        executorId: t.executorId,
        stats: t.stats
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get watcher status
router.get('/api/monitoring/watchers/:id', async (req, res) => {
  try {
    const watcher = await store.getWatcher(req.params.id);
    if (!watcher) {
      return res.status(404).json({ error: 'Watcher not found' });
    }
    
    res.json({
      id: watcher.id,
      typeId: watcher.typeId,
      status: watcher.status,
      createdAt: watcher.createdAt,
      lastChecked: watcher.lastChecked,
      lastTriggered: watcher.lastTriggered,
      triggerCount: watcher.triggerCount,
      pollingInterval: watcher.pollingInterval,
      sla: watcher.sla,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel watcher
router.delete('/api/monitoring/watchers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const watcher = await store.getWatcher(id);
    if (!watcher) {
      return res.status(404).json({ error: 'Watcher not found' });
    }
    
    if (watcher.status === 'cancelled') {
      return res.status(400).json({ error: 'Watcher is already cancelled' });
    }
    
    const updatedWatcher = await store.updateWatcher(id, {
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancellationReason: reason || null,
      nextBillingAt: null,
    });
    
    res.json({
      success: true,
      watcher: {
        id: updatedWatcher.id,
        status: updatedWatcher.status,
        cancelledAt: updatedWatcher.cancelledAt,
      },
      message: 'Watcher cancelled successfully',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cron endpoint - check all active watchers
router.post('/api/monitoring/cron/check', async (req, res) => {
  const results = { checked: 0, triggered: 0, errors: 0, skipped: 0 };
  const startTime = Date.now();
  
  try {
    const watchers = await store.getWatchers({ status: 'active' });
    
    for (const watcher of watchers) {
      try {
        const type = await store.getWatcherType(watcher.typeId);
        if (!type || !type.executorId) {
          results.skipped++;
          continue;
        }
        
        const executor = getExecutor(type.executorId);
        if (!executor) {
          results.skipped++;
          continue;
        }
        
        results.checked++;
        
        const result = await executor.check(watcher.config);
        
        await store.updateWatcher(watcher.id, {
          lastChecked: new Date().toISOString(),
          lastCheckResult: result.data,
          lastCheckSuccess: true,
          consecutiveFailures: 0,
        });
        
        if (result.triggered) {
          // Fire webhook
          try {
            await fetch(watcher.webhook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'watcher_triggered',
                watcher: {
                  id: watcher.id,
                  typeId: watcher.typeId,
                },
                data: result.data,
                timestamp: new Date().toISOString(),
                source: 'moltos-market',
              }),
            });
            
            await store.updateWatcher(watcher.id, {
              lastTriggered: new Date().toISOString(),
              triggerCount: watcher.triggerCount + 1,
            });
            
            results.triggered++;
          } catch (webhookError) {
            console.error(`Webhook failed for ${watcher.id}:`, webhookError.message);
            results.errors++;
          }
        }
      } catch (e) {
        console.error(`Error checking watcher ${watcher.id}:`, e.message);
        results.errors++;
        
        await store.updateWatcher(watcher.id, {
          lastChecked: new Date().toISOString(),
          lastCheckSuccess: false,
          consecutiveFailures: (watcher.consecutiveFailures || 0) + 1,
        });
      }
    }
    
    res.json({
      success: true,
      ...results,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron check error:', error);
    res.status(500).json({ error: 'Cron check failed', ...results });
  }
});

module.exports = router;
