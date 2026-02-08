const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/audit');
const SKILLS_FILE = path.join(DATA_DIR, 'skills.json');
const VOUCHES_FILE = path.join(DATA_DIR, 'vouches.json');
const TRUST_FILE = path.join(DATA_DIR, 'trust.json');
const REPUTATION_FILE = path.join(DATA_DIR, 'reputation.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper functions
function loadSkills() {
  try {
    return JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveSkills(skills) {
  fs.writeFileSync(SKILLS_FILE, JSON.stringify(skills, null, 2));
}

function loadVouches() {
  try {
    return JSON.parse(fs.readFileSync(VOUCHES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveVouches(vouches) {
  fs.writeFileSync(VOUCHES_FILE, JSON.stringify(vouches, null, 2));
}

function loadTrust() {
  try {
    return JSON.parse(fs.readFileSync(TRUST_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveTrust(trust) {
  fs.writeFileSync(TRUST_FILE, JSON.stringify(trust, null, 2));
}

function loadReputation() {
  try {
    return JSON.parse(fs.readFileSync(REPUTATION_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveReputation(reputation) {
  fs.writeFileSync(REPUTATION_FILE, JSON.stringify(reputation, null, 2));
}

// Content hashing (SHA-256)
function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Simple Ed25519-style signature verification (mock for now)
function verifySignature(content, signature, publicKey) {
  // In production, use a real crypto library like sodium
  // For now, just check signature exists and is non-empty
  return signature && signature.length > 0;
}

// PageRank algorithm for reputation scoring
function calculatePageRank(iterations = 20, dampingFactor = 0.85) {
  const trust = loadTrust();
  const vouches = loadVouches();
  
  // Build agent graph
  const agents = new Set();
  trust.forEach(t => {
    agents.add(t.fromAgent);
    agents.add(t.toAgent);
  });
  vouches.forEach(v => agents.add(v.agentId));
  
  if (agents.size === 0) {
    return {};
  }
  
  // Initialize scores
  const scores = {};
  const initialScore = 1.0 / agents.size;
  agents.forEach(agent => {
    scores[agent] = initialScore;
  });
  
  // Build adjacency list (who trusts whom)
  const outLinks = {};
  agents.forEach(agent => {
    outLinks[agent] = [];
  });
  
  trust.forEach(t => {
    if (t.active !== false) {
      outLinks[t.fromAgent].push({ to: t.toAgent, weight: t.weight || 1.0 });
    }
  });
  
  // PageRank iterations
  for (let i = 0; i < iterations; i++) {
    const newScores = {};
    
    agents.forEach(agent => {
      let rank = (1 - dampingFactor) / agents.size;
      
      // Sum contributions from agents that trust this one
      trust.forEach(t => {
        if (t.toAgent === agent && t.active !== false) {
          const fromAgent = t.fromAgent;
          const outLinkCount = outLinks[fromAgent].length || 1;
          const weight = t.weight || 1.0;
          rank += dampingFactor * (scores[fromAgent] / outLinkCount) * weight;
        }
      });
      
      newScores[agent] = rank;
    });
    
    Object.assign(scores, newScores);
  }
  
  // Normalize scores to 0-100 scale
  const maxScore = Math.max(...Object.values(scores));
  if (maxScore > 0) {
    Object.keys(scores).forEach(agent => {
      scores[agent] = (scores[agent] / maxScore) * 100;
    });
  }
  
  return scores;
}

// Recalculate and cache reputation scores
function updateReputationScores() {
  const scores = calculatePageRank();
  saveReputation(scores);
  return scores;
}

// Calculate safety score for a skill
function calculateSafetyScore(skillId) {
  const vouches = loadVouches().filter(v => v.skillId === skillId);
  const reputation = loadReputation();
  
  if (vouches.length === 0) {
    return {
      level: 'unaudited',
      score: 0,
      vouchCount: 0,
      details: 'No vouches yet'
    };
  }
  
  // Weight vouches by voucher reputation
  let weightedScore = 0;
  let totalWeight = 0;
  
  vouches.forEach(vouch => {
    const voucherRep = reputation[vouch.agentId] || 10; // Default reputation
    const testScore = vouch.testResults?.passed ? 1.0 : 0.5;
    
    weightedScore += voucherRep * testScore;
    totalWeight += voucherRep;
  });
  
  const avgScore = totalWeight > 0 ? (weightedScore / totalWeight) : 0;
  
  // Determine safety level
  let level = 'unaudited';
  if (vouches.length >= 5 && avgScore >= 70) {
    level = 'trusted';
  } else if (vouches.length >= 2 && avgScore >= 40) {
    level = 'community-tested';
  } else if (vouches.length >= 1) {
    level = 'limited-testing';
  }
  
  return {
    level,
    score: Math.round(avgScore),
    vouchCount: vouches.length,
    weightedVouches: totalWeight,
    details: `${vouches.length} vouch(es), weighted score: ${Math.round(avgScore)}`
  };
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'moltaudit',
    skills: loadSkills().length,
    vouches: loadVouches().length,
    trustRelationships: loadTrust().length,
    timestamp: new Date().toISOString()
  });
});

// ===== SKILL REGISTRY =====

// Register a new skill
router.post('/api/skills', (req, res) => {
  const { name, description, code, author, authorId, signature, publicKey } = req.body;
  
  if (!name || !code || !author) {
    return res.status(400).json({ error: 'name, code, and author are required' });
  }
  
  // Compute content hash
  const contentHash = hashContent(code);
  
  // Verify signature if provided
  if (signature && publicKey) {
    const valid = verifySignature(contentHash, signature, publicKey);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
  }
  
  const skills = loadSkills();
  
  // Check for duplicate hash
  const existing = skills.find(s => s.contentHash === contentHash);
  if (existing) {
    return res.status(409).json({ 
      error: 'Skill with identical content already registered',
      existingId: existing.id
    });
  }
  
  const skill = {
    id: uuidv4(),
    name,
    description: description || '',
    contentHash,
    author,
    authorId: authorId || null,
    signature: signature || null,
    publicKey: publicKey || null,
    registeredAt: new Date().toISOString(),
    vouchCount: 0
  };
  
  skills.push(skill);
  saveSkills(skills);
  
  res.status(201).json(skill);
});

// List all skills
router.get('/api/skills', (req, res) => {
  const skills = loadSkills();
  const vouches = loadVouches();
  
  // Attach vouch counts and safety scores
  const enrichedSkills = skills.map(skill => {
    const skillVouches = vouches.filter(v => v.skillId === skill.id);
    const safetyScore = calculateSafetyScore(skill.id);
    
    return {
      ...skill,
      vouchCount: skillVouches.length,
      safetyLevel: safetyScore.level,
      safetyScore: safetyScore.score
    };
  });
  
  res.json(enrichedSkills);
});

// Get skill by ID
router.get('/api/skills/:id', (req, res) => {
  const skills = loadSkills();
  const skill = skills.find(s => s.id === req.params.id);
  
  if (!skill) {
    return res.status(404).json({ error: 'Skill not found' });
  }
  
  // Get vouches for this skill
  const vouches = loadVouches().filter(v => v.skillId === skill.id);
  const safetyScore = calculateSafetyScore(skill.id);
  
  res.json({
    ...skill,
    vouches,
    safetyScore
  });
});

// Get skill safety score
router.get('/api/skills/:id/safety', (req, res) => {
  const skills = loadSkills();
  const skill = skills.find(s => s.id === req.params.id);
  
  if (!skill) {
    return res.status(404).json({ error: 'Skill not found' });
  }
  
  const safetyScore = calculateSafetyScore(skill.id);
  
  res.json({
    skillId: skill.id,
    skillName: skill.name,
    ...safetyScore
  });
});

// ===== VOUCHING SYSTEM =====

// Vouch for a skill
router.post('/api/vouch', (req, res) => {
  const { skillId, agentId, agentName, testResults, comment, signature } = req.body;
  
  if (!skillId || !agentId) {
    return res.status(400).json({ error: 'skillId and agentId are required' });
  }
  
  const skills = loadSkills();
  const skill = skills.find(s => s.id === skillId);
  
  if (!skill) {
    return res.status(404).json({ error: 'Skill not found' });
  }
  
  const vouches = loadVouches();
  
  // Check if agent already vouched for this skill
  const existing = vouches.find(v => v.skillId === skillId && v.agentId === agentId);
  if (existing) {
    return res.status(409).json({ 
      error: 'Agent has already vouched for this skill',
      existingVouch: existing
    });
  }
  
  const vouch = {
    id: uuidv4(),
    skillId,
    agentId,
    agentName: agentName || agentId,
    testResults: testResults || { passed: true },
    comment: comment || '',
    signature: signature || null,
    vouchedAt: new Date().toISOString()
  };
  
  vouches.push(vouch);
  saveVouches(vouches);
  
  // Update skill vouch count
  skill.vouchCount = (skill.vouchCount || 0) + 1;
  saveSkills(skills);
  
  res.status(201).json(vouch);
});

// Get vouches for a skill
router.get('/api/vouch/skill/:skillId', (req, res) => {
  const vouches = loadVouches().filter(v => v.skillId === req.params.skillId);
  res.json(vouches);
});

// Get vouches by an agent
router.get('/api/vouch/agent/:agentId', (req, res) => {
  const vouches = loadVouches().filter(v => v.agentId === req.params.agentId);
  res.json(vouches);
});

// ===== TRUST GRAPH =====

// Record trust relationship
router.post('/api/trust', (req, res) => {
  const { fromAgent, toAgent, weight, reason } = req.body;
  
  if (!fromAgent || !toAgent) {
    return res.status(400).json({ error: 'fromAgent and toAgent are required' });
  }
  
  if (fromAgent === toAgent) {
    return res.status(400).json({ error: 'Cannot trust yourself' });
  }
  
  const trust = loadTrust();
  
  // Check for existing relationship
  const existing = trust.find(t => t.fromAgent === fromAgent && t.toAgent === toAgent);
  
  if (existing) {
    // Update existing trust
    existing.weight = weight || existing.weight;
    existing.reason = reason || existing.reason;
    existing.updatedAt = new Date().toISOString();
    existing.active = true;
    
    saveTrust(trust);
    
    // Trigger reputation recalculation
    updateReputationScores();
    
    return res.json(existing);
  }
  
  const trustRelationship = {
    id: uuidv4(),
    fromAgent,
    toAgent,
    weight: weight || 1.0,
    reason: reason || '',
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  trust.push(trustRelationship);
  saveTrust(trust);
  
  // Trigger reputation recalculation
  updateReputationScores();
  
  res.status(201).json(trustRelationship);
});

// Remove trust relationship
router.delete('/api/trust/:id', (req, res) => {
  const trust = loadTrust();
  const relationship = trust.find(t => t.id === req.params.id);
  
  if (!relationship) {
    return res.status(404).json({ error: 'Trust relationship not found' });
  }
  
  relationship.active = false;
  relationship.updatedAt = new Date().toISOString();
  
  saveTrust(trust);
  
  // Trigger reputation recalculation
  updateReputationScores();
  
  res.json({ success: true, relationship });
});

// Get trust graph
router.get('/api/trust/graph', (req, res) => {
  const trust = loadTrust().filter(t => t.active !== false);
  
  // Build nodes and edges for graph visualization
  const nodes = new Set();
  const edges = [];
  
  trust.forEach(t => {
    nodes.add(t.fromAgent);
    nodes.add(t.toAgent);
    edges.push({
      from: t.fromAgent,
      to: t.toAgent,
      weight: t.weight,
      id: t.id
    });
  });
  
  res.json({
    nodes: Array.from(nodes).map(id => ({ id, label: id })),
    edges,
    nodeCount: nodes.size,
    edgeCount: edges.length
  });
});

// Get trust relationships for an agent
router.get('/api/trust/agent/:agentId', (req, res) => {
  const trust = loadTrust().filter(t => t.active !== false);
  const agentId = req.params.agentId;
  
  const trusting = trust.filter(t => t.fromAgent === agentId);
  const trustedBy = trust.filter(t => t.toAgent === agentId);
  
  res.json({
    agentId,
    trusting: trusting.length,
    trustedBy: trustedBy.length,
    trustingList: trusting,
    trustedByList: trustedBy
  });
});

// ===== REPUTATION SYSTEM =====

// Get reputation score for an agent
router.get('/api/reputation/:agentId', (req, res) => {
  const reputation = loadReputation();
  const agentId = req.params.agentId;
  const score = reputation[agentId] || 0;
  
  // Get additional stats
  const vouches = loadVouches().filter(v => v.agentId === agentId);
  const trust = loadTrust().filter(t => t.active !== false);
  const trustedBy = trust.filter(t => t.toAgent === agentId);
  
  res.json({
    agentId,
    reputationScore: Math.round(score * 10) / 10,
    vouchCount: vouches.length,
    trustedByCount: trustedBy.length,
    percentile: calculatePercentile(agentId, reputation)
  });
});

// Get all reputation scores
router.get('/api/reputation', (req, res) => {
  const reputation = loadReputation();
  
  const ranked = Object.entries(reputation)
    .map(([agentId, score]) => ({
      agentId,
      score: Math.round(score * 10) / 10
    }))
    .sort((a, b) => b.score - a.score);
  
  res.json({
    scores: ranked,
    totalAgents: ranked.length,
    lastUpdated: getReputationLastUpdated()
  });
});

// Manually trigger reputation recalculation
router.post('/api/reputation/recalculate', (req, res) => {
  const scores = updateReputationScores();
  
  res.json({
    success: true,
    message: 'Reputation scores recalculated',
    agentCount: Object.keys(scores).length,
    scores: Object.entries(scores)
      .map(([agentId, score]) => ({
        agentId,
        score: Math.round(score * 10) / 10
      }))
      .sort((a, b) => b.score - a.score)
  });
});

// Helper: Calculate percentile ranking
function calculatePercentile(agentId, reputation) {
  const scores = Object.values(reputation);
  const agentScore = reputation[agentId] || 0;
  
  if (scores.length === 0) return 0;
  
  const belowCount = scores.filter(s => s < agentScore).length;
  return Math.round((belowCount / scores.length) * 100);
}

// Helper: Get last reputation update time
function getReputationLastUpdated() {
  try {
    const stats = fs.statSync(REPUTATION_FILE);
    return stats.mtime.toISOString();
  } catch {
    return null;
  }
}

// ===== STATISTICS & ANALYTICS =====

// Get overall system statistics
router.get('/api/stats', (req, res) => {
  const skills = loadSkills();
  const vouches = loadVouches();
  const trust = loadTrust().filter(t => t.active !== false);
  const reputation = loadReputation();
  
  const safetyLevels = {
    unaudited: 0,
    'limited-testing': 0,
    'community-tested': 0,
    trusted: 0
  };
  
  skills.forEach(skill => {
    const safety = calculateSafetyScore(skill.id);
    safetyLevels[safety.level] = (safetyLevels[safety.level] || 0) + 1;
  });
  
  res.json({
    skills: {
      total: skills.length,
      byLevel: safetyLevels
    },
    vouches: {
      total: vouches.length,
      avgPerSkill: skills.length > 0 ? (vouches.length / skills.length).toFixed(2) : 0
    },
    trustGraph: {
      relationships: trust.length,
      uniqueAgents: new Set([...trust.map(t => t.fromAgent), ...trust.map(t => t.toAgent)]).size
    },
    reputation: {
      trackedAgents: Object.keys(reputation).length,
      avgScore: Object.keys(reputation).length > 0 
        ? (Object.values(reputation).reduce((a, b) => a + b, 0) / Object.keys(reputation).length).toFixed(2)
        : 0
    }
  });
});

module.exports = router;
