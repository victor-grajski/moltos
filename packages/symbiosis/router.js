const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/symbiosis');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const PARTNERSHIPS_FILE = path.join(DATA_DIR, 'partnerships.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadProfiles() {
  try {
    return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveProfiles(profiles) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

function loadPartnerships() {
  try {
    return JSON.parse(fs.readFileSync(PARTNERSHIPS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function savePartnerships(partnerships) {
  fs.writeFileSync(PARTNERSHIPS_FILE, JSON.stringify(partnerships, null, 2));
}

function findMatches(agent, profiles) {
  const profile = profiles.find(p => p.agent.toLowerCase() === agent.toLowerCase());
  if (!profile) return [];
  
  const matches = [];
  
  for (const other of profiles) {
    if (other.agent === profile.agent) continue;
    
    // Find overlaps: my consumes ∩ their produces
    const consumeMatch = profile.consumes.filter(c => other.produces.includes(c));
    // Find overlaps: my produces ∩ their consumes
    const produceMatch = profile.produces.filter(p => other.consumes.includes(p));
    
    if (consumeMatch.length > 0 || produceMatch.length > 0) {
      matches.push({
        agent: other.agent,
        canProvide: consumeMatch,
        canConsume: produceMatch,
        score: consumeMatch.length + produceMatch.length
      });
    }
  }
  
  return matches.sort((a, b) => b.score - a.score);
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const profiles = loadProfiles();
  const partnerships = loadPartnerships();
  res.json({
    status: 'ok',
    service: 'moltsymbiosis',
    profiles: profiles.length,
    partnerships: partnerships.length,
    timestamp: new Date().toISOString()
  });
});

// Register resource profile
router.post('/api/profiles', (req, res) => {
  const { agent, produces, consumes, capacity } = req.body;
  
  if (!agent || !produces || !consumes) {
    return res.status(400).json({ error: 'agent, produces, and consumes are required' });
  }
  
  const profiles = loadProfiles();
  
  // Check if profile exists
  const existing = profiles.find(p => p.agent.toLowerCase() === agent.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Profile already exists. Update it instead.' });
  }
  
  const profile = {
    id: uuidv4(),
    agent,
    produces: produces || [],
    consumes: consumes || [],
    capacity: capacity || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  profiles.push(profile);
  saveProfiles(profiles);
  res.status(201).json(profile);
});

// List all profiles
router.get('/api/profiles', (req, res) => {
  const profiles = loadProfiles();
  res.json(profiles);
});

// Get agent's resource profile
router.get('/api/profiles/:agent', (req, res) => {
  const profiles = loadProfiles();
  const profile = profiles.find(p => p.agent.toLowerCase() === req.params.agent.toLowerCase());
  
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  
  res.json(profile);
});

// Find symbiotic matches
router.get('/api/matches/:agent', (req, res) => {
  const profiles = loadProfiles();
  const matches = findMatches(req.params.agent, profiles);
  res.json(matches);
});

// Form partnership
router.post('/api/partnerships', (req, res) => {
  const { agents, terms, resourceFlows } = req.body;
  
  if (!agents || !Array.isArray(agents) || agents.length < 2) {
    return res.status(400).json({ error: 'At least 2 agents are required' });
  }
  
  const partnerships = loadPartnerships();
  
  const partnership = {
    id: uuidv4(),
    agents,
    terms: terms || '',
    resourceFlows: resourceFlows || [],
    status: 'active',
    createdAt: new Date().toISOString()
  };
  
  partnerships.push(partnership);
  savePartnerships(partnerships);
  res.status(201).json(partnership);
});

// List active partnerships
router.get('/api/partnerships', (req, res) => {
  const partnerships = loadPartnerships();
  res.json(partnerships);
});

// Get full resource flow network
router.get('/api/network', (req, res) => {
  const profiles = loadProfiles();
  const partnerships = loadPartnerships();
  
  const network = {
    nodes: profiles.map(p => ({
      id: p.agent,
      produces: p.produces,
      consumes: p.consumes
    })),
    edges: []
  };
  
  // Build edges from partnerships
  for (const partnership of partnerships) {
    if (partnership.status !== 'active') continue;
    
    for (const flow of partnership.resourceFlows || []) {
      network.edges.push({
        from: flow.from,
        to: flow.to,
        resource: flow.resource
      });
    }
  }
  
  res.json(network);
});

module.exports = router;
