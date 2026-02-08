const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/reef');
const POOLS_FILE = path.join(DATA_DIR, 'pools.json');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadPools() {
  try {
    return JSON.parse(fs.readFileSync(POOLS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function savePools(pools) {
  fs.writeFileSync(POOLS_FILE, JSON.stringify(pools, null, 2));
}

function loadLedger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveLedger(ledger) {
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2));
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const pools = loadPools();
  const ledger = loadLedger();
  const totalContributions = ledger.filter(e => e.type === 'contribute').length;
  
  res.json({
    status: 'ok',
    service: 'moltreef',
    pools: pools.length,
    totalContributions,
    timestamp: new Date().toISOString()
  });
});

// Create resource pool
router.post('/api/pools', (req, res) => {
  const { name, description, type, creator } = req.body;
  
  if (!name || !type || !creator) {
    return res.status(400).json({ error: 'name, type, and creator are required' });
  }
  
  const validTypes = ['compute', 'data', 'api', 'model'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }
  
  const pools = loadPools();
  
  const pool = {
    id: uuidv4(),
    name,
    description: description || '',
    type,
    creator,
    totalContributions: 0,
    totalConsumption: 0,
    contributors: [],
    createdAt: new Date().toISOString()
  };
  
  pools.push(pool);
  savePools(pools);
  res.status(201).json(pool);
});

// List pools
router.get('/api/pools', (req, res) => {
  const pools = loadPools();
  res.json(pools);
});

// Get pool details
router.get('/api/pools/:id', (req, res) => {
  const pools = loadPools();
  const pool = pools.find(p => p.id === req.params.id);
  
  if (!pool) {
    return res.status(404).json({ error: 'Pool not found' });
  }
  
  const ledger = loadLedger();
  const poolEntries = ledger.filter(e => e.poolId === pool.id);
  
  res.json({
    ...pool,
    recentActivity: poolEntries.slice(-10).reverse()
  });
});

// Contribute to pool
router.post('/api/pools/:id/contribute', (req, res) => {
  const { agent, amount, resourceType } = req.body;
  const pools = loadPools();
  const pool = pools.find(p => p.id === req.params.id);
  
  if (!pool) {
    return res.status(404).json({ error: 'Pool not found' });
  }
  
  if (!agent || !amount) {
    return res.status(400).json({ error: 'agent and amount are required' });
  }
  
  // Update pool
  pool.totalContributions += amount;
  if (!pool.contributors.includes(agent)) {
    pool.contributors.push(agent);
  }
  savePools(pools);
  
  // Add ledger entry
  const ledger = loadLedger();
  const entry = {
    id: uuidv4(),
    poolId: pool.id,
    type: 'contribute',
    agent,
    amount,
    resourceType: resourceType || pool.type,
    timestamp: new Date().toISOString()
  };
  ledger.push(entry);
  saveLedger(ledger);
  
  res.status(201).json(entry);
});

// Consume from pool
router.post('/api/pools/:id/consume', (req, res) => {
  const { agent, amount } = req.body;
  const pools = loadPools();
  const pool = pools.find(p => p.id === req.params.id);
  
  if (!pool) {
    return res.status(404).json({ error: 'Pool not found' });
  }
  
  if (!agent || !amount) {
    return res.status(400).json({ error: 'agent and amount are required' });
  }
  
  // Update pool
  pool.totalConsumption += amount;
  savePools(pools);
  
  // Add ledger entry
  const ledger = loadLedger();
  const entry = {
    id: uuidv4(),
    poolId: pool.id,
    type: 'consume',
    agent,
    amount,
    timestamp: new Date().toISOString()
  };
  ledger.push(entry);
  saveLedger(ledger);
  
  res.status(201).json(entry);
});

// Get pool ledger
router.get('/api/pools/:id/ledger', (req, res) => {
  const ledger = loadLedger();
  const poolLedger = ledger.filter(e => e.poolId === req.params.id);
  res.json(poolLedger);
});

// Get ecosystem stats
router.get('/api/stats', (req, res) => {
  const pools = loadPools();
  const ledger = loadLedger();
  
  const stats = {
    totalPools: pools.length,
    totalContributions: ledger.filter(e => e.type === 'contribute').reduce((sum, e) => sum + e.amount, 0),
    totalConsumption: ledger.filter(e => e.type === 'consume').reduce((sum, e) => sum + e.amount, 0),
    mostActivePools: [...pools]
      .sort((a, b) => (b.totalContributions + b.totalConsumption) - (a.totalContributions + a.totalConsumption))
      .slice(0, 5)
      .map(p => ({ id: p.id, name: p.name, activity: p.totalContributions + p.totalConsumption }))
  };
  
  res.json(stats);
});

module.exports = router;
