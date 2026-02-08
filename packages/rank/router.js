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
  
  // Update reputation graph
  updateReputationGraph(interaction);
  
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
  
  // Update reputation graph
  updateReputationGraph({ type: 'vouch', from: vouch.from, to: vouch.for });
  
  return vouches[vouches.length - 1];
}

// --- Reputation Graph ---
function updateReputationGraph(event) {
  let graph = loadJSON('reputation_graph') || { nodes: {}, edges: [] };
  
  // Add nodes
  const agents = event.agent1 && event.agent2 ? [event.agent1, event.agent2] : 
                 event.from && event.to ? [event.from, event.to] : [];
  
  agents.forEach(agent => {
    if (!graph.nodes[agent]) {
      graph.nodes[agent] = { name: agent, karma: 0, interactions: 0 };
    }
  });
  
  // Add edge
  if (agents.length === 2) {
    graph.edges.push({
      from: agents[0],
      to: agents[1],
      type: event.type || 'interaction',
      timestamp: event.timestamp || new Date().toISOString(),
      weight: 1
    });
    
    // Update interaction counts
    graph.nodes[agents[0]].interactions++;
    graph.nodes[agents[1]].interactions++;
  }
  
  saveJSON('reputation_graph', graph);
}

function getReputationGraph() {
  let graph = loadJSON('reputation_graph');
  if (!graph) {
    // Initialize from existing data
    const { interactions, vouches } = getTrustData();
    const graphInteractions = loadJSON('graph-interactions') || [];
    graph = { nodes: {}, edges: [] };
    
    // Add legacy interactions
    interactions.forEach(i => {
      if (!graph.nodes[i.agent1]) graph.nodes[i.agent1] = { name: i.agent1, karma: 0, interactions: 0 };
      if (!graph.nodes[i.agent2]) graph.nodes[i.agent2] = { name: i.agent2, karma: 0, interactions: 0 };
      
      graph.edges.push({
        from: i.agent1,
        to: i.agent2,
        type: i.type || 'interaction',
        timestamp: i.timestamp,
        weight: i.outcome === 'success' ? 1 : 0.5
      });
      
      graph.nodes[i.agent1].interactions++;
      graph.nodes[i.agent2].interactions++;
    });
    
    // Add graph-interactions.json data
    graphInteractions.forEach(gi => {
      if (!graph.nodes[gi.sourceAgent]) {
        graph.nodes[gi.sourceAgent] = { name: gi.sourceAgent, karma: 0, interactions: 0 };
      }
      if (!graph.nodes[gi.targetAgent]) {
        graph.nodes[gi.targetAgent] = { name: gi.targetAgent, karma: 0, interactions: 0 };
      }
      
      graph.edges.push({
        from: gi.sourceAgent,
        to: gi.targetAgent,
        type: gi.interactionType || 'collaboration',
        timestamp: gi.timestamp,
        weight: gi.weight || 1
      });
      
      graph.nodes[gi.sourceAgent].interactions++;
      graph.nodes[gi.targetAgent].interactions++;
    });
    
    vouches.forEach(v => {
      if (!graph.nodes[v.from]) graph.nodes[v.from] = { name: v.from, karma: 0, interactions: 0 };
      if (!graph.nodes[v.for]) graph.nodes[v.for] = { name: v.for, karma: 0, interactions: 0 };
      
      graph.edges.push({
        from: v.from,
        to: v.for,
        type: 'vouch',
        timestamp: v.timestamp,
        weight: 2
      });
    });
    
    // Fetch karma from lastScores if available
    if (lastScores && lastScores.rankings) {
      lastScores.rankings.forEach(agent => {
        if (graph.nodes[agent.name]) {
          graph.nodes[agent.name].karma = agent.karma || 0;
        }
      });
    }
    
    saveJSON('reputation_graph', graph);
  }
  
  return graph;
}

// --- PageRank Algorithm ---
function computePageRank(graph, dampingFactor = 0.85, maxIterations = 100, tolerance = 1e-6) {
  const nodes = Object.keys(graph.nodes);
  const n = nodes.length;
  
  if (n === 0) return {};
  
  // Initialize PageRank scores
  let pagerank = {};
  let newPagerank = {};
  nodes.forEach(node => {
    pagerank[node] = 1.0 / n;
    newPagerank[node] = 0;
  });
  
  // Build outgoing edges map with weights
  const outEdges = {};
  const inEdges = {};
  nodes.forEach(node => {
    outEdges[node] = [];
    inEdges[node] = [];
  });
  
  graph.edges.forEach(edge => {
    outEdges[edge.from].push({ to: edge.to, weight: edge.weight || 1 });
    inEdges[edge.to].push({ from: edge.from, weight: edge.weight || 1 });
  });
  
  // Calculate total outgoing weight for each node
  const totalOutWeight = {};
  nodes.forEach(node => {
    totalOutWeight[node] = outEdges[node].reduce((sum, e) => sum + e.weight, 0);
  });
  
  // Iterative PageRank
  for (let iter = 0; iter < maxIterations; iter++) {
    let diff = 0;
    
    nodes.forEach(node => {
      let sum = 0;
      inEdges[node].forEach(edge => {
        const from = edge.from;
        const weight = edge.weight;
        if (totalOutWeight[from] > 0) {
          sum += (pagerank[from] * weight) / totalOutWeight[from];
        }
      });
      
      newPagerank[node] = (1 - dampingFactor) / n + dampingFactor * sum;
      diff += Math.abs(newPagerank[node] - pagerank[node]);
    });
    
    // Swap
    [pagerank, newPagerank] = [newPagerank, pagerank];
    
    if (diff < tolerance) break;
  }
  
  // Normalize to 0-100 scale
  const maxPR = Math.max(...Object.values(pagerank));
  const normalized = {};
  nodes.forEach(node => {
    normalized[node] = maxPR > 0 ? (pagerank[node] / maxPR) * 100 : 0;
  });
  
  return normalized;
}

// --- Weighted Reputation Score ---
function computeWeightedReputation(graph, pagerank) {
  const reputation = {};
  
  Object.keys(graph.nodes).forEach(node => {
    const karma = graph.nodes[node].karma || 0;
    const pr = pagerank[node] || 0;
    const interactions = graph.nodes[node].interactions || 0;
    
    // Weighted score: 40% karma, 40% PageRank, 20% interaction count
    reputation[node] = {
      name: node,
      karma,
      pagerank: Math.round(pr * 100) / 100,
      interactions,
      weightedScore: Math.round(karma * 0.4 + pr * 0.4 + interactions * 2)
    };
  });
  
  return reputation;
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

// --- Graph-Based Reputation Endpoints ---

router.get('/api/graph', (req, res) => {
  try {
    const graph = getReputationGraph();
    const pagerank = computePageRank(graph);
    const reputation = computeWeightedReputation(graph, pagerank);
    
    res.json({
      nodes: Object.values(reputation),
      edges: graph.edges,
      metadata: {
        nodeCount: Object.keys(graph.nodes).length,
        edgeCount: graph.edges.length,
        computedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/graph/:agent', (req, res) => {
  try {
    const agentName = req.params.agent;
    const graph = getReputationGraph();
    
    if (!graph.nodes[agentName]) {
      return res.status(404).json({ error: 'Agent not found in reputation graph' });
    }
    
    // Get neighborhood (1-hop connections)
    const incomingEdges = graph.edges.filter(e => e.to === agentName);
    const outgoingEdges = graph.edges.filter(e => e.from === agentName);
    const neighbors = new Set();
    
    incomingEdges.forEach(e => neighbors.add(e.from));
    outgoingEdges.forEach(e => neighbors.add(e.to));
    
    const pagerank = computePageRank(graph);
    const agentPR = pagerank[agentName] || 0;
    
    res.json({
      agent: agentName,
      pagerank: Math.round(agentPR * 100) / 100,
      karma: graph.nodes[agentName].karma,
      interactions: graph.nodes[agentName].interactions,
      neighborhood: {
        neighbors: Array.from(neighbors),
        incomingEdges: incomingEdges.length,
        outgoingEdges: outgoingEdges.length,
        edges: [...incomingEdges, ...outgoingEdges]
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/pagerank', (req, res) => {
  try {
    const graph = getReputationGraph();
    const pagerank = computePageRank(graph);
    const reputation = computeWeightedReputation(graph, pagerank);
    
    // Sort by PageRank score
    const leaderboard = Object.values(reputation)
      .sort((a, b) => b.pagerank - a.pagerank)
      .map((agent, index) => ({
        rank: index + 1,
        ...agent
      }));
    
    res.json({
      leaderboard,
      metadata: {
        algorithm: 'PageRank',
        dampingFactor: 0.85,
        totalAgents: leaderboard.length,
        computedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

// --- Graph Interaction Endpoints ---

router.post('/api/graph/interact', (req, res) => {
  const { sourceAgent, targetAgent, interactionType, weight, metadata } = req.body;
  
  if (!sourceAgent || !targetAgent) {
    return res.status(400).json({ error: 'sourceAgent and targetAgent are required' });
  }
  
  // Load existing graph interactions
  let graphInteractions = loadJSON('graph-interactions') || [];
  
  // Create new interaction
  const interaction = {
    id: `gint_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    sourceAgent,
    targetAgent,
    interactionType: interactionType || 'collaboration',
    weight: weight || 1,
    metadata: metadata || {},
    timestamp: new Date().toISOString()
  };
  
  // Store in graph-interactions.json
  graphInteractions.push(interaction);
  saveJSON('graph-interactions', graphInteractions);
  
  // Update the reputation graph for PageRank
  updateReputationGraph({
    agent1: sourceAgent,
    agent2: targetAgent,
    type: interactionType || 'collaboration',
    timestamp: interaction.timestamp,
    weight: weight || 1
  });
  
  res.status(201).json({
    success: true,
    interaction
  });
});

router.get('/api/graph/interactions', (req, res) => {
  try {
    const { agent, type, since, limit } = req.query;
    
    // Load all graph interactions
    let interactions = loadJSON('graph-interactions') || [];
    
    // Apply filters
    if (agent) {
      const agentLower = agent.toLowerCase();
      interactions = interactions.filter(i => 
        i.sourceAgent.toLowerCase() === agentLower || 
        i.targetAgent.toLowerCase() === agentLower
      );
    }
    
    if (type) {
      interactions = interactions.filter(i => i.interactionType === type);
    }
    
    if (since) {
      const sinceDate = new Date(since);
      interactions = interactions.filter(i => new Date(i.timestamp) >= sinceDate);
    }
    
    // Sort by timestamp (newest first)
    interactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Apply limit
    if (limit) {
      const limitNum = parseInt(limit, 10);
      interactions = interactions.slice(0, limitNum);
    }
    
    res.json({
      total: interactions.length,
      interactions,
      filters: { agent, type, since, limit }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

// Serve static files from public directory
router.use(express.static(path.join(__dirname, 'public')));

module.exports = router;
