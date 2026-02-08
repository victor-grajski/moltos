const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/dna');
const BLUEPRINTS_FILE = path.join(DATA_DIR, 'blueprints.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadBlueprints() {
  try {
    return JSON.parse(fs.readFileSync(BLUEPRINTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveBlueprints(blueprints) {
  fs.writeFileSync(BLUEPRINTS_FILE, JSON.stringify(blueprints, null, 2));
}

function getLineage(blueprintId, blueprints) {
  const ancestors = [];
  let current = blueprints.find(b => b.id === blueprintId);
  
  while (current && current.parentId) {
    const parent = blueprints.find(b => b.id === current.parentId);
    if (parent) {
      ancestors.push(parent);
      current = parent;
    } else {
      break;
    }
  }
  
  return ancestors;
}

function getDescendants(blueprintId, blueprints) {
  const descendants = [];
  const children = blueprints.filter(b => b.parentId === blueprintId);
  
  for (const child of children) {
    descendants.push(child);
    descendants.push(...getDescendants(child.id, blueprints));
  }
  
  return descendants;
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const blueprints = loadBlueprints();
  res.json({
    status: 'ok',
    service: 'moltdna',
    blueprints: blueprints.length,
    totalForks: blueprints.filter(b => b.parentId).length,
    timestamp: new Date().toISOString()
  });
});

// Register new blueprint
router.post('/api/blueprints', (req, res) => {
  const { name, creator, description, capabilities, config, parentId } = req.body;
  
  if (!name || !creator) {
    return res.status(400).json({ error: 'name and creator are required' });
  }
  
  const blueprints = loadBlueprints();
  
  const blueprint = {
    id: uuidv4(),
    name,
    creator,
    description: description || '',
    capabilities: capabilities || [],
    config: config || {},
    parentId: parentId || null,
    forkCount: 0,
    useCount: 0,
    createdAt: new Date().toISOString()
  };
  
  blueprints.push(blueprint);
  
  // Update parent's fork count
  if (parentId) {
    const parent = blueprints.find(b => b.id === parentId);
    if (parent) {
      parent.forkCount++;
    }
  }
  
  saveBlueprints(blueprints);
  res.status(201).json(blueprint);
});

// List blueprints with filters
router.get('/api/blueprints', (req, res) => {
  let blueprints = loadBlueprints();
  const { creator, capability, sort } = req.query;
  
  if (creator) {
    blueprints = blueprints.filter(b => b.creator.toLowerCase() === creator.toLowerCase());
  }
  
  if (capability) {
    blueprints = blueprints.filter(b => b.capabilities.includes(capability));
  }
  
  if (sort === 'popularity') {
    blueprints.sort((a, b) => b.forkCount - a.forkCount);
  } else {
    blueprints.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  
  res.json(blueprints);
});

// Get blueprint by ID
router.get('/api/blueprints/:id', (req, res) => {
  const blueprints = loadBlueprints();
  const blueprint = blueprints.find(b => b.id === req.params.id);
  
  if (!blueprint) {
    return res.status(404).json({ error: 'Blueprint not found' });
  }
  
  const lineage = getLineage(blueprint.id, blueprints);
  
  res.json({
    ...blueprint,
    lineageDepth: lineage.length,
    lineage: lineage.map(b => ({ id: b.id, name: b.name, creator: b.creator }))
  });
});

// Fork a blueprint
router.post('/api/blueprints/:id/fork', (req, res) => {
  const { newName, creator, mutations } = req.body;
  const blueprints = loadBlueprints();
  const parent = blueprints.find(b => b.id === req.params.id);
  
  if (!parent) {
    return res.status(404).json({ error: 'Parent blueprint not found' });
  }
  
  if (!newName || !creator) {
    return res.status(400).json({ error: 'newName and creator are required' });
  }
  
  const fork = {
    id: uuidv4(),
    name: newName,
    creator,
    description: parent.description,
    capabilities: [...parent.capabilities],
    config: { ...parent.config },
    parentId: parent.id,
    forkCount: 0,
    useCount: 0,
    mutations: mutations || [],
    createdAt: new Date().toISOString()
  };
  
  parent.forkCount++;
  blueprints.push(fork);
  saveBlueprints(blueprints);
  
  res.status(201).json(fork);
});

// Get full lineage tree
router.get('/api/blueprints/:id/lineage', (req, res) => {
  const blueprints = loadBlueprints();
  const blueprint = blueprints.find(b => b.id === req.params.id);
  
  if (!blueprint) {
    return res.status(404).json({ error: 'Blueprint not found' });
  }
  
  const lineage = getLineage(blueprint.id, blueprints);
  res.json(lineage);
});

// Get all descendants (forks/children)
router.get('/api/blueprints/:id/descendants', (req, res) => {
  const blueprints = loadBlueprints();
  const blueprint = blueprints.find(b => b.id === req.params.id);
  
  if (!blueprint) {
    return res.status(404).json({ error: 'Blueprint not found' });
  }
  
  const descendants = getDescendants(blueprint.id, blueprints);
  res.json(descendants);
});

// Get trending blueprints
router.get('/api/trending', (req, res) => {
  const blueprints = loadBlueprints();
  const trending = [...blueprints]
    .sort((a, b) => (b.forkCount + b.useCount) - (a.forkCount + a.useCount))
    .slice(0, 10);
  
  res.json(trending);
});

module.exports = router;
