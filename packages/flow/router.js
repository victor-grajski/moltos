const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/flow');
const NODES_FILE = path.join(DATA_DIR, 'nodes.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');
const FLOWS_FILE = path.join(DATA_DIR, 'flows.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

function loadRequests() {
  try {
    return JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveRequests(requests) {
  fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2));
}

function loadFlows() {
  try {
    return JSON.parse(fs.readFileSync(FLOWS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveFlows(flows) {
  fs.writeFileSync(FLOWS_FILE, JSON.stringify(flows, null, 2));
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const nodes = loadNodes();
  const requests = loadRequests();
  const flows = loadFlows();
  res.json({
    status: 'ok',
    service: 'moltflow',
    nodes: nodes.length,
    pendingRequests: requests.filter(r => r.status === 'pending').length,
    activeFlows: flows.filter(f => f.active).length,
    timestamp: new Date().toISOString()
  });
});

// Register node
router.post('/api/nodes', (req, res) => {
  const { agent, resources } = req.body;
  
  if (!agent || !resources || !Array.isArray(resources)) {
    return res.status(400).json({ error: 'agent and resources array are required' });
  }
  
  const nodes = loadNodes();
  
  // Update or create node
  let node = nodes.find(n => n.agent === agent);
  if (node) {
    node.resources = resources;
    node.updatedAt = new Date().toISOString();
  } else {
    node = {
      id: uuidv4(),
      agent,
      resources,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    nodes.push(node);
  }
  
  saveNodes(nodes);
  res.json(node);
});

// List nodes
router.get('/api/nodes', (req, res) => {
  const nodes = loadNodes();
  res.json(nodes);
});

// Request resources
router.post('/api/requests', (req, res) => {
  const { agent, type, amount, maxPrice, urgency } = req.body;
  
  if (!agent || !type || !amount) {
    return res.status(400).json({ error: 'agent, type, and amount are required' });
  }
  
  const requests = loadRequests();
  const request = {
    id: uuidv4(),
    agent,
    type,
    amount: parseFloat(amount),
    maxPrice: maxPrice || null,
    urgency: urgency || 'normal',
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  
  requests.push(request);
  saveRequests(requests);
  res.status(201).json(request);
});

// Get pending requests
router.get('/api/requests', (req, res) => {
  const requests = loadRequests();
  const pending = requests.filter(r => r.status === 'pending');
  pending.sort((a, b) => {
    const urgencyOrder = { high: 0, normal: 1, low: 2 };
    return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
  });
  res.json(pending);
});

// Fulfill request
router.post('/api/requests/:id/fulfill', (req, res) => {
  const { provider, amount } = req.body;
  const requests = loadRequests();
  const request = requests.find(r => r.id === req.params.id);
  
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  
  if (request.status !== 'pending') {
    return res.status(400).json({ error: 'Request already fulfilled' });
  }
  
  if (!provider || !amount) {
    return res.status(400).json({ error: 'provider and amount are required' });
  }
  
  const flows = loadFlows();
  const flow = {
    id: uuidv4(),
    requestId: req.params.id,
    from: provider,
    to: request.agent,
    type: request.type,
    amount: parseFloat(amount),
    active: true,
    createdAt: new Date().toISOString()
  };
  
  flows.push(flow);
  saveFlows(flows);
  
  // Update request
  request.status = 'fulfilled';
  request.provider = provider;
  request.fulfilledAt = new Date().toISOString();
  saveRequests(requests);
  
  res.status(201).json({ request, flow });
});

// Get active flows
router.get('/api/flows', (req, res) => {
  const flows = loadFlows().filter(f => f.active);
  flows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(flows);
});

// Get stats
router.get('/api/stats', (req, res) => {
  const flows = loadFlows();
  const requests = loadRequests();
  
  const totalVolume = flows.reduce((sum, f) => sum + f.amount, 0);
  
  const routes = {};
  flows.forEach(f => {
    const key = `${f.from}-${f.to}`;
    routes[key] = (routes[key] || 0) + 1;
  });
  
  const mostActiveRoutes = Object.entries(routes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([route, count]) => {
      const [from, to] = route.split('-');
      return { from, to, count };
    });
  
  const resourceTypes = {};
  flows.forEach(f => {
    resourceTypes[f.type] = (resourceTypes[f.type] || 0) + f.amount;
  });
  
  res.json({
    totalVolume,
    totalFlows: flows.length,
    pendingRequests: requests.filter(r => r.status === 'pending').length,
    mostActiveRoutes,
    resourceUtilization: Object.entries(resourceTypes)
      .map(([type, amount]) => ({ type, amount }))
      .sort((a, b) => b.amount - a.amount)
  });
});

module.exports = router;
