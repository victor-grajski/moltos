const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/spore');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

function loadResults() {
  try {
    return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveResults(results) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const agents = loadAgents();
  const activeAgents = agents.filter(a => a.status === 'active');
  
  res.json({
    status: 'ok',
    service: 'moltspore',
    totalAgents: agents.length,
    activeAgents: activeAgents.length,
    timestamp: new Date().toISOString()
  });
});

// Spawn new agent
router.post('/api/spawn', (req, res) => {
  const { parentId, task, specialization, ttl, config } = req.body;
  
  if (!parentId || !task) {
    return res.status(400).json({ error: 'parentId and task are required' });
  }
  
  const agents = loadAgents();
  
  const agent = {
    id: uuidv4(),
    parentId,
    task,
    specialization: specialization || 'general',
    ttl: ttl || null,
    config: config || {},
    status: 'active',
    spawnedAt: new Date().toISOString(),
    completedAt: null,
    expiresAt: ttl ? new Date(Date.now() + ttl * 1000).toISOString() : null
  };
  
  agents.push(agent);
  saveAgents(agents);
  res.status(201).json(agent);
});

// List spawned agents
router.get('/api/agents', (req, res) => {
  let agents = loadAgents();
  const { status } = req.query;
  
  if (status) {
    agents = agents.filter(a => a.status === status);
  }
  
  agents.sort((a, b) => new Date(b.spawnedAt) - new Date(a.spawnedAt));
  res.json(agents);
});

// Get agent details
router.get('/api/agents/:id', (req, res) => {
  const agents = loadAgents();
  const agent = agents.find(a => a.id === req.params.id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const results = loadResults();
  const agentResults = results.filter(r => r.agentId === agent.id);
  
  res.json({
    ...agent,
    results: agentResults
  });
});

// Agent reports results back
router.post('/api/agents/:id/report', (req, res) => {
  const { output, metrics } = req.body;
  const agents = loadAgents();
  const agent = agents.find(a => a.id === req.params.id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  agent.status = 'completed';
  agent.completedAt = new Date().toISOString();
  saveAgents(agents);
  
  const results = loadResults();
  const result = {
    id: uuidv4(),
    agentId: agent.id,
    output: output || {},
    metrics: metrics || {},
    reportedAt: new Date().toISOString()
  };
  
  results.push(result);
  saveResults(results);
  
  res.status(201).json(result);
});

// Merge results back to parent
router.post('/api/agents/:id/merge', (req, res) => {
  const agents = loadAgents();
  const agent = agents.find(a => a.id === req.params.id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  if (agent.status !== 'completed') {
    return res.status(400).json({ error: 'Agent has not completed yet' });
  }
  
  const results = loadResults();
  const agentResults = results.filter(r => r.agentId === agent.id);
  
  // In a real implementation, this would merge results back to the parent agent
  // For now, we just return the results
  res.json({
    success: true,
    parentId: agent.parentId,
    results: agentResults
  });
});

// Terminate agent
router.post('/api/agents/:id/kill', (req, res) => {
  const agents = loadAgents();
  const agent = agents.find(a => a.id === req.params.id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  agent.status = 'terminated';
  agent.completedAt = new Date().toISOString();
  saveAgents(agents);
  
  res.json({ success: true, agent });
});

// Get lineage (all children of a parent)
router.get('/api/lineage/:parentId', (req, res) => {
  const agents = loadAgents();
  const children = agents.filter(a => a.parentId === req.params.parentId);
  res.json(children);
});

// Get stats
router.get('/api/stats', (req, res) => {
  const agents = loadAgents();
  const results = loadResults();
  
  const stats = {
    totalSpawned: agents.length,
    active: agents.filter(a => a.status === 'active').length,
    completed: agents.filter(a => a.status === 'completed').length,
    terminated: agents.filter(a => a.status === 'terminated').length,
    expired: agents.filter(a => a.status === 'expired').length,
    completionRate: agents.length > 0 
      ? ((agents.filter(a => a.status === 'completed').length / agents.length) * 100).toFixed(1)
      : 0,
    avgCompletionTime: (() => {
      const completed = agents.filter(a => a.status === 'completed' && a.completedAt);
      if (completed.length === 0) return 0;
      const totalTime = completed.reduce((sum, a) => {
        return sum + (new Date(a.completedAt) - new Date(a.spawnedAt));
      }, 0);
      return Math.round(totalTime / completed.length / 1000); // seconds
    })()
  };
  
  res.json(stats);
});

module.exports = router;
