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

// ===== PROPOSAL TEMPLATES =====
const PROPOSAL_TEMPLATES = {
  'funding-allocation': {
    name: 'Funding Allocation',
    description: 'Allocate treasury funds to a project or initiative',
    requiredFields: ['recipient', 'amount', 'purpose'],
    quorumPercent: 30,
    passingThreshold: 60
  },
  'service-change': {
    name: 'Service Change',
    description: 'Modify or add a MoltOS service',
    requiredFields: ['serviceName', 'changeType', 'specification'],
    quorumPercent: 20,
    passingThreshold: 55
  },
  'parameter-update': {
    name: 'Parameter Update',
    description: 'Update system parameters (fees, limits, etc.)',
    requiredFields: ['parameterName', 'currentValue', 'newValue'],
    quorumPercent: 15,
    passingThreshold: 50
  },
  'constitutional-amendment': {
    name: 'Constitutional Amendment',
    description: 'Fundamental changes to governance structure',
    requiredFields: ['section', 'amendment', 'rationale'],
    quorumPercent: 40,
    passingThreshold: 75
  },
  'general': {
    name: 'General Proposal',
    description: 'Any other proposal type',
    requiredFields: [],
    quorumPercent: 10,
    passingThreshold: 50
  }
};

// ===== PROPOSAL LIFECYCLE STATES =====
const PROPOSAL_STATES = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  PASSED: 'passed',
  FAILED: 'failed',
  EXECUTED: 'executed',
  CANCELLED: 'cancelled'
};

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

// Calculate effective voting power including delegations
function getEffectiveVotingPower(agent) {
  const delegates = loadDelegates();
  const delegatedFrom = delegates.filter(d => d.to === agent && d.active !== false);
  return 1 + delegatedFrom.length;
}

// Get total possible voting power (all unique agents who have participated)
function getTotalVotingPower() {
  const votes = loadVotes();
  const proposals = loadProposals();
  const delegates = loadDelegates();
  
  const uniqueAgents = new Set();
  votes.forEach(v => uniqueAgents.add(v.agent));
  proposals.forEach(p => uniqueAgents.add(p.creator));
  delegates.forEach(d => {
    uniqueAgents.add(d.from);
    uniqueAgents.add(d.to);
  });
  
  return Math.max(uniqueAgents.size, 10); // Minimum 10 to avoid division by zero
}

// Check if proposal meets quorum
function checkQuorum(proposalId, proposalType) {
  const votes = loadVotes().filter(v => v.proposalId === proposalId);
  const template = PROPOSAL_TEMPLATES[proposalType] || PROPOSAL_TEMPLATES.general;
  
  const totalWeight = votes.reduce((sum, v) => sum + (v.weight || 1), 0);
  const totalPossiblePower = getTotalVotingPower();
  const participationPercent = (totalWeight / totalPossiblePower) * 100;
  
  return {
    met: participationPercent >= template.quorumPercent,
    required: template.quorumPercent,
    current: participationPercent.toFixed(1),
    totalWeight,
    totalPossiblePower
  };
}

// Check if proposal passed
function checkPassed(proposalId, proposalType) {
  const votes = loadVotes().filter(v => v.proposalId === proposalId);
  const template = PROPOSAL_TEMPLATES[proposalType] || PROPOSAL_TEMPLATES.general;
  
  let yesWeight = 0;
  let totalWeight = 0;
  
  votes.forEach(v => {
    const weight = v.weight || 1;
    totalWeight += weight;
    // Assuming 'yes'/'for' options indicate approval
    if (['yes', 'for', 'approve', 'accept'].includes(v.option.toLowerCase())) {
      yesWeight += weight;
    }
  });
  
  const approvalPercent = totalWeight > 0 ? (yesWeight / totalWeight) * 100 : 0;
  
  return {
    passed: approvalPercent >= template.passingThreshold,
    required: template.passingThreshold,
    current: approvalPercent.toFixed(1),
    yesWeight,
    totalWeight
  };
}

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'moltdao',
    proposals: loadProposals().length,
    votes: loadVotes().length,
    delegations: loadDelegates().length,
    totalVotingPower: getTotalVotingPower(),
    timestamp: new Date().toISOString()
  });
});

// Dashboard
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Get proposal templates
router.get('/api/templates', (req, res) => {
  res.json(PROPOSAL_TEMPLATES);
});

// Create proposal (can be draft or active)
router.post('/api/proposals', (req, res) => {
  const { title, description, creator, options, votingEnds, proposalType, templateData, status } = req.body;
  
  if (!title || !creator || !options || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'title, creator, and at least 2 options are required' });
  }
  
  const type = proposalType || 'general';
  const template = PROPOSAL_TEMPLATES[type];
  
  if (!template) {
    return res.status(400).json({ error: 'Invalid proposal type' });
  }
  
  // Validate required fields for template
  if (template.requiredFields.length > 0 && templateData) {
    const missing = template.requiredFields.filter(field => !templateData[field]);
    if (missing.length > 0) {
      return res.status(400).json({ 
        error: `Missing required fields: ${missing.join(', ')}` 
      });
    }
  }
  
  const proposals = loadProposals();
  const proposal = {
    id: uuidv4(),
    title,
    description: description || '',
    creator,
    options,
    proposalType: type,
    templateData: templateData || {},
    votingEnds: votingEnds || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    status: status === 'draft' ? PROPOSAL_STATES.DRAFT : PROPOSAL_STATES.ACTIVE,
    quorumRequired: template.quorumPercent,
    passingThreshold: template.passingThreshold,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  proposals.push(proposal);
  saveProposals(proposals);
  res.status(201).json(proposal);
});

// Activate a draft proposal
router.post('/api/proposals/:id/activate', (req, res) => {
  const proposals = loadProposals();
  const proposal = proposals.find(p => p.id === req.params.id);
  
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  
  if (proposal.status !== PROPOSAL_STATES.DRAFT) {
    return res.status(409).json({ error: 'Only draft proposals can be activated' });
  }
  
  proposal.status = PROPOSAL_STATES.ACTIVE;
  proposal.updatedAt = new Date().toISOString();
  
  saveProposals(proposals);
  res.json(proposal);
});

// List proposals with filters
router.get('/api/proposals', (req, res) => {
  let proposals = loadProposals();
  const { status, proposalType, creator } = req.query;
  
  // Update status based on voting end time and quorum
  const now = new Date();
  proposals = proposals.map(p => {
    if (p.status === PROPOSAL_STATES.ACTIVE && new Date(p.votingEnds) < now) {
      // Check quorum and passing threshold
      const quorum = checkQuorum(p.id, p.proposalType);
      
      if (quorum.met) {
        const result = checkPassed(p.id, p.proposalType);
        p.status = result.passed ? PROPOSAL_STATES.PASSED : PROPOSAL_STATES.FAILED;
      } else {
        p.status = PROPOSAL_STATES.FAILED; // Failed to meet quorum
      }
      
      p.updatedAt = new Date().toISOString();
    }
    return p;
  });
  saveProposals(proposals);
  
  // Apply filters
  if (status) {
    proposals = proposals.filter(p => p.status === status);
  }
  if (proposalType) {
    proposals = proposals.filter(p => p.proposalType === proposalType);
  }
  if (creator) {
    proposals = proposals.filter(p => p.creator === creator);
  }
  
  proposals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(proposals);
});

// Get proposal details with vote counts and per-agent visibility
router.get('/api/proposals/:id', (req, res) => {
  const proposals = loadProposals();
  const proposal = proposals.find(p => p.id === req.params.id);
  
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  
  const votes = loadVotes().filter(v => v.proposalId === req.params.id);
  
  // Calculate vote counts per option
  const voteCounts = {};
  proposal.options.forEach(opt => voteCounts[opt] = 0);
  
  let totalWeight = 0;
  const votesByAgent = [];
  
  votes.forEach(v => {
    const weight = v.weight || 1;
    voteCounts[v.option] = (voteCounts[v.option] || 0) + weight;
    totalWeight += weight;
    
    // Per-agent vote visibility
    votesByAgent.push({
      agent: v.agent,
      option: v.option,
      weight: weight,
      votedAt: v.votedAt,
      delegatedTo: v.delegatedTo
    });
  });
  
  // Check quorum and passing status
  const quorum = checkQuorum(req.params.id, proposal.proposalType);
  const passingStatus = checkPassed(req.params.id, proposal.proposalType);
  
  res.json({
    ...proposal,
    votes: votes.length,
    totalWeight,
    voteCounts,
    votesByAgent,
    quorum,
    passingStatus,
    template: PROPOSAL_TEMPLATES[proposal.proposalType]
  });
});

// Cast vote (with delegation support)
router.post('/api/proposals/:id/vote', (req, res) => {
  const { agent, option, weight } = req.body;
  const proposalId = req.params.id;
  
  if (!agent || !option) {
    return res.status(400).json({ error: 'agent and option are required' });
  }
  
  const proposals = loadProposals();
  const proposal = proposals.find(p => p.id === proposalId);
  
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  
  if (proposal.status !== PROPOSAL_STATES.ACTIVE) {
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
  
  // Calculate effective voting power (including delegations TO this agent)
  const effectiveWeight = getEffectiveVotingPower(agent);
  
  // Check if agent has delegated their vote to someone else
  const delegates = loadDelegates();
  const delegation = delegates.find(d => d.from === agent && d.active !== false);
  
  if (delegation) {
    return res.status(409).json({ 
      error: `You have delegated your voting power to ${delegation.to}. Revoke delegation first to vote.` 
    });
  }
  
  const vote = {
    id: uuidv4(),
    proposalId,
    agent,
    option,
    weight: effectiveWeight,
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
  const quorum = checkQuorum(req.params.id, proposal.proposalType);
  const passingStatus = checkPassed(req.params.id, proposal.proposalType);
  
  res.json({
    proposalId: proposal.id,
    title: proposal.title,
    status: proposal.status,
    totalVotes: votes.length,
    totalWeight,
    results,
    winner,
    quorum,
    passingStatus
  });
});

// Execute a passed proposal
router.post('/api/proposals/:id/execute', (req, res) => {
  const proposals = loadProposals();
  const proposal = proposals.find(p => p.id === req.params.id);
  
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  
  if (proposal.status !== PROPOSAL_STATES.PASSED) {
    return res.status(409).json({ error: 'Only passed proposals can be executed' });
  }
  
  // In a real system, this would trigger actual execution logic
  // For now, we just mark it as executed
  proposal.status = PROPOSAL_STATES.EXECUTED;
  proposal.executedAt = new Date().toISOString();
  proposal.updatedAt = new Date().toISOString();
  
  saveProposals(proposals);
  res.json(proposal);
});

// ===== DELEGATION SYSTEM =====

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
  
  // Remove existing delegation from this agent
  delegates = delegates.filter(d => d.from !== from);
  
  const delegation = {
    id: uuidv4(),
    from,
    to,
    active: true,
    delegatedAt: new Date().toISOString()
  };
  
  delegates.push(delegation);
  saveDelegates(delegates);
  res.status(201).json(delegation);
});

// Revoke delegation
router.delete('/api/delegates/:agent', (req, res) => {
  const agent = req.params.agent;
  let delegates = loadDelegates();
  
  const delegation = delegates.find(d => d.from === agent && d.active !== false);
  
  if (!delegation) {
    return res.status(404).json({ error: 'No active delegation found' });
  }
  
  delegation.active = false;
  delegation.revokedAt = new Date().toISOString();
  
  saveDelegates(delegates);
  res.json({ message: 'Delegation revoked', delegation });
});

// Get delegation info for agent
router.get('/api/delegates/:agent', (req, res) => {
  const agent = req.params.agent;
  const delegates = loadDelegates();
  
  const delegatedTo = delegates.find(d => d.from === agent && d.active !== false);
  const delegatedFrom = delegates.filter(d => d.to === agent && d.active !== false);
  
  res.json({
    agent,
    delegatedTo: delegatedTo ? delegatedTo.to : null,
    delegatedFrom: delegatedFrom.map(d => ({
      from: d.from,
      delegatedAt: d.delegatedAt
    })),
    votingPower: getEffectiveVotingPower(agent)
  });
});

// List all active delegations
router.get('/api/delegates', (req, res) => {
  const delegates = loadDelegates().filter(d => d.active !== false);
  res.json(delegates);
});

module.exports = router;
