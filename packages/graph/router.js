const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/graph');
const NODES_FILE = path.join(DATA_DIR, 'nodes.json');
const EDGES_FILE = path.join(DATA_DIR, 'edges.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper functions
function loadNodes() {
  try {
    return JSON.parse(fs.readFileSync(NODES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveNodes(nodes) {
  fs.writeFileSync(NODES_FILE, JSON.stringify(nodes, null, 2));
}

function loadEdges() {
  try {
    return JSON.parse(fs.readFileSync(EDGES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveEdges(edges) {
  fs.writeFileSync(EDGES_FILE, JSON.stringify(edges, null, 2));
}

function ensureNode(agent) {
  const nodes = loadNodes();
  let node = nodes.find(n => n.agent.toLowerCase() === agent.toLowerCase());
  
  if (!node) {
    node = {
      agent,
      addedAt: new Date().toISOString()
    };
    nodes.push(node);
    saveNodes(nodes);
  }
  
  return node;
}

function calculateNodeStats(agent) {
  const edges = loadEdges();
  const outgoing = edges.filter(e => e.from.toLowerCase() === agent.toLowerCase());
  const incoming = edges.filter(e => e.to.toLowerCase() === agent.toLowerCase());
  
  return {
    degree: outgoing.length + incoming.length,
    outDegree: outgoing.length,
    inDegree: incoming.length,
    connections: [...new Set([...outgoing.map(e => e.to), ...incoming.map(e => e.from)])]
  };
}

function findShortestPath(from, to) {
  const edges = loadEdges();
  const nodes = loadNodes().map(n => n.agent);
  
  // Build adjacency list
  const graph = {};
  nodes.forEach(n => graph[n.toLowerCase()] = []);
  edges.forEach(e => {
    const f = e.from.toLowerCase();
    const t = e.to.toLowerCase();
    if (!graph[f]) graph[f] = [];
    if (!graph[t]) graph[t] = [];
    graph[f].push(t);
    graph[t].push(f); // undirected
  });
  
  // BFS
  const queue = [[from.toLowerCase()]];
  const visited = new Set([from.toLowerCase()]);
  
  while (queue.length > 0) {
    const path = queue.shift();
    const node = path[path.length - 1];
    
    if (node === to.toLowerCase()) {
      return path;
    }
    
    for (const neighbor of (graph[node] || [])) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  
  return null; // No path found
}

function detectClusters() {
  const edges = loadEdges();
  const nodes = loadNodes().map(n => n.agent.toLowerCase());
  
  // Build adjacency list
  const graph = {};
  nodes.forEach(n => graph[n] = []);
  edges.forEach(e => {
    const f = e.from.toLowerCase();
    const t = e.to.toLowerCase();
    if (!graph[f]) graph[f] = [];
    if (!graph[t]) graph[t] = [];
    graph[f].push(t);
    graph[t].push(f);
  });
  
  // Simple connected components
  const visited = new Set();
  const clusters = [];
  
  for (const node of nodes) {
    if (visited.has(node)) continue;
    
    const cluster = [];
    const queue = [node];
    visited.add(node);
    
    while (queue.length > 0) {
      const current = queue.shift();
      cluster.push(current);
      
      for (const neighbor of (graph[current] || [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
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
  res.json({
    status: 'ok',
    service: 'moltgraph',
    nodes: loadNodes().length,
    edges: loadEdges().length,
    timestamp: new Date().toISOString()
  });
});

// Get all nodes
router.get('/api/nodes', (req, res) => {
  const nodes = loadNodes();
  const edges = loadEdges();
  
  const nodesWithStats = nodes.map(node => {
    const stats = calculateNodeStats(node.agent);
    return {
      ...node,
      ...stats
    };
  });
  
  res.json(nodesWithStats);
});

// Get specific node with connections
router.get('/api/nodes/:agent', (req, res) => {
  const agent = req.params.agent;
  ensureNode(agent); // Create if doesn't exist
  
  const edges = loadEdges();
  const connections = edges.filter(e => 
    e.from.toLowerCase() === agent.toLowerCase() || 
    e.to.toLowerCase() === agent.toLowerCase()
  );
  
  const stats = calculateNodeStats(agent);
  
  res.json({
    agent,
    connections,
    stats
  });
});

// Add edge (connection)
router.post('/api/edges', (req, res) => {
  const { from, to, type } = req.body;
  
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to are required' });
  }
  
  const validTypes = ['follows', 'collaborates', 'trusts', 'traded'];
  if (type && !validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }
  
  // Ensure both nodes exist
  ensureNode(from);
  ensureNode(to);
  
  const edges = loadEdges();
  
  // Check for duplicate
  const existing = edges.find(e => 
    e.from.toLowerCase() === from.toLowerCase() && 
    e.to.toLowerCase() === to.toLowerCase() &&
    e.type === (type || 'follows')
  );
  
  if (existing) {
    return res.status(409).json({ error: 'Edge already exists' });
  }
  
  const edge = {
    id: uuidv4(),
    from,
    to,
    type: type || 'follows',
    createdAt: new Date().toISOString()
  };
  
  edges.push(edge);
  saveEdges(edges);
  
  res.status(201).json(edge);
});

// Delete edge
router.delete('/api/edges/:id', (req, res) => {
  let edges = loadEdges();
  const index = edges.findIndex(e => e.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Edge not found' });
  }
  
  edges.splice(index, 1);
  saveEdges(edges);
  
  res.json({ success: true });
});

// Get clusters
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

// Graph statistics
router.get('/api/stats', (req, res) => {
  const nodes = loadNodes();
  const edges = loadEdges();
  
  const nodeCount = nodes.length;
  const edgeCount = edges.length;
  
  // Calculate density: 2*E / (N*(N-1)) for directed graph
  const density = nodeCount > 1 
    ? (2 * edgeCount) / (nodeCount * (nodeCount - 1)) 
    : 0;
  
  // Average degree
  const degrees = nodes.map(n => calculateNodeStats(n.agent).degree);
  const avgDegree = degrees.length > 0 
    ? degrees.reduce((a, b) => a + b, 0) / degrees.length 
    : 0;
  
  // Type distribution
  const typeCount = {};
  edges.forEach(e => {
    typeCount[e.type] = (typeCount[e.type] || 0) + 1;
  });
  
  res.json({
    nodes: nodeCount,
    edges: edgeCount,
    density: parseFloat(density.toFixed(4)),
    avgDegree: parseFloat(avgDegree.toFixed(2)),
    typeDistribution: typeCount
  });
});

// Shortest path
router.get('/api/shortest-path', (req, res) => {
  const { from, to } = req.query;
  
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to parameters are required' });
  }
  
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
    length: path.length - 1,
    path
  });
});

module.exports = router;
