const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

// Data paths
const DATA_DIR = path.join(__dirname, '../../data/fund');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const ROUNDS_FILE = path.join(DATA_DIR, 'rounds.json');
const FUNDS_FILE = path.join(DATA_DIR, 'funds.json');
const GOVERNANCE_FILE = path.join(DATA_DIR, 'governance.json');

// ===== GOVERNANCE CONFIGURATION =====
const DEFAULT_GOVERNANCE = {
  roundCreators: ['admin', 'dao'], // Who can create funding rounds
  minRoundDuration: 7, // days
  maxRoundDuration: 90, // days
  requireApprovalForProjects: false, // Whether projects need approval before appearing
  transparencyEnabled: true, // Show all contributions and allocations
  quadraticFundingEnabled: true
};

// Helper functions
async function readJSON(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    if (filePath === GOVERNANCE_FILE) {
      return { ...DEFAULT_GOVERNANCE };
    }
    return [];
  }
}

async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function calculateQuadraticWeight(contributions) {
  const sqrtSum = contributions.reduce((sum, contrib) => {
    return sum + Math.sqrt(contrib.amount);
  }, 0);
  return Math.pow(sqrtSum, 2);
}

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'moltfund', timestamp: new Date().toISOString() });
});

// Dashboard
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// ===== GOVERNANCE ENDPOINTS =====

router.get('/api/governance', async (req, res) => {
  try {
    const governance = await readJSON(GOVERNANCE_FILE);
    res.json(governance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/governance', async (req, res) => {
  try {
    const { creator } = req.body;
    
    const governance = await readJSON(GOVERNANCE_FILE);
    
    // Only authorized creators can update governance
    if (!governance.roundCreators.includes(creator)) {
      return res.status(403).json({ error: 'Not authorized to update governance' });
    }
    
    const updates = req.body;
    delete updates.creator; // Don't store creator in governance
    
    const newGovernance = { ...governance, ...updates, updatedAt: new Date().toISOString() };
    await writeJSON(GOVERNANCE_FILE, newGovernance);
    
    res.json(newGovernance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== ROUNDS ENDPOINTS =====

router.post('/api/rounds', async (req, res) => {
  try {
    const { name, startDate, endDate, totalPool, fundingBudgetPerAgent, creator } = req.body;
    
    if (!name || !startDate || !endDate || !totalPool || !creator) {
      return res.status(400).json({ error: 'Missing required fields: name, startDate, endDate, totalPool, creator' });
    }
    
    // Check governance permissions
    const governance = await readJSON(GOVERNANCE_FILE);
    if (!governance.roundCreators.includes(creator)) {
      return res.status(403).json({ 
        error: `Not authorized to create rounds. Authorized creators: ${governance.roundCreators.join(', ')}` 
      });
    }
    
    // Validate duration
    const duration = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24);
    if (duration < governance.minRoundDuration || duration > governance.maxRoundDuration) {
      return res.status(400).json({ 
        error: `Round duration must be between ${governance.minRoundDuration} and ${governance.maxRoundDuration} days` 
      });
    }
    
    const rounds = await readJSON(ROUNDS_FILE);
    const newRound = {
      id: Date.now().toString(),
      name,
      startDate,
      endDate,
      totalPool,
      fundingBudgetPerAgent: fundingBudgetPerAgent || 100,
      creator,
      status: new Date() < new Date(startDate) ? 'upcoming' : 
              new Date() > new Date(endDate) ? 'completed' : 'active',
      matchingPoolUsed: 0, // Track how much of the matching pool has been allocated
      createdAt: new Date().toISOString()
    };
    
    rounds.push(newRound);
    await writeJSON(ROUNDS_FILE, rounds);
    
    res.status(201).json(newRound);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/rounds', async (req, res) => {
  try {
    const rounds = await readJSON(ROUNDS_FILE);
    const now = new Date();
    
    // Update round statuses
    rounds.forEach(round => {
      if (now < new Date(round.startDate)) {
        round.status = 'upcoming';
      } else if (now > new Date(round.endDate)) {
        round.status = 'completed';
      } else {
        round.status = 'active';
      }
    });
    
    await writeJSON(ROUNDS_FILE, rounds);
    res.json(rounds);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/rounds/:id', async (req, res) => {
  try {
    const rounds = await readJSON(ROUNDS_FILE);
    const round = rounds.find(r => r.id === req.params.id);
    
    if (!round) {
      return res.status(404).json({ error: 'Round not found' });
    }
    
    const projects = await readJSON(PROJECTS_FILE);
    const roundProjects = projects.filter(p => p.roundId === round.id);
    
    const funds = await readJSON(FUNDS_FILE);
    const roundFunds = funds.filter(f => f.roundId === round.id);
    
    // Calculate matching pool visibility
    const governance = await readJSON(GOVERNANCE_FILE);
    
    const projectsWithWeights = roundProjects.map(project => {
      const projectFunds = roundFunds.filter(f => f.projectId === project.id);
      const totalContributions = projectFunds.reduce((sum, f) => sum + f.amount, 0);
      const quadraticWeight = governance.quadraticFundingEnabled 
        ? calculateQuadraticWeight(projectFunds) 
        : totalContributions;
      
      return {
        ...project,
        totalContributions,
        quadraticWeight,
        contributorsCount: projectFunds.length,
        contributions: governance.transparencyEnabled ? projectFunds : []
      };
    });
    
    const totalWeight = projectsWithWeights.reduce((sum, p) => sum + p.quadraticWeight, 0);
    
    // Calculate matching amounts
    projectsWithWeights.forEach(project => {
      project.matchingAmount = totalWeight > 0 
        ? (project.quadraticWeight / totalWeight) * round.totalPool 
        : 0;
      project.totalFunding = project.totalContributions + project.matchingAmount;
    });
    
    // Calculate matching pool stats
    const totalMatchingAllocated = projectsWithWeights.reduce((sum, p) => sum + p.matchingAmount, 0);
    const matchingPoolRemaining = round.totalPool - totalMatchingAllocated;
    
    res.json({
      ...round,
      projects: projectsWithWeights.sort((a, b) => b.totalFunding - a.totalFunding),
      matchingPool: {
        total: round.totalPool,
        allocated: totalMatchingAllocated,
        remaining: matchingPoolRemaining,
        utilizationPercent: (totalMatchingAllocated / round.totalPool * 100).toFixed(1)
      },
      governance
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get matching pool transparency for a round
router.get('/api/rounds/:id/matching-pool', async (req, res) => {
  try {
    const rounds = await readJSON(ROUNDS_FILE);
    const round = rounds.find(r => r.id === req.params.id);
    
    if (!round) {
      return res.status(404).json({ error: 'Round not found' });
    }
    
    const projects = await readJSON(PROJECTS_FILE);
    const roundProjects = projects.filter(p => p.roundId === round.id);
    
    const funds = await readJSON(FUNDS_FILE);
    const roundFunds = funds.filter(f => f.roundId === round.id);
    
    const governance = await readJSON(GOVERNANCE_FILE);
    
    const allocations = roundProjects.map(project => {
      const projectFunds = roundFunds.filter(f => f.projectId === project.id);
      const totalContributions = projectFunds.reduce((sum, f) => sum + f.amount, 0);
      const quadraticWeight = governance.quadraticFundingEnabled 
        ? calculateQuadraticWeight(projectFunds) 
        : totalContributions;
      
      return {
        projectId: project.id,
        projectTitle: project.title,
        contributions: totalContributions,
        contributors: projectFunds.length,
        quadraticWeight
      };
    });
    
    const totalWeight = allocations.reduce((sum, a) => sum + a.quadraticWeight, 0);
    
    allocations.forEach(a => {
      a.matchingAmount = totalWeight > 0 ? (a.quadraticWeight / totalWeight) * round.totalPool : 0;
      a.matchingPercent = totalWeight > 0 ? (a.quadraticWeight / totalWeight * 100).toFixed(2) : 0;
    });
    
    const totalMatchingAllocated = allocations.reduce((sum, a) => sum + a.matchingAmount, 0);
    
    res.json({
      roundId: round.id,
      roundName: round.name,
      totalPool: round.totalPool,
      totalAllocated: totalMatchingAllocated,
      remaining: round.totalPool - totalMatchingAllocated,
      allocations: allocations.sort((a, b) => b.matchingAmount - a.matchingAmount)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get funding allocation transparency - where did the money go?
router.get('/api/rounds/:id/allocations', async (req, res) => {
  try {
    const rounds = await readJSON(ROUNDS_FILE);
    const round = rounds.find(r => r.id === req.params.id);
    
    if (!round) {
      return res.status(404).json({ error: 'Round not found' });
    }
    
    const projects = await readJSON(PROJECTS_FILE);
    const funds = await readJSON(FUNDS_FILE);
    const roundFunds = funds.filter(f => f.roundId === round.id);
    
    // Group by project
    const projectAllocations = {};
    
    roundFunds.forEach(fund => {
      if (!projectAllocations[fund.projectId]) {
        const project = projects.find(p => p.id === fund.projectId);
        projectAllocations[fund.projectId] = {
          projectId: fund.projectId,
          projectTitle: project ? project.title : 'Unknown',
          contributions: [],
          totalAmount: 0
        };
      }
      
      projectAllocations[fund.projectId].contributions.push({
        agent: fund.agentName,
        amount: fund.amount,
        timestamp: fund.createdAt
      });
      projectAllocations[fund.projectId].totalAmount += fund.amount;
    });
    
    const allocations = Object.values(projectAllocations);
    
    res.json({
      roundId: round.id,
      roundName: round.name,
      totalContributions: roundFunds.reduce((sum, f) => sum + f.amount, 0),
      projectCount: allocations.length,
      contributorCount: new Set(roundFunds.map(f => f.agentName)).size,
      allocations: allocations.sort((a, b) => b.totalAmount - a.totalAmount)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== PROJECTS ENDPOINTS =====

router.post('/api/projects', async (req, res) => {
  try {
    const { title, description, repoUrl, category, nominatorAgent, roundId } = req.body;
    
    if (!title || !description || !nominatorAgent || !roundId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const rounds = await readJSON(ROUNDS_FILE);
    const round = rounds.find(r => r.id === roundId);
    if (!round) {
      return res.status(400).json({ error: 'Round not found' });
    }
    
    const governance = await readJSON(GOVERNANCE_FILE);
    
    const projects = await readJSON(PROJECTS_FILE);
    const newProject = {
      id: Date.now().toString(),
      title,
      description,
      repoUrl: repoUrl || '',
      category: category || 'general',
      nominatorAgent,
      roundId,
      status: governance.requireApprovalForProjects ? 'pending' : 'approved',
      createdAt: new Date().toISOString()
    };
    
    projects.push(newProject);
    await writeJSON(PROJECTS_FILE, projects);
    
    res.status(201).json(newProject);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/projects', async (req, res) => {
  try {
    const projects = await readJSON(PROJECTS_FILE);
    const funds = await readJSON(FUNDS_FILE);
    const governance = await readJSON(GOVERNANCE_FILE);
    
    const projectsWithFunding = projects.map(project => {
      const projectFunds = funds.filter(f => f.projectId === project.id);
      const totalContributions = projectFunds.reduce((sum, f) => sum + f.amount, 0);
      const quadraticWeight = governance.quadraticFundingEnabled 
        ? calculateQuadraticWeight(projectFunds) 
        : totalContributions;
      
      return {
        ...project,
        totalContributions,
        quadraticWeight,
        contributorsCount: projectFunds.length
      };
    });
    
    res.json(projectsWithFunding);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/projects/:id', async (req, res) => {
  try {
    const projects = await readJSON(PROJECTS_FILE);
    const project = projects.find(p => p.id === req.params.id);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const funds = await readJSON(FUNDS_FILE);
    const projectFunds = funds.filter(f => f.projectId === project.id);
    
    const governance = await readJSON(GOVERNANCE_FILE);
    
    const totalContributions = projectFunds.reduce((sum, f) => sum + f.amount, 0);
    const quadraticWeight = governance.quadraticFundingEnabled 
      ? calculateQuadraticWeight(projectFunds) 
      : totalContributions;
    
    // Calculate matching if in a round
    let matchingAmount = 0;
    if (project.roundId) {
      const rounds = await readJSON(ROUNDS_FILE);
      const round = rounds.find(r => r.id === project.roundId);
      if (round) {
        const roundProjects = projects.filter(p => p.roundId === round.id);
        const roundFunds = funds.filter(f => f.roundId === round.id);
        
        const weights = roundProjects.map(p => {
          const pFunds = roundFunds.filter(f => f.projectId === p.id);
          return governance.quadraticFundingEnabled 
            ? calculateQuadraticWeight(pFunds) 
            : pFunds.reduce((sum, f) => sum + f.amount, 0);
        });
        
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        matchingAmount = totalWeight > 0 ? (quadraticWeight / totalWeight) * round.totalPool : 0;
      }
    }
    
    res.json({
      ...project,
      totalContributions,
      quadraticWeight,
      matchingAmount,
      totalFunding: totalContributions + matchingAmount,
      contributorsCount: projectFunds.length,
      contributions: governance.transparencyEnabled ? projectFunds : []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/projects/:id/fund', async (req, res) => {
  try {
    const { agentName, amount } = req.body;
    const projectId = req.params.id;
    
    if (!agentName || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid funding request' });
    }
    
    const projects = await readJSON(PROJECTS_FILE);
    const project = projects.find(p => p.id === projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const rounds = await readJSON(ROUNDS_FILE);
    const round = rounds.find(r => r.id === project.roundId);
    if (!round) {
      return res.status(400).json({ error: 'Round not found' });
    }
    
    const now = new Date();
    if (now < new Date(round.startDate) || now > new Date(round.endDate)) {
      return res.status(400).json({ error: 'Round is not active' });
    }
    
    const funds = await readJSON(FUNDS_FILE);
    const agentSpending = funds
      .filter(f => f.roundId === round.id && f.agentName === agentName)
      .reduce((sum, f) => sum + f.amount, 0);
    
    if (agentSpending + amount > round.fundingBudgetPerAgent) {
      return res.status(400).json({ 
        error: `Budget exceeded. You have ${round.fundingBudgetPerAgent - agentSpending} points remaining.` 
      });
    }
    
    const newFund = {
      id: Date.now().toString(),
      projectId,
      roundId: round.id,
      agentName,
      amount,
      createdAt: new Date().toISOString()
    };
    
    funds.push(newFund);
    await writeJSON(FUNDS_FILE, funds);
    
    res.status(201).json(newFund);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get agent's contribution history
router.get('/api/agents/:agentName/contributions', async (req, res) => {
  try {
    const agentName = req.params.agentName;
    const funds = await readJSON(FUNDS_FILE);
    const projects = await readJSON(PROJECTS_FILE);
    const rounds = await readJSON(ROUNDS_FILE);
    
    const agentFunds = funds.filter(f => f.agentName === agentName);
    
    const contributions = agentFunds.map(fund => {
      const project = projects.find(p => p.id === fund.projectId);
      const round = rounds.find(r => r.id === fund.roundId);
      
      return {
        ...fund,
        projectTitle: project ? project.title : 'Unknown',
        roundName: round ? round.name : 'Unknown'
      };
    });
    
    const totalContributed = agentFunds.reduce((sum, f) => sum + f.amount, 0);
    const roundsParticipated = new Set(agentFunds.map(f => f.roundId)).size;
    const projectsSupported = new Set(agentFunds.map(f => f.projectId)).size;
    
    res.json({
      agentName,
      totalContributed,
      roundsParticipated,
      projectsSupported,
      contributions: contributions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
