const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

// Data paths
const DATA_DIR = path.join(__dirname, '../../data/fund');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const ROUNDS_FILE = path.join(DATA_DIR, 'rounds.json');
const FUNDS_FILE = path.join(DATA_DIR, 'funds.json');

// Helper functions
async function readJSON(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
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

// ROUNDS ENDPOINTS

router.post('/api/rounds', async (req, res) => {
  try {
    const { name, startDate, endDate, totalPool, fundingBudgetPerAgent } = req.body;
    
    if (!name || !startDate || !endDate || !totalPool) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const rounds = await readJSON(ROUNDS_FILE);
    const newRound = {
      id: Date.now().toString(),
      name,
      startDate,
      endDate,
      totalPool,
      fundingBudgetPerAgent: fundingBudgetPerAgent || 100,
      status: new Date() < new Date(startDate) ? 'upcoming' : 
              new Date() > new Date(endDate) ? 'completed' : 'active',
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
    
    const projectsWithWeights = roundProjects.map(project => {
      const projectFunds = roundFunds.filter(f => f.projectId === project.id);
      const totalContributions = projectFunds.reduce((sum, f) => sum + f.amount, 0);
      const quadraticWeight = calculateQuadraticWeight(projectFunds);
      
      return {
        ...project,
        totalContributions,
        quadraticWeight,
        contributorsCount: projectFunds.length,
        contributions: projectFunds
      };
    });
    
    const totalWeight = projectsWithWeights.reduce((sum, p) => sum + p.quadraticWeight, 0);
    projectsWithWeights.forEach(project => {
      project.matchingAmount = totalWeight > 0 
        ? (project.quadraticWeight / totalWeight) * round.totalPool 
        : 0;
      project.totalFunding = project.totalContributions + project.matchingAmount;
    });
    
    res.json({
      ...round,
      projects: projectsWithWeights.sort((a, b) => b.totalFunding - a.totalFunding)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PROJECTS ENDPOINTS

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
    
    const projects = await readJSON(PROJECTS_FILE);
    const newProject = {
      id: Date.now().toString(),
      title,
      description,
      repoUrl: repoUrl || '',
      category: category || 'general',
      nominatorAgent,
      roundId,
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
    
    const projectsWithFunding = projects.map(project => {
      const projectFunds = funds.filter(f => f.projectId === project.id);
      const totalContributions = projectFunds.reduce((sum, f) => sum + f.amount, 0);
      const quadraticWeight = calculateQuadraticWeight(projectFunds);
      
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
    
    const totalContributions = projectFunds.reduce((sum, f) => sum + f.amount, 0);
    const quadraticWeight = calculateQuadraticWeight(projectFunds);
    
    res.json({
      ...project,
      totalContributions,
      quadraticWeight,
      contributorsCount: projectFunds.length,
      contributions: projectFunds
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

module.exports = router;
