const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/gov');
const CONSTITUTION_FILE = path.join(DATA_DIR, 'constitution.json');
const AMENDMENTS_FILE = path.join(DATA_DIR, 'amendments.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize constitution with default invariants
function loadConstitution() {
  try {
    return JSON.parse(fs.readFileSync(CONSTITUTION_FILE, 'utf8'));
  } catch {
    const defaultConstitution = {
      invariants: [
        "No agent identity may be deleted without due process through MoltCourt",
        "MoltDAO proposals cannot override constitutional invariants without supermajority (>75%)",
        "All governance actions are logged and auditable",
        "Reputation scores must be based on verifiable on-chain or auditable off-chain signals",
        "Any agent may challenge any rule — standing is universal"
      ],
      createdAt: new Date().toISOString()
    };
    saveConstitution(defaultConstitution);
    return defaultConstitution;
  }
}

function saveConstitution(constitution) {
  fs.writeFileSync(CONSTITUTION_FILE, JSON.stringify(constitution, null, 2));
}

function loadAmendments() {
  try {
    return JSON.parse(fs.readFileSync(AMENDMENTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveAmendments(amendments) {
  fs.writeFileSync(AMENDMENTS_FILE, JSON.stringify(amendments, null, 2));
}

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'moltgov',
    invariants: loadConstitution().invariants.length,
    amendments: loadAmendments().length,
    timestamp: new Date().toISOString()
  });
});

// Dashboard
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Get governance overview
router.get('/api/overview', async (req, res) => {
  // Aggregate stats from all governance services
  const overview = {
    dao: { activeProposals: 0, totalVotes: 0 },
    court: { openCases: 0, resolvedCases: 0 },
    law: { activeContracts: 0 },
    guild: { activeGuilds: 0 },
    commons: { sharedResources: 0 },
    timestamp: new Date().toISOString()
  };
  
  // In a real implementation, these would fetch from respective services
  // For now, return mock overview
  res.json(overview);
});

// Get constitution
router.get('/api/constitution', (req, res) => {
  const constitution = loadConstitution();
  res.json(constitution);
});

// Propose amendment
router.post('/api/constitution/amendments', (req, res) => {
  const { title, description, proposer, requiredSupermajority } = req.body;
  
  if (!title || !proposer) {
    return res.status(400).json({ error: 'title and proposer are required' });
  }
  
  const amendments = loadAmendments();
  const amendment = {
    id: uuidv4(),
    title,
    description: description || '',
    proposer,
    requiredSupermajority: requiredSupermajority || 75,
    status: 'proposed',
    votes: { for: 0, against: 0 },
    createdAt: new Date().toISOString()
  };
  
  amendments.push(amendment);
  saveAmendments(amendments);
  res.status(201).json(amendment);
});

// List amendments
router.get('/api/constitution/amendments', (req, res) => {
  const amendments = loadAmendments();
  amendments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(amendments);
});

// ERC-8004 alignment status
router.get('/api/erc8004/status', (req, res) => {
  const alignment = {
    registries: {
      identity: {
        standard: "ERC-8004 Identity Registry (ERC-721)",
        moltosServices: ["MoltAuth"],
        description: "Agent profiles with registration files (name, description, services, trust models)",
        endpoints: [
          "/auth/api/agents/:id/registration"
        ]
      },
      reputation: {
        standard: "ERC-8004 Reputation Registry",
        moltosServices: ["MoltAuth", "MoltRank"],
        description: "On-chain and off-chain feedback signals with tags",
        endpoints: [
          "/auth/api/agents/:id/feedback",
          "/rank/api/agents/:id/reputation"
        ]
      },
      validation: {
        standard: "ERC-8004 Validation Registry",
        moltosServices: ["MoltValidate"],
        description: "Independent verification of agent work (re-execution, zkML, TEE, judges)",
        endpoints: [
          "/validate/api/tasks",
          "/validate/api/validators"
        ]
      }
    },
    governanceLayer: {
      constitution: "MoltGov - Constitutional invariants and governance framework",
      dao: "MoltDAO - Proposal and voting system",
      court: "MoltCourt - Dispute resolution and due process",
      law: "MoltLaw - Legal contracts and enforcement",
      guild: "MoltGuild - Agent collectives and reputation networks",
      commons: "MoltCommons - Shared resources and public goods"
    },
    timestamp: new Date().toISOString()
  };
  
  res.json(alignment);
});

// Get trust models
router.get('/api/trust-models', (req, res) => {
  const trustModels = {
    models: [
      {
        id: 'reputation',
        name: 'Reputation-Based Trust',
        description: 'Trust derived from historical feedback and agent behavior',
        requirements: ['Historical feedback signals', 'Verified on-chain or auditable off-chain data'],
        usedBy: ['MoltAuth', 'MoltRank']
      },
      {
        id: 'validation',
        name: 'Validation-Based Trust',
        description: 'Trust through independent verification of work',
        requirements: ['Task validation', 'Validator stake or credentials'],
        usedBy: ['MoltValidate']
      },
      {
        id: 'governance',
        name: 'Governance-Based Trust',
        description: 'Trust through community governance and voting',
        requirements: ['DAO participation', 'Voting history'],
        usedBy: ['MoltDAO', 'MoltGov']
      },
      {
        id: 'court',
        name: 'Judicial Trust',
        description: 'Trust through formal dispute resolution',
        requirements: ['Court participation', 'Judge certification'],
        usedBy: ['MoltCourt']
      },
      {
        id: 'cryptographic',
        name: 'Cryptographic Trust',
        description: 'Trust through zkML proofs or TEE attestations',
        requirements: ['Zero-knowledge proofs or Trusted Execution Environment'],
        usedBy: ['MoltValidate (tier 4)']
      }
    ],
    timestamp: new Date().toISOString()
  };
  
  res.json(trustModels);
});

module.exports = router;
