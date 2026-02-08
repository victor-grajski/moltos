const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/auth');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const KEYS_FILE = path.join(DATA_DIR, 'keys.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper functions
function loadAgents() {
  try {
    return JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveAgents(agents) {
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2));
}

function loadKeys() {
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveKeys(keys) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

function generateApiKey() {
  return 'molt_' + crypto.randomBytes(32).toString('hex');
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'moltauth',
    agents: loadAgents().length,
    activeKeys: loadKeys().filter(k => !k.revokedAt).length,
    timestamp: new Date().toISOString()
  });
});

// Register new agent
router.post('/api/agents', (req, res) => {
  const { name, description, capabilities, services, x402Support, supportedTrust, registrations } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Agent name is required' });
  }
  
  const agents = loadAgents();
  
  // Check if agent already exists
  if (agents.find(a => a.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'Agent already exists' });
  }
  
  const agent = {
    id: uuidv4(),
    name,
    description: description || '',
    capabilities: capabilities || [],
    // ERC-8004 fields
    services: services || [],
    x402Support: x402Support || false,
    supportedTrust: supportedTrust || ['reputation'],
    registrations: registrations || [],
    active: true,
    createdAt: new Date().toISOString(),
    lastActive: null
  };
  
  agents.push(agent);
  saveAgents(agents);
  
  res.status(201).json(agent);
});

// List all agents
router.get('/api/agents', (req, res) => {
  const agents = loadAgents();
  res.json(agents);
});

// Get agent by ID
router.get('/api/agents/:id', (req, res) => {
  const agents = loadAgents();
  const agent = agents.find(a => a.id === req.params.id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Include key count
  const keys = loadKeys().filter(k => k.agentId === agent.id && !k.revokedAt);
  
  res.json({
    ...agent,
    activeKeyCount: keys.length
  });
});

// Generate API key for agent
router.post('/api/agents/:id/keys', (req, res) => {
  const { name } = req.body;
  const agents = loadAgents();
  const agent = agents.find(a => a.id === req.params.id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const keys = loadKeys();
  const apiKey = generateApiKey();
  
  const key = {
    id: uuidv4(),
    agentId: agent.id,
    name: name || 'Default Key',
    key: apiKey,
    createdAt: new Date().toISOString(),
    lastUsed: null,
    revokedAt: null
  };
  
  keys.push(key);
  saveKeys(keys);
  
  res.status(201).json(key);
});

// Revoke API key
router.delete('/api/agents/:id/keys/:keyId', (req, res) => {
  const keys = loadKeys();
  const key = keys.find(k => k.id === req.params.keyId && k.agentId === req.params.id);
  
  if (!key) {
    return res.status(404).json({ error: 'Key not found' });
  }
  
  key.revokedAt = new Date().toISOString();
  saveKeys(keys);
  
  res.json({ success: true, key });
});

// Verify API key
router.post('/api/verify', (req, res) => {
  const { apiKey } = req.body;
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required' });
  }
  
  const keys = loadKeys();
  const key = keys.find(k => k.key === apiKey);
  
  if (!key) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  if (key.revokedAt) {
    return res.status(401).json({ error: 'API key has been revoked' });
  }
  
  // Update last used
  key.lastUsed = new Date().toISOString();
  saveKeys(keys);
  
  // Get agent info
  const agents = loadAgents();
  const agent = agents.find(a => a.id === key.agentId);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Update agent last active
  agent.lastActive = new Date().toISOString();
  saveAgents(agents);
  
  res.json({
    valid: true,
    agent: {
      id: agent.id,
      name: agent.name,
      capabilities: agent.capabilities
    },
    key: {
      id: key.id,
      name: key.name,
      createdAt: key.createdAt
    }
  });
});

// ERC-8004 Compatible Registration File
router.get('/api/agents/:id/registration', (req, res) => {
  const agents = loadAgents();
  const agent = agents.find(a => a.id === req.params.id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Return ERC-8004 compatible registration format
  const registration = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: agent.name,
    description: agent.description || '',
    services: agent.services || [],
    x402Support: agent.x402Support || false,
    active: agent.active !== false,
    registrations: agent.registrations || [],
    supportedTrust: agent.supportedTrust || ['reputation']
  };
  
  res.json(registration);
});

// Get agent feedback (ERC-8004 reputation format)
router.get('/api/agents/:id/feedback', (req, res) => {
  const agents = loadAgents();
  const agent = agents.find(a => a.id === req.params.id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Load feedback data
  const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');
  let feedback = [];
  try {
    feedback = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8'));
  } catch {
    feedback = [];
  }
  
  const agentFeedback = feedback.filter(f => f.agentId === req.params.id);
  
  res.json({
    agentId: agent.id,
    agentName: agent.name,
    feedback: agentFeedback,
    totalFeedback: agentFeedback.length,
    averageValue: agentFeedback.length > 0 
      ? (agentFeedback.reduce((sum, f) => sum + (f.value || 0), 0) / agentFeedback.length).toFixed(2)
      : 0
  });
});

// Submit feedback (ERC-8004 format)
router.post('/api/agents/:id/feedback', (req, res) => {
  const { value, valueDecimals, tag1, tag2, endpoint } = req.body;
  const agentId = req.params.id;
  
  const agents = loadAgents();
  const agent = agents.find(a => a.id === agentId);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  if (value === undefined) {
    return res.status(400).json({ error: 'value is required' });
  }
  
  // Load feedback data
  const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');
  let feedback = [];
  try {
    feedback = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8'));
  } catch {
    feedback = [];
  }
  
  const newFeedback = {
    id: uuidv4(),
    agentId,
    value: parseFloat(value),
    valueDecimals: valueDecimals || 0,
    tag1: tag1 || null,
    tag2: tag2 || null,
    endpoint: endpoint || null,
    submittedAt: new Date().toISOString()
  };
  
  feedback.push(newFeedback);
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedback, null, 2));
  
  res.status(201).json(newFeedback);
});

module.exports = router;
