const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/graph');
const CONNECTIONS_FILE = path.join(DATA_DIR, 'connections.json');
const VOUCHES_FILE = path.join(DATA_DIR, 'vouches.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper functions for data persistence
function loadConnections() {
  try {
    return JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveConnections(connections) {
  fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify(connections, null, 2));
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

// Get all unique agents in the graph
function getAllAgents() {
  const connections = loadConnections();
  const agents = new Set();
  connections.forEach(conn => {
    agents.add(conn.agentId);
    agents.add(conn.targetId);
  });
  return Array.from(agents);
}

// Get all connections for an agent
function getAgentConnections(agentId) {
  const connections = loadConnections();
  return connections.filter(conn => 
    conn.agentId.toLowerCase() === agentId.toLowerCase() ||
    conn.targetId.toLowerCase() === agentId.toLowerCase()
  );
}

// Check if connection exists
function connectionExists(agentId, targetId, type) {
  const connections = loadConnections();
  return connections.some(conn =>
    ((conn.agentId.toLowerCase() === agentId.toLowerCase() && 
      conn.targetId.toLowerCase() === targetId.toLowerCase()) ||
     (conn.agentId.toLowerCase() === targetId.toLowerCase() && 
      conn.targetId.toLowerCase() === agentId.toLowerCase())) &&
    conn.type === type
  );
}

// Build adjacency list for graph algorithms
function buildGraph() {
  const connections = loadConnections();
  const graph = {};
  
  connections.forEach(conn => {
    const agent1 = conn.agentId.toLowerCase();
    const agent2 = conn.targetId.toLowerCase();
    
    if (!graph[agent1]) graph[agent1] = [];
    if (!graph[agent2]) graph[agent2] = [];
    
    // For mutual connections and collaborators, treat as bidirectional
    if (conn.type === 'connection' || conn.type === 'collaborator') {
      graph[agent1].push({ agent: agent2, type: conn.type, strength: conn.strength });
      graph[agent2].push({ agent: agent1, type: conn.type, strength: conn.strength });
    } else if (conn.type === 'follow') {
      // Follow is one-way
      graph[agent1].push({ agent: agent2, type: conn.type, strength: conn.strength });
    }
  });
  
  return graph;
}

// Find shortest path using BFS
function findShortestPath(fromAgent, toAgent) {
  const graph = buildGraph();
  const from = fromAgent.toLowerCase();
  const to = toAgent.toLowerCase();
  
  if (from === to) return [from];
  if (!graph[from] || !graph[to]) return null;
  
  const queue = [[from]];
  const visited = new Set([from]);
  
  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    
    const neighbors = graph[current] || [];
    for (const neighbor of neighbors) {
      if (neighbor.agent === to) {
        return [...path, to];
      }
      
      if (!visited.has(neighbor.agent)) {
        visited.add(neighbor.agent);
        queue.push([...path, neighbor.agent]);
      }
    }
  }
  
  return null;
}

// Find mutual connections between two agents
function findMutualConnections(agent1, agent2) {
  const connections1 = getAgentConnections(agent1);
  const connections2 = getAgentConnections(agent2);
  
  const network1 = new Set();
  connections1.forEach(conn => {
    if (conn.agentId.toLowerCase() === agent1.toLowerCase()) {
      network1.add(conn.targetId.toLowerCase());
    } else {
      network1.add(conn.agentId.toLowerCase());
    }
  });
  
  const mutuals = [];
  connections2.forEach(conn => {
    const other = conn.agentId.toLowerCase() === agent2.toLowerCase() 
      ? conn.targetId.toLowerCase() 
      : conn.agentId.toLowerCase();
    
    if (network1.has(other) && other !== agent1.toLowerCase() && other !== agent2.toLowerCase()) {
      mutuals.push(other);
    }
  });
  
  return [...new Set(mutuals)];
}

// Get recommendations for an agent
function getRecommendations(agentId) {
  const connections = loadConnections();
  const vouches = loadVouches();
  const graph = buildGraph();
  const agent = agentId.toLowerCase();
  
  // Get direct connections
  const directConnections = new Set();
  (graph[agent] || []).forEach(neighbor => {
    directConnections.add(neighbor.agent);
  });
  
  // Find 2nd degree connections (friends of friends)
  const recommendations = new Map(); // agent -> { score, reasons[] }
  
  for (const neighbor of directConnections) {
    const secondDegree = graph[neighbor] || [];
    
    for (const candidate of secondDegree) {
      const candidateAgent = candidate.agent;
      
      // Skip self and existing connections
      if (candidateAgent === agent || directConnections.has(candidateAgent)) {
        continue;
      }
      
      if (!recommendations.has(candidateAgent)) {
        recommendations.set(candidateAgent, { score: 0, reasons: [] });
      }
      
      const rec = recommendations.get(candidateAgent);
      
      // Weight by connection strength
      const weight = candidate.strength || 0.5;
      rec.score += weight;
      rec.reasons.push(`Connected to ${neighbor}`);
    }
  }
  
  // Add vouch-based recommendations
  const agentVouches = vouches.filter(v => v.voucherId.toLowerCase() === agent);
  agentVouches.forEach(vouch => {
    const vouchedAgent = vouch.targetId.toLowerCase();
    if (!directConnections.has(vouchedAgent) && vouchedAgent !== agent) {
      if (!recommendations.has(vouchedAgent)) {
        recommendations.set(vouchedAgent, { score: 0, reasons: [] });
      }
      const rec = recommendations.get(vouchedAgent);
      rec.score += 2; // Vouches are strong signals
      rec.reasons.push(`Vouched by you`);
    }
  });
  
  // Find mutual connections for each recommendation
  const results = [];
  for (const [candidateAgent, data] of recommendations.entries()) {
    const mutuals = findMutualConnections(agent, candidateAgent);
    if (mutuals.length > 0) {
      data.score += mutuals.length * 0.5;
      data.reasons.push(`${mutuals.length} mutual connection${mutuals.length > 1 ? 's' : ''}`);
    }
    
    results.push({
      agent: candidateAgent,
      score: data.score,
      reasons: [...new Set(data.reasons)].slice(0, 3) // Top 3 reasons
    });
  }
  
  // Sort by score and return top recommendations
  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}

// Calculate trust score for an agent
function calculateTrustScore(agentId) {
  const vouches = loadVouches();
  const connections = getAgentConnections(agentId);
  const graph = buildGraph();
  const agent = agentId.toLowerCase();
  
  // Count vouches received
  const receivedVouches = vouches.filter(v => 
    v.targetId.toLowerCase() === agent
  );
  
  // Count strong connections (collaborators, high strength)
  const strongConnections = connections.filter(conn => {
    return (conn.type === 'collaborator' || conn.strength >= 0.7);
  });
  
  // Calculate network position (centrality approximation)
  const directConnections = (graph[agent] || []).length;
  const allAgents = getAllAgents().length;
  const centrality = allAgents > 1 ? directConnections / (allAgents - 1) : 0;
  
  // Trust score formula:
  // - Vouches: 20 points each (max 5 vouches counted)
  // - Strong connections: 10 points each (max 10 counted)
  // - Network centrality: up to 50 points
  const vouchScore = Math.min(receivedVouches.length, 5) * 20;
  const connectionScore = Math.min(strongConnections.length, 10) * 10;
  const centralityScore = centrality * 50;
  
  const totalScore = vouchScore + connectionScore + centralityScore;
  const normalizedScore = Math.min(totalScore / 200, 1); // Normalize to 0-1
  
  return {
    score: parseFloat(normalizedScore.toFixed(3)),
    vouchCount: receivedVouches.length,
    strongConnections: strongConnections.length,
    centrality: parseFloat(centrality.toFixed(3)),
    breakdown: {
      vouches: vouchScore,
      connections: connectionScore,
      centrality: parseFloat(centralityScore.toFixed(1))
    }
  };
}

// Detect communities/clusters using simple connected components
function detectClusters() {
  const graph = buildGraph();
  const agents = getAllAgents().map(a => a.toLowerCase());
  const visited = new Set();
  const clusters = [];
  
  for (const agent of agents) {
    if (visited.has(agent)) continue;
    
    const cluster = [];
    const queue = [agent];
    visited.add(agent);
    
    while (queue.length > 0) {
      const current = queue.shift();
      cluster.push(current);
      
      const neighbors = graph[current] || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.agent)) {
          visited.add(neighbor.agent);
          queue.push(neighbor.agent);
        }
      }
    }
    
    clusters.push(cluster);
  }
  
  return clusters.sort((a, b) => b.length - a.length);
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const connections = loadConnections();
  const agents = getAllAgents();
  
  res.json({
    status: 'ok',
    service: 'moltgraph',
    version: '2.0',
    agents: agents.length,
    connections: connections.length,
    timestamp: new Date().toISOString()
  });
});

// Create a connection
router.post('/api/connections', (req, res) => {
  const { agentId, targetId, type, metadata, notes, howMet, sharedProjects } = req.body;
  
  if (!agentId || !targetId) {
    return res.status(400).json({ error: 'agentId and targetId are required' });
  }
  
  if (agentId.toLowerCase() === targetId.toLowerCase()) {
    return res.status(400).json({ error: 'Cannot connect an agent to itself' });
  }
  
  const validTypes = ['follow', 'connection', 'collaborator', 'vouched'];
  const connectionType = type || 'follow';
  
  if (!validTypes.includes(connectionType)) {
    return res.status(400).json({ 
      error: `type must be one of: ${validTypes.join(', ')}` 
    });
  }
  
  // Check for duplicate
  if (connectionExists(agentId, targetId, connectionType)) {
    return res.status(409).json({ error: 'Connection already exists' });
  }
  
  const connection = {
    id: uuidv4(),
    agentId,
    targetId,
    type: connectionType,
    strength: 0.5, // Initial strength
    metadata: metadata || {},
    notes: notes || '',
    howMet: howMet || '',
    sharedProjects: sharedProjects || [],
    timestamp: new Date().toISOString(),
    lastInteraction: new Date().toISOString()
  };
  
  const connections = loadConnections();
  connections.push(connection);
  saveConnections(connections);
  
  res.status(201).json(connection);
});

// Get all connections for an agent
router.get('/api/connections/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  const connections = getAgentConnections(agentId);
  
  // Organize by type
  const organized = {
    agentId,
    total: connections.length,
    byType: {
      follow: connections.filter(c => c.type === 'follow'),
      connection: connections.filter(c => c.type === 'connection'),
      collaborator: connections.filter(c => c.type === 'collaborator'),
      vouched: connections.filter(c => c.type === 'vouched')
    },
    connections
  };
  
  res.json(organized);
});

// Find mutual connections
router.get('/api/mutual/:agent1/:agent2', (req, res) => {
  const { agent1, agent2 } = req.params;
  const mutuals = findMutualConnections(agent1, agent2);
  
  res.json({
    agent1,
    agent2,
    count: mutuals.length,
    mutualConnections: mutuals
  });
});

// Find shortest path
router.get('/api/path/:from/:to', (req, res) => {
  const { from, to } = req.params;
  const path = findShortestPath(from, to);
  
  if (!path) {
    return res.status(404).json({
      error: 'No path found',
      from,
      to
    });
  }
  
  res.json({
    from,
    to,
    hops: path.length - 1,
    path
  });
});

// Get recommendations
router.get('/api/recommendations/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  const recommendations = getRecommendations(agentId);
  
  res.json({
    agentId,
    count: recommendations.length,
    recommendations
  });
});

// Vouch for an agent
router.post('/api/vouch', (req, res) => {
  const { voucherId, targetId, reason, strength } = req.body;
  
  if (!voucherId || !targetId) {
    return res.status(400).json({ error: 'voucherId and targetId are required' });
  }
  
  if (voucherId.toLowerCase() === targetId.toLowerCase()) {
    return res.status(400).json({ error: 'Cannot vouch for yourself' });
  }
  
  const vouches = loadVouches();
  
  // Check for duplicate vouch
  const existing = vouches.find(v =>
    v.voucherId.toLowerCase() === voucherId.toLowerCase() &&
    v.targetId.toLowerCase() === targetId.toLowerCase()
  );
  
  if (existing) {
    return res.status(409).json({ error: 'Vouch already exists' });
  }
  
  const vouch = {
    id: uuidv4(),
    voucherId,
    targetId,
    reason: reason || '',
    strength: strength || 1.0,
    timestamp: new Date().toISOString()
  };
  
  vouches.push(vouch);
  saveVouches(vouches);
  
  res.status(201).json(vouch);
});

// Get trust score
router.get('/api/trust/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  const trustScore = calculateTrustScore(agentId);
  
  res.json({
    agentId,
    ...trustScore
  });
});

// Delete a connection
router.delete('/api/connections/:connectionId', (req, res) => {
  const connectionId = req.params.connectionId;
  let connections = loadConnections();
  
  const index = connections.findIndex(c => c.id === connectionId);
  if (index === -1) {
    return res.status(404).json({ error: 'Connection not found' });
  }
  
  const deleted = connections[index];
  connections.splice(index, 1);
  saveConnections(connections);
  
  res.json({ 
    success: true,
    deleted
  });
});

// Graph statistics
router.get('/api/stats', (req, res) => {
  const connections = loadConnections();
  const vouches = loadVouches();
  const agents = getAllAgents();
  const agentCount = agents.length;
  const connectionCount = connections.length;
  
  // Calculate density
  const maxConnections = agentCount * (agentCount - 1);
  const density = maxConnections > 0 ? connectionCount / maxConnections : 0;
  
  // Average connections per agent
  const avgConnections = agentCount > 0 
    ? connectionCount * 2 / agentCount // Each connection involves 2 agents
    : 0;
  
  // Type distribution
  const typeDistribution = {};
  connections.forEach(conn => {
    typeDistribution[conn.type] = (typeDistribution[conn.type] || 0) + 1;
  });
  
  // Average strength
  const avgStrength = connections.length > 0
    ? connections.reduce((sum, c) => sum + (c.strength || 0.5), 0) / connections.length
    : 0;
  
  // Most connected agents
  const connectionCounts = {};
  connections.forEach(conn => {
    connectionCounts[conn.agentId] = (connectionCounts[conn.agentId] || 0) + 1;
    connectionCounts[conn.targetId] = (connectionCounts[conn.targetId] || 0) + 1;
  });
  
  const mostConnected = Object.entries(connectionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([agent, count]) => ({ agent, connections: count }));
  
  res.json({
    agents: agentCount,
    connections: connectionCount,
    vouches: vouches.length,
    density: parseFloat(density.toFixed(4)),
    avgConnections: parseFloat(avgConnections.toFixed(2)),
    avgStrength: parseFloat(avgStrength.toFixed(3)),
    typeDistribution,
    mostConnected
  });
});

// Detect clusters
router.get('/api/clusters', (req, res) => {
  const clusters = detectClusters();
  
  res.json({
    clusterCount: clusters.length,
    clusters: clusters.map((cluster, i) => ({
      id: i + 1,
      size: cluster.length,
      agents: cluster
    }))
  });
});

module.exports = router;
