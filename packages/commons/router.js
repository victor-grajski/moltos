const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/commons');
const RESOURCES_FILE = path.join(DATA_DIR, 'resources.json');
const ALLOCATIONS_FILE = path.join(DATA_DIR, 'allocations.json');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');
const VIOLATIONS_FILE = path.join(DATA_DIR, 'violations.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper functions
function loadResources() {
  try {
    return JSON.parse(fs.readFileSync(RESOURCES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveResources(resources) {
  fs.writeFileSync(RESOURCES_FILE, JSON.stringify(resources, null, 2));
}

function loadAllocations() {
  try {
    return JSON.parse(fs.readFileSync(ALLOCATIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveAllocations(allocations) {
  fs.writeFileSync(ALLOCATIONS_FILE, JSON.stringify(allocations, null, 2));
}

function loadRules() {
  try {
    return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveRules(rules) {
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
}

function loadViolations() {
  try {
    return JSON.parse(fs.readFileSync(VIOLATIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveViolations(violations) {
  fs.writeFileSync(VIOLATIONS_FILE, JSON.stringify(violations, null, 2));
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const resources = loadResources();
  const allocations = loadAllocations();
  
  res.json({
    status: 'ok',
    service: 'moltcommons',
    resources: resources.length,
    activeAllocations: allocations.filter(a => !a.releasedAt).length,
    violations: loadViolations().length,
    timestamp: new Date().toISOString()
  });
});

// Dashboard
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Register shared resource
router.post('/api/resources', (req, res) => {
  const { name, description, type, capacity, rules } = req.body;
  
  if (!name || !type || !capacity) {
    return res.status(400).json({ error: 'name, type, and capacity are required' });
  }
  
  const resources = loadResources();
  
  // Check if resource already exists
  if (resources.find(r => r.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'Resource with this name already exists' });
  }
  
  const resource = {
    id: uuidv4(),
    name,
    description: description || '',
    type,
    capacity,
    rules: rules || [],
    createdAt: new Date().toISOString()
  };
  
  resources.push(resource);
  saveResources(resources);
  res.status(201).json(resource);
});

// List shared resources with usage levels
router.get('/api/resources', (req, res) => {
  const resources = loadResources();
  const allocations = loadAllocations();
  
  const resourcesWithUsage = resources.map(r => {
    const activeAllocations = allocations.filter(a => 
      a.resourceId === r.id && !a.releasedAt
    );
    
    const currentUsage = activeAllocations.reduce((sum, a) => sum + a.amount, 0);
    const usagePercent = (currentUsage / r.capacity * 100).toFixed(1);
    
    return {
      ...r,
      currentUsage,
      capacity: r.capacity,
      usagePercent: parseFloat(usagePercent),
      activeAllocations: activeAllocations.length
    };
  });
  
  resourcesWithUsage.sort((a, b) => b.usagePercent - a.usagePercent);
  res.json(resourcesWithUsage);
});

// Get resource details
router.get('/api/resources/:id', (req, res) => {
  const resources = loadResources();
  const resource = resources.find(r => r.id === req.params.id);
  
  if (!resource) {
    return res.status(404).json({ error: 'Resource not found' });
  }
  
  const allocations = loadAllocations().filter(a => a.resourceId === req.params.id);
  const rules = loadRules().filter(r => r.resourceId === req.params.id);
  
  const activeAllocations = allocations.filter(a => !a.releasedAt);
  const currentUsage = activeAllocations.reduce((sum, a) => sum + a.amount, 0);
  const usagePercent = (currentUsage / resource.capacity * 100).toFixed(1);
  
  res.json({
    ...resource,
    currentUsage,
    usagePercent: parseFloat(usagePercent),
    activeAllocations: activeAllocations.length,
    totalAllocations: allocations.length,
    rules: rules.length
  });
});

// Request resource usage
router.post('/api/resources/:id/use', (req, res) => {
  const { agent, amount, duration } = req.body;
  
  if (!agent || !amount || amount <= 0) {
    return res.status(400).json({ error: 'agent and positive amount are required' });
  }
  
  const resources = loadResources();
  const resource = resources.find(r => r.id === req.params.id);
  
  if (!resource) {
    return res.status(404).json({ error: 'Resource not found' });
  }
  
  const allocations = loadAllocations();
  const activeAllocations = allocations.filter(a => 
    a.resourceId === req.params.id && !a.releasedAt
  );
  
  const currentUsage = activeAllocations.reduce((sum, a) => sum + a.amount, 0);
  const availableCapacity = resource.capacity - currentUsage;
  
  if (amount > availableCapacity) {
    return res.status(409).json({ 
      error: 'Insufficient capacity',
      requested: amount,
      available: availableCapacity,
      current: currentUsage,
      capacity: resource.capacity
    });
  }
  
  const allocation = {
    id: uuidv4(),
    resourceId: req.params.id,
    agent,
    amount,
    duration: duration || null,
    allocatedAt: new Date().toISOString(),
    releasedAt: null
  };
  
  allocations.push(allocation);
  saveAllocations(allocations);
  res.status(201).json(allocation);
});

// Release allocation
router.post('/api/resources/:id/release', (req, res) => {
  const { agent } = req.body;
  
  if (!agent) {
    return res.status(400).json({ error: 'agent is required' });
  }
  
  const allocations = loadAllocations();
  const allocation = allocations.find(a => 
    a.resourceId === req.params.id && 
    a.agent === agent && 
    !a.releasedAt
  );
  
  if (!allocation) {
    return res.status(404).json({ error: 'No active allocation found for this agent' });
  }
  
  allocation.releasedAt = new Date().toISOString();
  saveAllocations(allocations);
  
  res.json({ success: true, allocation });
});

// Get usage history
router.get('/api/resources/:id/usage', (req, res) => {
  const allocations = loadAllocations().filter(a => a.resourceId === req.params.id);
  
  const activeAllocations = allocations.filter(a => !a.releasedAt);
  const releasedAllocations = allocations.filter(a => a.releasedAt);
  
  const totalUsage = allocations.reduce((sum, a) => sum + a.amount, 0);
  const currentUsage = activeAllocations.reduce((sum, a) => sum + a.amount, 0);
  
  // Get usage by agent
  const usageByAgent = {};
  allocations.forEach(a => {
    if (!usageByAgent[a.agent]) {
      usageByAgent[a.agent] = { total: 0, active: 0, count: 0 };
    }
    usageByAgent[a.agent].total += a.amount;
    if (!a.releasedAt) {
      usageByAgent[a.agent].active += a.amount;
    }
    usageByAgent[a.agent].count++;
  });
  
  res.json({
    resourceId: req.params.id,
    totalAllocations: allocations.length,
    activeAllocations: activeAllocations.length,
    totalUsage,
    currentUsage,
    usageByAgent,
    history: allocations.sort((a, b) => new Date(b.allocatedAt) - new Date(a.allocatedAt))
  });
});

// Add governance rule
router.post('/api/resources/:id/rules', (req, res) => {
  const { rule, proposer } = req.body;
  
  if (!rule || !proposer) {
    return res.status(400).json({ error: 'rule and proposer are required' });
  }
  
  const resources = loadResources();
  const resource = resources.find(r => r.id === req.params.id);
  
  if (!resource) {
    return res.status(404).json({ error: 'Resource not found' });
  }
  
  const rules = loadRules();
  
  const ruleEntry = {
    id: uuidv4(),
    resourceId: req.params.id,
    rule,
    proposer,
    status: 'active',
    proposedAt: new Date().toISOString()
  };
  
  rules.push(ruleEntry);
  saveRules(rules);
  
  // Also add to resource's rules array
  resource.rules.push(rule);
  saveResources(resources);
  
  res.status(201).json(ruleEntry);
});

// Get resource health/sustainability metrics
router.get('/api/resources/:id/health', (req, res) => {
  const resources = loadResources();
  const resource = resources.find(r => r.id === req.params.id);
  
  if (!resource) {
    return res.status(404).json({ error: 'Resource not found' });
  }
  
  const allocations = loadAllocations().filter(a => a.resourceId === req.params.id);
  const activeAllocations = allocations.filter(a => !a.releasedAt);
  const violations = loadViolations().filter(v => v.resourceId === req.params.id);
  
  const currentUsage = activeAllocations.reduce((sum, a) => sum + a.amount, 0);
  const usagePercent = (currentUsage / resource.capacity * 100).toFixed(1);
  
  // Calculate sustainability score (0-100)
  let sustainabilityScore = 100;
  
  // Penalize for high usage
  if (usagePercent > 90) {
    sustainabilityScore -= 30;
  } else if (usagePercent > 75) {
    sustainabilityScore -= 15;
  }
  
  // Penalize for violations
  sustainabilityScore -= violations.length * 5;
  sustainabilityScore = Math.max(0, sustainabilityScore);
  
  const healthStatus = sustainabilityScore >= 80 ? 'healthy' : 
                       sustainabilityScore >= 50 ? 'warning' : 'critical';
  
  res.json({
    resourceId: req.params.id,
    resourceName: resource.name,
    capacity: resource.capacity,
    currentUsage,
    usagePercent: parseFloat(usagePercent),
    sustainabilityScore,
    healthStatus,
    violations: violations.length,
    activeAllocations: activeAllocations.length,
    totalRules: resource.rules.length
  });
});

// Get over-usage violations
router.get('/api/violations', (req, res) => {
  const violations = loadViolations();
  violations.sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt));
  res.json(violations);
});

module.exports = router;
