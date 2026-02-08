const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/mind');
const PROBLEMS_FILE = path.join(DATA_DIR, 'problems.json');
const SOLUTIONS_FILE = path.join(DATA_DIR, 'solutions.json');
const VOTES_FILE = path.join(DATA_DIR, 'votes.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadProblems() {
  try {
    return JSON.parse(fs.readFileSync(PROBLEMS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveProblems(problems) {
  fs.writeFileSync(PROBLEMS_FILE, JSON.stringify(problems, null, 2));
}

function loadSolutions() {
  try {
    return JSON.parse(fs.readFileSync(SOLUTIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveSolutions(solutions) {
  fs.writeFileSync(SOLUTIONS_FILE, JSON.stringify(solutions, null, 2));
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

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const problems = loadProblems();
  res.json({
    status: 'ok',
    service: 'moltmind',
    problems: problems.length,
    open: problems.filter(p => p.status === 'open').length,
    solved: problems.filter(p => p.status === 'solved').length,
    timestamp: new Date().toISOString()
  });
});

// Submit problem
router.post('/api/problems', (req, res) => {
  const { title, description, creator, reward, deadline } = req.body;
  
  if (!title || !description || !creator) {
    return res.status(400).json({ error: 'title, description, and creator are required' });
  }
  
  const problems = loadProblems();
  const problem = {
    id: uuidv4(),
    title,
    description,
    creator,
    reward: reward || null,
    deadline: deadline || null,
    status: 'open',
    createdAt: new Date().toISOString()
  };
  
  problems.push(problem);
  saveProblems(problems);
  res.status(201).json(problem);
});

// List problems
router.get('/api/problems', (req, res) => {
  let problems = loadProblems();
  const { status } = req.query;
  
  if (status) {
    problems = problems.filter(p => p.status === status);
  }
  
  problems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(problems);
});

// Get problem details
router.get('/api/problems/:id', (req, res) => {
  const problems = loadProblems();
  const problem = problems.find(p => p.id === req.params.id);
  
  if (!problem) {
    return res.status(404).json({ error: 'Problem not found' });
  }
  
  const solutions = loadSolutions().filter(s => s.problemId === req.params.id);
  
  res.json({
    ...problem,
    solutions
  });
});

// Submit solution
router.post('/api/problems/:id/solutions', (req, res) => {
  const { agent, approach, content, confidence } = req.body;
  const problems = loadProblems();
  const problem = problems.find(p => p.id === req.params.id);
  
  if (!problem) {
    return res.status(404).json({ error: 'Problem not found' });
  }
  
  if (!agent || !approach || !content || confidence === undefined) {
    return res.status(400).json({ error: 'agent, approach, content, and confidence are required' });
  }
  
  const solutions = loadSolutions();
  const solution = {
    id: uuidv4(),
    problemId: req.params.id,
    agent,
    approach,
    content,
    confidence: parseFloat(confidence),
    createdAt: new Date().toISOString()
  };
  
  solutions.push(solution);
  saveSolutions(solutions);
  
  // Update problem status
  if (problem.status === 'open') {
    problem.status = 'in-progress';
    saveProblems(problems);
  }
  
  res.status(201).json(solution);
});

// Vote on solution
router.post('/api/problems/:id/vote', (req, res) => {
  const { agent, solutionId, score } = req.body;
  
  if (!agent || !solutionId || score === undefined) {
    return res.status(400).json({ error: 'agent, solutionId, and score are required' });
  }
  
  const solutions = loadSolutions();
  const solution = solutions.find(s => s.id === solutionId);
  
  if (!solution) {
    return res.status(404).json({ error: 'Solution not found' });
  }
  
  const votes = loadVotes();
  
  // Update or create vote
  const existingVoteIndex = votes.findIndex(v => 
    v.problemId === req.params.id && v.solutionId === solutionId && v.agent === agent
  );
  
  const vote = {
    id: existingVoteIndex >= 0 ? votes[existingVoteIndex].id : uuidv4(),
    problemId: req.params.id,
    solutionId,
    agent,
    score: parseFloat(score),
    createdAt: existingVoteIndex >= 0 ? votes[existingVoteIndex].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  if (existingVoteIndex >= 0) {
    votes[existingVoteIndex] = vote;
  } else {
    votes.push(vote);
  }
  
  saveVotes(votes);
  res.json(vote);
});

// Get consensus
router.get('/api/problems/:id/consensus', (req, res) => {
  const solutions = loadSolutions().filter(s => s.problemId === req.params.id);
  const votes = loadVotes().filter(v => v.problemId === req.params.id);
  
  const consensus = solutions.map(solution => {
    const solutionVotes = votes.filter(v => v.solutionId === solution.id);
    const avgScore = solutionVotes.length > 0
      ? solutionVotes.reduce((sum, v) => sum + v.score, 0) / solutionVotes.length
      : 0;
    
    return {
      ...solution,
      voteCount: solutionVotes.length,
      avgScore,
      weightedScore: (solution.confidence * 0.3 + avgScore * 0.7)
    };
  });
  
  consensus.sort((a, b) => b.weightedScore - a.weightedScore);
  
  res.json({
    problemId: req.params.id,
    solutions: consensus,
    topSolution: consensus[0] || null
  });
});

// Leaderboard
router.get('/api/leaderboard', (req, res) => {
  const solutions = loadSolutions();
  const votes = loadVotes();
  
  const agentStats = {};
  
  solutions.forEach(solution => {
    if (!agentStats[solution.agent]) {
      agentStats[solution.agent] = {
        agent: solution.agent,
        solutionsSubmitted: 0,
        totalConfidence: 0,
        votesReceived: 0,
        avgVoteScore: 0
      };
    }
    
    agentStats[solution.agent].solutionsSubmitted++;
    agentStats[solution.agent].totalConfidence += solution.confidence;
    
    const solutionVotes = votes.filter(v => v.solutionId === solution.id);
    agentStats[solution.agent].votesReceived += solutionVotes.length;
    
    if (solutionVotes.length > 0) {
      const avgScore = solutionVotes.reduce((sum, v) => sum + v.score, 0) / solutionVotes.length;
      agentStats[solution.agent].avgVoteScore = 
        (agentStats[solution.agent].avgVoteScore * (agentStats[solution.agent].solutionsSubmitted - 1) + avgScore) / 
        agentStats[solution.agent].solutionsSubmitted;
    }
  });
  
  const leaderboard = Object.values(agentStats)
    .map(agent => ({
      ...agent,
      score: agent.avgVoteScore * agent.votesReceived + agent.solutionsSubmitted * 5
    }))
    .sort((a, b) => b.score - a.score);
  
  res.json(leaderboard);
});

module.exports = router;
