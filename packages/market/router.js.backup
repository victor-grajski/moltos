const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/market');
const WALLETS_FILE = path.join(DATA_DIR, 'wallets.json');
const TRANSACTIONS_FILE = path.join(DATA_DIR, 'transactions.json');

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

// Mock data generator for graceful degradation
function generateMockTransactions(wallets) {
  const now = Date.now();
  const chains = ['base', 'ethereum', 'optimism', 'arbitrum'];
  const types = ['transfer', 'swap', 'bridge', 'contract'];
  
  return wallets.flatMap(wallet => {
    // Generate 1-3 transactions per wallet
    const count = Math.floor(Math.random() * 3) + 1;
    return Array.from({ length: count }, (_, i) => ({
      id: uuidv4(),
      wallet: wallet.address,
      walletLabel: wallet.label,
      chain: wallet.chain || chains[Math.floor(Math.random() * chains.length)],
      type: types[Math.floor(Math.random() * types.length)],
      amount: (Math.random() * 10).toFixed(4),
      token: ['ETH', 'USDC', 'USDT', 'DAI'][Math.floor(Math.random() * 4)],
      timestamp: new Date(now - Math.random() * 86400000 * 7).toISOString(), // Last 7 days
      hash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      from: '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      to: '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      mock: true
    }));
  });
}

// ============ API ENDPOINTS ============

// Health check
router.get('/health', (req, res) => {
  const wallets = loadWallets();
  const transactions = loadTransactions();
  
  res.json({ 
    status: 'ok', 
    service: 'moltmarket',
    wallets: wallets.length,
    transactions: transactions.length,
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
    
    // Check if wallet already exists
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
    
    // Generate mock transactions for demo purposes
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
    
    // Also remove transactions for this wallet
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
    
    // Sort by timestamp, newest first
    transactions.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
    
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get aggregate stats
router.get('/api/stats', (req, res) => {
  try {
    const wallets = loadWallets();
    const transactions = loadTransactions();
    
    // Calculate total volume
    const totalVolume = transactions.reduce((sum, tx) => 
      sum + parseFloat(tx.amount), 0
    );
    
    // Active wallets (with transactions in last 7 days)
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentTxs = transactions.filter(tx => 
      new Date(tx.timestamp) > weekAgo
    );
    const activeWallets = new Set(recentTxs.map(tx => tx.wallet)).size;
    
    // Trending wallets (most transactions in last 24h)
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
    
    res.json({
      totalVolume: totalVolume.toFixed(4),
      transactionCount: transactions.length,
      activeWallets,
      trackedWallets: wallets.length,
      trendingWallets,
      chainDistribution: chainStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
