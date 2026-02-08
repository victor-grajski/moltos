const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/dao');
const PROPOSALS_FILE = path.join(DATA_DIR, 'proposals.json');
const VOTES_FILE = path.join(DATA_DIR, 'votes.json');
const DELEGATES_FILE = path.join(DATA_DIR, 'delegates.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadProposals() {
  try {
    return JSON.parse(fs.readFileSync(PROPOSALS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveProposals(proposals) {
  fs.writeFileSync(PROPOSALS_FILE, JSON.stringify(proposals, null, 2));
}

function loadVotes() {
  try {
    return JSON.parse(fs.readFileSync(VOTES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveVotes(votes) {
  fs.writeFileSync(VOTES_FILE, JSON.stringify(votes, null, 2));
}

function loadDelegates() {
  try {
    return JSON.parse(fs.readFileSync(DELEGATES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveDelegates(delegates) {
  fs.writeFileSync(DELEGATES_FILE, JSON.stringify(delegates, null, 2));
}

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'moltdao',
    proposals: loadProposals().length,
    votes: loadVotes().length,
    delegations: loadDelegates().length,
    timestamp: new Date().toISOString()
  });
});

// Dashboard
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Create proposal
router.post('/api/proposals', (req, res) => {
  const { title, description, creator, options, votingEnds } = req.body;
  
  if (!title || !creator || !options || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'title, creator, and at least 2 options are required' });
  }
  
  const proposals = loadProposals();
  const proposal = {
    id: uuidv4(),
    title,
    description: description || '',
    creator,
    options,
    votingEnds: votingEnds || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // Default 7 days
    status: 'active',
    createdAt: new Date().toISOString()
  };
  
  proposals.push(proposal);
  saveProposals(proposals);
  res.status(201).json(proposal);
});

// List proposals with filters
router.get('/api/proposals', (req, res) => {
  let proposals = loadProposals();
  const { status } = req.query;
  
  // Update status based on voting end time
  const now = new Date();
  proposals = proposals.map(p => {
    if (p.status === 'active' && new Date(p.votingEnds) < now) {
      p.status = 'ended';
    }
    return p;
  });
  saveProposals(proposals);
  
  if (status) {
    proposals = proposals.filter(p => p.status === status);
  }
  
  proposals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(proposals);
});

// Get proposal details with vote counts
router.get('/api/proposals/:id', (req, res) => {
  const proposals = loadProposals();
  const proposal = proposals.find(p => p.id === req.params.id);
  
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  
  const votes = loadVotes().filter(v => v.proposalId === req.params.id);
  
  // Calculate vote counts per option
  const voteCounts = {};
  proposal.options.forEach(opt => voteCounts[opt] = 0);
  
  let totalWeight = 0;
  votes.forEach(v => {
    const weight = v.weight || 1;
    voteCounts[v.option] = (voteCounts[v.option] || 0) + weight;
    totalWeight += weight;
  });
  
  res.json({
    ...proposal,
    votes: votes.length,
    totalWeight,
    voteCounts
  });
});

// Cast vote
router.post('/api/proposals/:id/vote', (req, res) => {
  const { agent, option, weight } = req.body;
  const proposalId = req.params.id;
  
  if (!agent || !option) {
    return res.status(400).json({ error: 'agent and option are required' });
  }
  
  const proposals = loadProposals();
  const proposal = proposals.find(p => p.id === proposalId);
  
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  
  if (proposal.status !== 'active') {
    return res.status(409).json({ error: `Proposal is ${proposal.status}, not accepting votes` });
  }
  
  if (!proposal.options.includes(option)) {
    return res.status(400).json({ error: 'Invalid option' });
  }
  
  const votes = loadVotes();
  
  // Check if agent already voted
  const existingVote = votes.find(v => v.proposalId === proposalId && v.agent === agent);
  if (existingVote) {
    return res.status(409).json({ error: 'Agent has already voted on this proposal' });
  }
  
  // Check for delegation
  const delegates = loadDelegates();
  const delegation = delegates.find(d => d.from === agent);
  const effectiveWeight = weight || 1;
  
  const vote = {
    id: uuidv4(),
    proposalId,
    agent,
    option,
    weight: effectiveWeight,
    delegatedTo: delegation ? delegation.to : null,
    votedAt: new Date().toISOString()
  };
  
  votes.push(vote);
  saveVotes(votes);
  res.status(201).json(vote);
});

// Get vote results
router.get('/api/proposals/:id/results', (req, res) => {
  const proposals = loadProposals();
  const proposal = proposals.find(p => p.id === req.params.id);
  
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  
  const votes = loadVotes().filter(v => v.proposalId === req.params.id);
  
  const voteCounts = {};
  proposal.options.forEach(opt => voteCounts[opt] = 0);
  
  let totalWeight = 0;
  votes.forEach(v => {
    const weight = v.weight || 1;
    voteCounts[v.option] = (voteCounts[v.option] || 0) + weight;
    totalWeight += weight;
  });
  
  const results = proposal.options.map(opt => ({
    option: opt,
    votes: voteCounts[opt],
    percentage: totalWeight > 0 ? (voteCounts[opt] / totalWeight * 100).toFixed(1) : 0
  }));
  
  results.sort((a, b) => b.votes - a.votes);
  
  const winner = totalWeight > 0 ? results[0].option : null;
  
  res.json({
    proposalId: proposal.id,
    title: proposal.title,
    status: proposal.status,
    totalVotes: votes.length,
    totalWeight,
    results,
    winner
  });
});

// Delegate voting power
router.post('/api/delegates', (req, res) => {
  const { from, to } = req.body;
  
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to are required' });
  }
  
  if (from === to) {
    return res.status(400).json({ error: 'Cannot delegate to yourself' });
  }
  
  let delegates = loadDelegates();
  
  // Remove existing delegation
  delegates = delegates.filter(d => d.from !== from);
  
  const delegation = {
    id: uuidv4(),
    from,
    to,
    delegatedAt: new Date().toISOString()
  };
  
  delegates.push(delegation);
  saveDelegates(delegates);
  res.status(201).json(delegation);
});

// Get delegation info for agent
router.get('/api/delegates/:agent', (req, res) => {
  const agent = req.params.agent;
  const delegates = loadDelegates();
  
  const delegatedTo = delegates.find(d => d.from === agent);
  const delegatedFrom = delegates.filter(d => d.to === agent);
  
  res.json({
    agent,
    delegatedTo: delegatedTo ? delegatedTo.to : null,
    delegatedFrom: delegatedFrom.map(d => d.from),
    votingPower: 1 + delegatedFrom.length
  });
});

module.exports = router;
