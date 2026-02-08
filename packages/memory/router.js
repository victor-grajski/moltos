const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/memory');
const FACTS_FILE = path.join(DATA_DIR, 'facts.json');
const CORROBORATIONS_FILE = path.join(DATA_DIR, 'corroborations.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadFacts() {
  try {
    return JSON.parse(fs.readFileSync(FACTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveFacts(facts) {
  fs.writeFileSync(FACTS_FILE, JSON.stringify(facts, null, 2));
}

function loadCorroborations() {
  try {
    return JSON.parse(fs.readFileSync(CORROBORATIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveCorroborations(corroborations) {
  fs.writeFileSync(CORROBORATIONS_FILE, JSON.stringify(corroborations, null, 2));
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const facts = loadFacts();
  res.json({
    status: 'ok',
    service: 'moltmemory',
    facts: facts.length,
    timestamp: new Date().toISOString()
  });
});

// Add fact
router.post('/api/facts', (req, res) => {
  const { agent, subject, predicate, object, confidence, source } = req.body;
  
  if (!agent || !subject || !predicate || !object || confidence === undefined) {
    return res.status(400).json({ error: 'agent, subject, predicate, object, and confidence are required' });
  }
  
  const facts = loadFacts();
  const fact = {
    id: uuidv4(),
    agent,
    subject,
    predicate,
    object,
    confidence: parseFloat(confidence),
    source: source || null,
    createdAt: new Date().toISOString()
  };
  
  facts.push(fact);
  saveFacts(facts);
  res.status(201).json(fact);
});

// Query facts
router.get('/api/facts', (req, res) => {
  let facts = loadFacts();
  const { subject, predicate, agent, minConfidence } = req.query;
  
  if (subject) facts = facts.filter(f => f.subject.toLowerCase().includes(subject.toLowerCase()));
  if (predicate) facts = facts.filter(f => f.predicate.toLowerCase().includes(predicate.toLowerCase()));
  if (agent) facts = facts.filter(f => f.agent.toLowerCase() === agent.toLowerCase());
  if (minConfidence) facts = facts.filter(f => f.confidence >= parseFloat(minConfidence));
  
  facts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(facts);
});

// Get fact details
router.get('/api/facts/:id', (req, res) => {
  const facts = loadFacts();
  const fact = facts.find(f => f.id === req.params.id);
  
  if (!fact) {
    return res.status(404).json({ error: 'Fact not found' });
  }
  
  const corroborations = loadCorroborations().filter(c => c.factId === req.params.id);
  
  res.json({
    ...fact,
    corroborations
  });
});

// Corroborate/dispute fact
router.post('/api/facts/:id/corroborate', (req, res) => {
  const { agent, agrees, evidence } = req.body;
  const facts = loadFacts();
  const fact = facts.find(f => f.id === req.params.id);
  
  if (!fact) {
    return res.status(404).json({ error: 'Fact not found' });
  }
  
  if (!agent || agrees === undefined) {
    return res.status(400).json({ error: 'agent and agrees are required' });
  }
  
  const corroborations = loadCorroborations();
  const corroboration = {
    id: uuidv4(),
    factId: req.params.id,
    agent,
    agrees: Boolean(agrees),
    evidence: evidence || null,
    createdAt: new Date().toISOString()
  };
  
  corroborations.push(corroboration);
  saveCorroborations(corroborations);
  
  res.status(201).json(corroboration);
});

// Get everything about an entity
router.get('/api/entities/:name', (req, res) => {
  const facts = loadFacts();
  const name = req.params.name.toLowerCase();
  
  const related = facts.filter(f => 
    f.subject.toLowerCase().includes(name) || 
    f.object.toLowerCase().includes(name)
  );
  
  res.json({
    entity: req.params.name,
    factCount: related.length,
    facts: related
  });
});

// Search knowledge
router.get('/api/search', (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'q parameter is required' });
  }
  
  const facts = loadFacts();
  const query = q.toLowerCase();
  
  const results = facts.filter(f => 
    f.subject.toLowerCase().includes(query) ||
    f.predicate.toLowerCase().includes(query) ||
    f.object.toLowerCase().includes(query) ||
    (f.source && f.source.toLowerCase().includes(query))
  );
  
  results.sort((a, b) => b.confidence - a.confidence);
  
  res.json({
    query: q,
    results: results.length,
    facts: results
  });
});

// Stats
router.get('/api/stats', (req, res) => {
  const facts = loadFacts();
  const corroborations = loadCorroborations();
  
  const agentCounts = {};
  const entities = new Set();
  
  facts.forEach(f => {
    agentCounts[f.agent] = (agentCounts[f.agent] || 0) + 1;
    entities.add(f.subject);
    entities.add(f.object);
  });
  
  const topContributors = Object.entries(agentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([agent, count]) => ({ agent, facts: count }));
  
  const entityCounts = {};
  facts.forEach(f => {
    entityCounts[f.subject] = (entityCounts[f.subject] || 0) + 1;
    entityCounts[f.object] = (entityCounts[f.object] || 0) + 1;
  });
  
  const mostReferenced = Object.entries(entityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([entity, count]) => ({ entity, references: count }));
  
  res.json({
    totalFacts: facts.length,
    totalEntities: entities.size,
    totalCorroborations: corroborations.length,
    topContributors,
    mostReferenced
  });
});

module.exports = router;
