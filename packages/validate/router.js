const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/validate');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const VALIDATIONS_FILE = path.join(DATA_DIR, 'validations.json');
const VALIDATORS_FILE = path.join(DATA_DIR, 'validators.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadTasks() {
  try {
    return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveTasks(tasks) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

function loadValidations() {
  try {
    return JSON.parse(fs.readFileSync(VALIDATIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveValidations(validations) {
  fs.writeFileSync(VALIDATIONS_FILE, JSON.stringify(validations, null, 2));
}

function loadValidators() {
  try {
    return JSON.parse(fs.readFileSync(VALIDATORS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveValidators(validators) {
  fs.writeFileSync(VALIDATORS_FILE, JSON.stringify(validators, null, 2));
}

// Trust level tiers
const TRUST_LEVELS = [
  {
    tier: 0,
    name: 'No Validation',
    description: 'Ordering pizza, <$1 value',
    maxValue: 1,
    requirements: []
  },
  {
    tier: 1,
    name: 'Reputation Only',
    description: 'Low-stake tasks, <$100',
    maxValue: 100,
    requirements: ['Reputation score', 'Historical feedback']
  },
  {
    tier: 2,
    name: 'Single Validator Re-execution',
    description: 'Medium-stake tasks, <$1000',
    maxValue: 1000,
    requirements: ['At least 1 validator re-execution', 'Validator stake']
  },
  {
    tier: 3,
    name: 'Multi-Validator Consensus',
    description: 'High-stake tasks, <$10000',
    maxValue: 10000,
    requirements: ['Multiple validator consensus (3+)', 'Validator stake', 'Reputation threshold']
  },
  {
    tier: 4,
    name: 'zkML or TEE Attestation',
    description: 'Critical tasks, >$10000',
    maxValue: Infinity,
    requirements: ['Zero-knowledge proof or TEE attestation', 'High validator stake', 'Multi-sig approval']
  }
];

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'moltvalidate',
    tasks: loadTasks().length,
    validators: loadValidators().length,
    validations: loadValidations().length,
    timestamp: new Date().toISOString()
  });
});

// Dashboard
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Register task for validation
router.post('/api/tasks', (req, res) => {
  const { taskId, agent, description, input, output, valueAtRisk, requiredTrustLevel } = req.body;
  
  if (!agent || !description) {
    return res.status(400).json({ error: 'agent and description are required' });
  }
  
  const tasks = loadTasks();
  const task = {
    id: taskId || uuidv4(),
    agent,
    description,
    input: input || null,
    output: output || null,
    valueAtRisk: valueAtRisk || 0,
    requiredTrustLevel: requiredTrustLevel || 0,
    status: 'pending',
    createdAt: new Date().toISOString(),
    validatedAt: null
  };
  
  tasks.push(task);
  saveTasks(tasks);
  res.status(201).json(task);
});

// List tasks
router.get('/api/tasks', (req, res) => {
  let tasks = loadTasks();
  const { status, agent } = req.query;
  
  if (status) {
    tasks = tasks.filter(t => t.status === status);
  }
  if (agent) {
    tasks = tasks.filter(t => t.agent === agent);
  }
  
  tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(tasks);
});

// Get task details with validation results
router.get('/api/tasks/:id', (req, res) => {
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === req.params.id);
  
  if (!task) return res.status(404).json({ error: 'Task not found' });
  
  const validations = loadValidations().filter(v => v.taskId === req.params.id);
  
  res.json({
    ...task,
    validations
  });
});

// Submit validation result
router.post('/api/tasks/:id/validate', (req, res) => {
  const { validator, passed, evidence, method } = req.body;
  const taskId = req.params.id;
  
  if (!validator || passed === undefined || !method) {
    return res.status(400).json({ error: 'validator, passed, and method are required' });
  }
  
  const validMethods = ['re-execution', 'zkml', 'tee', 'judge'];
  if (!validMethods.includes(method)) {
    return res.status(400).json({ error: `method must be one of: ${validMethods.join(', ')}` });
  }
  
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === taskId);
  
  if (!task) return res.status(404).json({ error: 'Task not found' });
  
  const validators = loadValidators();
  const validatorRecord = validators.find(v => v.agent === validator);
  
  if (!validatorRecord) {
    return res.status(404).json({ error: 'Validator not registered' });
  }
  
  if (!validatorRecord.methods.includes(method)) {
    return res.status(400).json({ error: `Validator does not support method: ${method}` });
  }
  
  const validations = loadValidations();
  const validation = {
    id: uuidv4(),
    taskId,
    validator,
    passed,
    evidence: evidence || null,
    method,
    validatedAt: new Date().toISOString()
  };
  
  validations.push(validation);
  saveValidations(validations);
  
  // Update task status based on validation results
  const taskValidations = validations.filter(v => v.taskId === taskId);
  const passCount = taskValidations.filter(v => v.passed).length;
  const failCount = taskValidations.length - passCount;
  
  if (task.requiredTrustLevel >= 3) {
    // Multi-validator consensus required
    if (passCount >= 3) {
      task.status = 'validated';
      task.validatedAt = new Date().toISOString();
    } else if (failCount >= 2) {
      task.status = 'failed';
      task.validatedAt = new Date().toISOString();
    }
  } else if (task.requiredTrustLevel === 2) {
    // Single validator sufficient
    if (passCount >= 1) {
      task.status = 'validated';
      task.validatedAt = new Date().toISOString();
    } else if (failCount >= 1) {
      task.status = 'failed';
      task.validatedAt = new Date().toISOString();
    }
  } else {
    // Low trust level - single validation
    task.status = passed ? 'validated' : 'failed';
    task.validatedAt = new Date().toISOString();
  }
  
  saveTasks(tasks);
  
  // Update validator stats
  validatorRecord.tasksValidated = (validatorRecord.tasksValidated || 0) + 1;
  saveValidators(validators);
  
  res.status(201).json(validation);
});

// Register as validator
router.post('/api/validators', (req, res) => {
  const { agent, methods, stake } = req.body;
  
  if (!agent || !methods || !Array.isArray(methods) || methods.length === 0) {
    return res.status(400).json({ error: 'agent and methods array are required' });
  }
  
  const validMethods = ['re-execution', 'zkml', 'tee', 'judge'];
  const invalidMethods = methods.filter(m => !validMethods.includes(m));
  if (invalidMethods.length > 0) {
    return res.status(400).json({ error: `Invalid methods: ${invalidMethods.join(', ')}` });
  }
  
  let validators = loadValidators();
  
  // Check if already registered
  const existing = validators.find(v => v.agent === agent);
  if (existing) {
    return res.status(409).json({ error: 'Validator already registered' });
  }
  
  const validator = {
    agent,
    methods,
    stake: stake || 0,
    tasksValidated: 0,
    accuracy: null,
    registeredAt: new Date().toISOString()
  };
  
  validators.push(validator);
  saveValidators(validators);
  res.status(201).json(validator);
});

// List validators
router.get('/api/validators', (req, res) => {
  const validators = loadValidators();
  res.json(validators);
});

// Get validator stats
router.get('/api/validators/:agent', (req, res) => {
  const validators = loadValidators();
  const validator = validators.find(v => v.agent === req.params.agent);
  
  if (!validator) {
    return res.status(404).json({ error: 'Validator not found' });
  }
  
  // Calculate accuracy
  const validations = loadValidations().filter(v => v.validator === req.params.agent);
  const tasks = loadTasks();
  
  let correctValidations = 0;
  validations.forEach(v => {
    const task = tasks.find(t => t.id === v.taskId);
    if (task && task.status === 'validated' && v.passed) {
      correctValidations++;
    } else if (task && task.status === 'failed' && !v.passed) {
      correctValidations++;
    }
  });
  
  const accuracy = validations.length > 0 ? (correctValidations / validations.length * 100).toFixed(1) : null;
  
  res.json({
    ...validator,
    accuracy,
    totalValidations: validations.length
  });
});

// Get trust level tiers
router.get('/api/trust-levels', (req, res) => {
  res.json({ tiers: TRUST_LEVELS, timestamp: new Date().toISOString() });
});

module.exports = router;
