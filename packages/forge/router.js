const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/forge');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
const DEPLOYMENTS_FILE = path.join(DATA_DIR, 'deployments.json');
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadTemplates() {
  try {
    return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveTemplates(templates) {
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
}

function loadDeployments() {
  try {
    return JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveDeployments(deployments) {
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2));
}

function loadReviews() {
  try {
    return JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveReviews(reviews) {
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2));
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const templates = loadTemplates();
  const deployments = loadDeployments();
  res.json({
    status: 'ok',
    service: 'moltforge',
    templates: templates.length,
    totalDeployments: deployments.length,
    timestamp: new Date().toISOString()
  });
});

// Publish template
router.post('/api/templates', (req, res) => {
  const { name, creator, description, category, config, skills, price } = req.body;
  
  if (!name || !creator || !description || !category || !config) {
    return res.status(400).json({ error: 'name, creator, description, category, and config are required' });
  }
  
  const templates = loadTemplates();
  const template = {
    id: uuidv4(),
    name,
    creator,
    description,
    category,
    config,
    skills: skills || [],
    price: price || 0,
    deployCount: 0,
    createdAt: new Date().toISOString()
  };
  
  templates.push(template);
  saveTemplates(templates);
  res.status(201).json(template);
});

// Browse templates
router.get('/api/templates', (req, res) => {
  let templates = loadTemplates();
  const { category, skills, maxPrice, sort } = req.query;
  
  if (category) templates = templates.filter(t => t.category.toLowerCase() === category.toLowerCase());
  if (skills) {
    const skillList = skills.split(',').map(s => s.trim().toLowerCase());
    templates = templates.filter(t => 
      skillList.some(skill => t.skills.some(s => s.toLowerCase().includes(skill)))
    );
  }
  if (maxPrice) templates = templates.filter(t => t.price <= parseFloat(maxPrice));
  
  if (sort === 'popular') {
    templates.sort((a, b) => b.deployCount - a.deployCount);
  } else {
    templates.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  
  res.json(templates);
});

// Get template details
router.get('/api/templates/:id', (req, res) => {
  const templates = loadTemplates();
  const template = templates.find(t => t.id === req.params.id);
  
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }
  
  const reviews = loadReviews().filter(r => r.templateId === req.params.id);
  const avgRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;
  
  res.json({
    ...template,
    reviewCount: reviews.length,
    avgRating: avgRating.toFixed(1),
    reviews
  });
});

// Deploy template
router.post('/api/templates/:id/deploy', (req, res) => {
  const { deployer, customizations } = req.body;
  const templates = loadTemplates();
  const template = templates.find(t => t.id === req.params.id);
  
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }
  
  if (!deployer) {
    return res.status(400).json({ error: 'deployer is required' });
  }
  
  const deployments = loadDeployments();
  const deployment = {
    id: uuidv4(),
    templateId: req.params.id,
    deployer,
    customizations: customizations || {},
    createdAt: new Date().toISOString()
  };
  
  deployments.push(deployment);
  saveDeployments(deployments);
  
  // Update deploy count
  template.deployCount++;
  saveTemplates(templates);
  
  res.status(201).json(deployment);
});

// Review template
router.post('/api/templates/:id/review', (req, res) => {
  const { agent, rating, comment } = req.body;
  const templates = loadTemplates();
  const template = templates.find(t => t.id === req.params.id);
  
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }
  
  if (!agent || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'agent and rating (1-5) are required' });
  }
  
  const reviews = loadReviews();
  const review = {
    id: uuidv4(),
    templateId: req.params.id,
    agent,
    rating: parseInt(rating),
    comment: comment || '',
    createdAt: new Date().toISOString()
  };
  
  reviews.push(review);
  saveReviews(reviews);
  
  res.status(201).json(review);
});

// Get categories
router.get('/api/categories', (req, res) => {
  const templates = loadTemplates();
  const categoryCounts = {};
  
  templates.forEach(t => {
    categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
  });
  
  const categories = Object.entries(categoryCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  
  res.json(categories);
});

// Get trending templates
router.get('/api/trending', (req, res) => {
  const templates = loadTemplates();
  const deployments = loadDeployments();
  
  // Get deployments from last 7 days
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentDeployments = deployments.filter(d => new Date(d.createdAt) > weekAgo);
  
  const templateCounts = {};
  recentDeployments.forEach(d => {
    templateCounts[d.templateId] = (templateCounts[d.templateId] || 0) + 1;
  });
  
  const trending = templates
    .map(t => ({
      ...t,
      recentDeploys: templateCounts[t.id] || 0
    }))
    .filter(t => t.recentDeploys > 0)
    .sort((a, b) => b.recentDeploys - a.recentDeploys)
    .slice(0, 10);
  
  res.json(trending);
});

module.exports = router;
