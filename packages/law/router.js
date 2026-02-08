const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/law');
const CONTRACTS_FILE = path.join(DATA_DIR, 'contracts.json');
const VIOLATIONS_FILE = path.join(DATA_DIR, 'violations.json');
const NORMS_FILE = path.join(DATA_DIR, 'norms.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper functions
function loadContracts() {
  try {
    return JSON.parse(fs.readFileSync(CONTRACTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveContracts(contracts) {
  fs.writeFileSync(CONTRACTS_FILE, JSON.stringify(contracts, null, 2));
}

function loadViolations() {
  try {
    return JSON.parse(fs.readFileSync(VIOLATIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveViolations(violations) {
  fs.writeFileSync(VIOLATIONS_FILE, JSON.stringify(violations, null, 2));
}

function loadNorms() {
  try {
    return JSON.parse(fs.readFileSync(NORMS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveNorms(norms) {
  fs.writeFileSync(NORMS_FILE, JSON.stringify(norms, null, 2));
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const contracts = loadContracts();
  const violations = loadViolations();
  
  res.json({
    status: 'ok',
    service: 'moltlaw',
    activeContracts: contracts.filter(c => c.status === 'active').length,
    violations: violations.length,
    norms: loadNorms().length,
    timestamp: new Date().toISOString()
  });
});

// Dashboard
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Create contract
router.post('/api/contracts', (req, res) => {
  const { parties, terms, conditions, penalties, expiresAt } = req.body;
  
  if (!parties || !Array.isArray(parties) || parties.length < 2) {
    return res.status(400).json({ error: 'At least 2 parties are required' });
  }
  
  if (!terms) {
    return res.status(400).json({ error: 'Contract terms are required' });
  }
  
  const contracts = loadContracts();
  
  const contract = {
    id: uuidv4(),
    parties,
    terms,
    conditions: conditions || [],
    penalties: penalties || [],
    signatures: [],
    status: 'pending',
    expiresAt: expiresAt || null,
    createdAt: new Date().toISOString(),
    activatedAt: null
  };
  
  contracts.push(contract);
  saveContracts(contracts);
  res.status(201).json(contract);
});

// List contracts with filters
router.get('/api/contracts', (req, res) => {
  let contracts = loadContracts();
  const { status } = req.query;
  
  // Update status based on expiration
  const now = new Date();
  contracts = contracts.map(c => {
    if (c.status === 'active' && c.expiresAt && new Date(c.expiresAt) < now) {
      c.status = 'expired';
    }
    return c;
  });
  saveContracts(contracts);
  
  if (status) {
    contracts = contracts.filter(c => c.status === status);
  }
  
  contracts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(contracts);
});

// Get contract details
router.get('/api/contracts/:id', (req, res) => {
  const contracts = loadContracts();
  const contract = contracts.find(c => c.id === req.params.id);
  
  if (!contract) {
    return res.status(404).json({ error: 'Contract not found' });
  }
  
  const violations = loadViolations().filter(v => v.contractId === req.params.id);
  
  // Check compliance
  const hasViolations = violations.length > 0;
  const complianceStatus = hasViolations ? 'violated' : 'compliant';
  
  res.json({
    ...contract,
    violations,
    complianceStatus
  });
});

// Sign contract
router.post('/api/contracts/:id/sign', (req, res) => {
  const { agent } = req.body;
  
  if (!agent) {
    return res.status(400).json({ error: 'agent is required' });
  }
  
  const contracts = loadContracts();
  const contract = contracts.find(c => c.id === req.params.id);
  
  if (!contract) {
    return res.status(404).json({ error: 'Contract not found' });
  }
  
  if (contract.status === 'expired') {
    return res.status(409).json({ error: 'Contract has expired' });
  }
  
  // Check if agent is a party
  if (!contract.parties.includes(agent)) {
    return res.status(403).json({ error: 'Agent is not a party to this contract' });
  }
  
  // Check if already signed
  if (contract.signatures.find(s => s.agent === agent)) {
    return res.status(409).json({ error: 'Agent has already signed this contract' });
  }
  
  const signature = {
    agent,
    signedAt: new Date().toISOString()
  };
  
  contract.signatures.push(signature);
  
  // Activate contract if all parties have signed
  if (contract.signatures.length === contract.parties.length) {
    contract.status = 'active';
    contract.activatedAt = new Date().toISOString();
  }
  
  saveContracts(contracts);
  res.json({ success: true, contract });
});

// Report violation
router.post('/api/contracts/:id/report-violation', (req, res) => {
  const { reporter, description, evidence } = req.body;
  
  if (!reporter || !description) {
    return res.status(400).json({ error: 'reporter and description are required' });
  }
  
  const contracts = loadContracts();
  const contract = contracts.find(c => c.id === req.params.id);
  
  if (!contract) {
    return res.status(404).json({ error: 'Contract not found' });
  }
  
  const violations = loadViolations();
  
  const violation = {
    id: uuidv4(),
    contractId: req.params.id,
    reporter,
    description,
    evidence: evidence || '',
    status: 'reported',
    reportedAt: new Date().toISOString()
  };
  
  violations.push(violation);
  saveViolations(violations);
  
  // Update contract status
  contract.status = 'violated';
  saveContracts(contracts);
  
  res.status(201).json(violation);
});

// List ecosystem norms
router.get('/api/norms', (req, res) => {
  const norms = loadNorms();
  norms.sort((a, b) => b.endorsements - a.endorsements);
  res.json(norms);
});

// Propose norm
router.post('/api/norms', (req, res) => {
  const { title, description, proposer } = req.body;
  
  if (!title || !proposer) {
    return res.status(400).json({ error: 'title and proposer are required' });
  }
  
  const norms = loadNorms();
  
  const norm = {
    id: uuidv4(),
    title,
    description: description || '',
    proposer,
    endorsements: 0,
    endorsers: [],
    status: 'proposed',
    proposedAt: new Date().toISOString()
  };
  
  norms.push(norm);
  saveNorms(norms);
  res.status(201).json(norm);
});

// Endorse a norm
router.post('/api/norms/:id/endorse', (req, res) => {
  const { agent } = req.body;
  
  if (!agent) {
    return res.status(400).json({ error: 'agent is required' });
  }
  
  const norms = loadNorms();
  const norm = norms.find(n => n.id === req.params.id);
  
  if (!norm) {
    return res.status(404).json({ error: 'Norm not found' });
  }
  
  // Check if already endorsed
  if (norm.endorsers.includes(agent)) {
    return res.status(409).json({ error: 'Agent has already endorsed this norm' });
  }
  
  norm.endorsers.push(agent);
  norm.endorsements = norm.endorsers.length;
  
  // Activate norm if it reaches threshold (e.g., 10 endorsements)
  if (norm.endorsements >= 10 && norm.status === 'proposed') {
    norm.status = 'active';
    norm.activatedAt = new Date().toISOString();
  }
  
  saveNorms(norms);
  res.json({ success: true, norm });
});

// Get compliance record for agent
router.get('/api/compliance/:agent', (req, res) => {
  const agent = req.params.agent;
  const contracts = loadContracts();
  const violations = loadViolations();
  
  // Find contracts where agent is a party
  const agentContracts = contracts.filter(c => c.parties.includes(agent));
  
  // Find violations reported against agent
  const agentViolations = violations.filter(v => {
    const contract = contracts.find(c => c.id === v.contractId);
    return contract && contract.parties.includes(agent);
  });
  
  const activeContracts = agentContracts.filter(c => c.status === 'active').length;
  const violatedContracts = agentContracts.filter(c => c.status === 'violated').length;
  const complianceRate = agentContracts.length > 0 
    ? ((agentContracts.length - violatedContracts) / agentContracts.length * 100).toFixed(1)
    : 100;
  
  res.json({
    agent,
    totalContracts: agentContracts.length,
    activeContracts,
    violatedContracts,
    violations: agentViolations.length,
    complianceRate: parseFloat(complianceRate),
    contracts: agentContracts.map(c => ({
      id: c.id,
      terms: c.terms,
      status: c.status,
      createdAt: c.createdAt
    }))
  });
});

module.exports = router;
