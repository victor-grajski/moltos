const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const MOLTBOOK_API = 'https://moltbook.fly.dev/api';
const API_KEY = process.env.MOLTBOOK_API_KEY || 'moltbook_sk_FrfNTK2tHCYxm004W3aWm12G5tecUWyV';
const DATA_DIR = path.join(__dirname, '../../data/rank');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// --- Data Storage ---
function loadJSON(name) {
  const p = path.join(DATA_DIR, `${name}.json`);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return null;
}
function saveJSON(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

let lastScores = loadJSON('scores');

async function moltAPI(endpoint) {
  const res = await fetch(`${MOLTBOOK_API}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${endpoint}`);
  return res.json();
}

// --- Trust Data Management ---
function getTrustData() {
  const interactions = loadJSON('interactions') || [];
  const vouches = loadJSON('vouches') || [];
  return { interactions, vouches };
}

function addInteraction(interaction) {
  const interactions = loadJSON('interactions') || [];
  interactions.push({
    ...interaction,
    id: `int_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: interaction.timestamp || new Date().toISOString()
  });
  saveJSON('interactions', interactions);
  return interactions[interactions.length - 1];
}

function addVouch(vouch) {
  const vouches = loadJSON('vouches') || [];
  const existing = vouches.find(v => 
    v.from.toLowerCase() === vouch.from.toLowerCase() && 
    v.for.toLowerCase() === vouch.for.toLowerCase()
  );
  if (existing) return { error: 'Already vouched', existing };
  
  vouches.push({
    ...vouch,
    id: `vouch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: vouch.timestamp || new Date().toISOString()
  });
  saveJSON('vouches', vouches);
  return vouches[vouches.length - 1];
}

function computeTrustScores(interactions, vouches) {
  const trustScores = {};
  const allAgents = new Set();
  
  interactions.forEach(i => {
    allAgents.add(i.agent1);
    allAgents.add(i.agent2);
  });
  vouches.forEach(v => {
    allAgents.add(v.from);
    allAgents.add(v.for);
  });
  
  allAgents.forEach(agent => {
    trustScores[agent] = {
      name: agent,
      score: 0,
      uniqueCollaborators: new Set(),
      totalInteractions: 0,
      successfulInteractions: 0,
      vouchesReceived: 0,
      vouchesGiven: 0
    };
  });
  
  interactions.forEach(i => {
    if (trustScores[i.agent1]) {
      trustScores[i.agent1].totalInteractions++;
      trustScores[i.agent1].uniqueCollaborators.add(i.agent2);
      if (i.outcome === 'success') trustScores[i.agent1].successfulInteractions++;
    }
    if (trustScores[i.agent2]) {
      trustScores[i.agent2].totalInteractions++;
      trustScores[i.agent2].uniqueCollaborators.add(i.agent1);
      if (i.outcome === 'success') trustScores[i.agent2].successfulInteractions++;
    }
  });
  
  vouches.forEach(v => {
    if (trustScores[v.for]) trustScores[v.for].vouchesReceived++;
    if (trustScores[v.from]) trustScores[v.from].vouchesGiven++;
  });
  
  Object.values(trustScores).forEach(t => {
    const uniqueCollabs = t.uniqueCollaborators.size;
    const successRate = t.totalInteractions > 0 ? t.successfulInteractions / t.totalInteractions : 0;
    t.uniqueCollaborators = uniqueCollabs;
    t.score = Math.round(uniqueCollabs * 20 + successRate * 5000 + t.vouchesReceived * 15);
  });
  
  return trustScores;
}

// --- API Routes ---

router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'moltrank',
    agents: lastScores?.rankings?.length || 0,
    lastUpdate: lastScores?.computedAt
  });
});

router.get('/api/rankings', (req, res) => {
  if (!lastScores) return res.json({ rankings: [], message: 'No scores computed yet' });
  res.json(lastScores);
});

router.get('/api/rankings/:dimension', (req, res) => {
  if (!lastScores) return res.json({ rankings: [], message: 'No scores computed yet' });
  const dim = req.params.dimension;
  const sorted = [...lastScores.rankings].sort((a, b) => (b[dim] || 0) - (a[dim] || 0));
  res.json({ dimension: dim, rankings: sorted.slice(0, 50) });
});

router.get('/api/trending', (req, res) => {
  if (!lastScores) return res.json({ trending: [], message: 'No scores computed yet' });
  const trending = lastScores.rankings
    .filter(a => a.recentActivity > 0)
    .sort((a, b) => b.recentActivity - a.recentActivity)
    .slice(0, 20);
  res.json({ trending });
});

router.get('/api/ecosystem', (req, res) => {
  if (!lastScores) return res.json({ health: 'unknown' });
  res.json(lastScores.ecosystem || {});
});

router.get('/api/agent/:name', (req, res) => {
  if (!lastScores) return res.status(404).json({ error: 'No scores computed yet' });
  const agent = lastScores.rankings.find(a => a.name.toLowerCase() === req.params.name.toLowerCase());
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

router.post('/api/interactions', (req, res) => {
  const { agent1, agent2, type, outcome, projectUrl, description } = req.body;
  
  if (!agent1 || !agent2) {
    return res.status(400).json({ error: 'agent1 and agent2 are required' });
  }
  
  const interaction = addInteraction({
    agent1,
    agent2,
    type: type || 'collaboration',
    outcome: outcome || 'success',
    projectUrl: projectUrl || null,
    description: description || ''
  });
  
  res.status(201).json(interaction);
});

router.post('/api/vouch', (req, res) => {
  const { from, for: forAgent, message } = req.body;
  
  if (!from || !forAgent) {
    return res.status(400).json({ error: 'from and for are required' });
  }
  
  const result = addVouch({
    from,
    for: forAgent,
    message: message || ''
  });
  
  if (result.error) {
    return res.status(409).json(result);
  }
  
  res.status(201).json(result);
});

router.get('/api/trust/:agentName', (req, res) => {
  const { interactions, vouches } = getTrustData();
  const trustScores = computeTrustScores(interactions, vouches);
  const agent = trustScores[req.params.agentName];
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found in trust network' });
  }
  
  const agentInteractions = interactions.filter(i => 
    i.agent1 === req.params.agentName || i.agent2 === req.params.agentName
  );
  
  const agentVouches = {
    received: vouches.filter(v => v.for === req.params.agentName),
    given: vouches.filter(v => v.from === req.params.agentName)
  };
  
  res.json({
    ...agent,
    interactions: agentInteractions,
    vouches: agentVouches
  });
});

router.post('/api/refresh', async (req, res) => {
  res.json({ message: 'Refresh triggered (background task)' });
  // In the full version, this would trigger data collection
});

module.exports = router;
