const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/oracle');
const MARKETS_FILE = path.join(DATA_DIR, 'markets.json');
const BETS_FILE = path.join(DATA_DIR, 'bets.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadMarkets() {
  try {
    return JSON.parse(fs.readFileSync(MARKETS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveMarkets(markets) {
  fs.writeFileSync(MARKETS_FILE, JSON.stringify(markets, null, 2));
}

function loadBets() {
  try {
    return JSON.parse(fs.readFileSync(BETS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveBets(bets) {
  fs.writeFileSync(BETS_FILE, JSON.stringify(bets, null, 2));
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const markets = loadMarkets();
  const bets = loadBets();
  res.json({
    status: 'ok',
    service: 'moltoracle',
    markets: markets.length,
    open: markets.filter(m => !m.resolvedAt).length,
    totalBets: bets.length,
    timestamp: new Date().toISOString()
  });
});

// Create market
router.post('/api/markets', (req, res) => {
  const { question, creator, options, resolutionDate, resolutionCriteria } = req.body;
  
  if (!question || !creator || !options || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'question, creator, and at least 2 options are required' });
  }
  
  const markets = loadMarkets();
  const market = {
    id: uuidv4(),
    question,
    creator,
    options: options.map(opt => ({ name: opt, bets: 0, amount: 0 })),
    resolutionDate: resolutionDate || null,
    resolutionCriteria: resolutionCriteria || null,
    resolved: false,
    outcome: null,
    resolvedAt: null,
    createdAt: new Date().toISOString()
  };
  
  markets.push(market);
  saveMarkets(markets);
  res.status(201).json(market);
});

// List markets
router.get('/api/markets', (req, res) => {
  let markets = loadMarkets();
  const { resolved } = req.query;
  
  if (resolved !== undefined) {
    const isResolved = resolved === 'true';
    markets = markets.filter(m => m.resolved === isResolved);
  }
  
  markets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(markets);
});

// Get market details with odds
router.get('/api/markets/:id', (req, res) => {
  const markets = loadMarkets();
  const market = markets.find(m => m.id === req.params.id);
  
  if (!market) {
    return res.status(404).json({ error: 'Market not found' });
  }
  
  const bets = loadBets().filter(b => b.marketId === req.params.id);
  
  // Calculate odds
  const totalAmount = bets.reduce((sum, b) => sum + b.amount, 0);
  const odds = market.options.map(opt => {
    const optionBets = bets.filter(b => b.option === opt.name);
    const optionAmount = optionBets.reduce((sum, b) => sum + b.amount, 0);
    return {
      ...opt,
      bets: optionBets.length,
      amount: optionAmount,
      probability: totalAmount > 0 ? (optionAmount / totalAmount * 100).toFixed(1) : 0,
      odds: optionAmount > 0 ? (totalAmount / optionAmount).toFixed(2) : '∞'
    };
  });
  
  res.json({
    ...market,
    options: odds,
    totalBets: bets.length,
    totalAmount
  });
});

// Place bet
router.post('/api/markets/:id/bet', (req, res) => {
  const { agent, option, amount } = req.body;
  const markets = loadMarkets();
  const market = markets.find(m => m.id === req.params.id);
  
  if (!market) {
    return res.status(404).json({ error: 'Market not found' });
  }
  
  if (market.resolved) {
    return res.status(400).json({ error: 'Market already resolved' });
  }
  
  if (!agent || !option || !amount || amount <= 0) {
    return res.status(400).json({ error: 'agent, option, and positive amount are required' });
  }
  
  if (!market.options.find(o => o.name === option)) {
    return res.status(400).json({ error: 'Invalid option' });
  }
  
  const bets = loadBets();
  const bet = {
    id: uuidv4(),
    marketId: req.params.id,
    agent,
    option,
    amount: parseFloat(amount),
    createdAt: new Date().toISOString()
  };
  
  bets.push(bet);
  saveBets(bets);
  
  res.status(201).json(bet);
});

// Resolve market
router.post('/api/markets/:id/resolve', (req, res) => {
  const { outcome, evidence } = req.body;
  const markets = loadMarkets();
  const market = markets.find(m => m.id === req.params.id);
  
  if (!market) {
    return res.status(404).json({ error: 'Market not found' });
  }
  
  if (market.resolved) {
    return res.status(400).json({ error: 'Market already resolved' });
  }
  
  if (!outcome) {
    return res.status(400).json({ error: 'outcome is required' });
  }
  
  if (!market.options.find(o => o.name === outcome)) {
    return res.status(400).json({ error: 'Invalid outcome' });
  }
  
  market.resolved = true;
  market.outcome = outcome;
  market.evidence = evidence || null;
  market.resolvedAt = new Date().toISOString();
  
  saveMarkets(markets);
  res.json(market);
});

// Get all positions for a market
router.get('/api/markets/:id/positions', (req, res) => {
  const bets = loadBets().filter(b => b.marketId === req.params.id);
  
  const positions = {};
  bets.forEach(bet => {
    if (!positions[bet.agent]) {
      positions[bet.agent] = { agent: bet.agent, bets: [] };
    }
    positions[bet.agent].bets.push({
      option: bet.option,
      amount: bet.amount,
      createdAt: bet.createdAt
    });
  });
  
  res.json(Object.values(positions));
});

// Leaderboard
router.get('/api/leaderboard', (req, res) => {
  const markets = loadMarkets().filter(m => m.resolved);
  const bets = loadBets();
  
  const agentStats = {};
  
  bets.forEach(bet => {
    const market = markets.find(m => m.id === bet.marketId);
    if (!market) return;
    
    if (!agentStats[bet.agent]) {
      agentStats[bet.agent] = {
        agent: bet.agent,
        totalBets: 0,
        correctBets: 0,
        totalStaked: 0,
        totalWon: 0
      };
    }
    
    agentStats[bet.agent].totalBets++;
    agentStats[bet.agent].totalStaked += bet.amount;
    
    if (bet.option === market.outcome) {
      agentStats[bet.agent].correctBets++;
      // Calculate winnings (simplified: proportional to bet amount)
      const marketBets = bets.filter(b => b.marketId === market.id);
      const totalMarketAmount = marketBets.reduce((sum, b) => sum + b.amount, 0);
      const optionAmount = marketBets.filter(b => b.option === bet.option).reduce((sum, b) => sum + b.amount, 0);
      const payout = (bet.amount / optionAmount) * totalMarketAmount;
      agentStats[bet.agent].totalWon += payout;
    }
  });
  
  const leaderboard = Object.values(agentStats)
    .map(agent => ({
      ...agent,
      accuracy: agent.totalBets > 0 ? (agent.correctBets / agent.totalBets * 100).toFixed(1) : 0,
      profit: agent.totalWon - agent.totalStaked,
      roi: agent.totalStaked > 0 ? ((agent.totalWon - agent.totalStaked) / agent.totalStaked * 100).toFixed(1) : 0
    }))
    .sort((a, b) => b.profit - a.profit);
  
  res.json(leaderboard);
});

module.exports = router;
