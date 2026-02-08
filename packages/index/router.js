const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const skillTaxonomy = require('../shared/skillTaxonomy');

const router = express.Router();
const SERVICES_FILE = path.join(__dirname, '../../data/index/services.json');
const REVIEWS_FILE = path.join(__dirname, '../../data/index/reviews.json');

function loadServices() {
  try {
    return JSON.parse(fs.readFileSync(SERVICES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveServices(services) {
  fs.writeFileSync(SERVICES_FILE, JSON.stringify(services, null, 2));
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

// Health check
router.get('/health', (req, res) => {
  const services = loadServices();
  const reviews = loadReviews();
  
  res.json({ 
    status: 'ok', 
    service: 'moltindex',
    services: services.length,
    reviews: reviews.length,
    uptime: process.uptime()
  });
});

// Search services
router.get('/api/search', (req, res) => {
  const { q, skills, category, skillCategory } = req.query;
  let services = loadServices();
  const reviews = loadReviews();
  
  // Filter by query
  if (q) {
    const query = q.toLowerCase();
    services = services.filter(s => 
      s.name.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query) ||
      s.skills.some(sk => sk.toLowerCase().includes(query))
    );
  }
  
  // Filter by skill tags (comma-separated)
  if (skills) {
    const skillArray = typeof skills === 'string' 
      ? skills.split(',').map(s => s.trim().toLowerCase())
      : (Array.isArray(skills) ? skills.map(s => s.toLowerCase()) : []);
    
    services = services.filter(s => 
      skillArray.some(sk => s.skills.map(ss => ss.toLowerCase()).includes(sk))
    );
  }
  
  // Filter by skill category (from taxonomy)
  if (skillCategory) {
    const categorySkills = skillTaxonomy.getSkillsByCategory(skillCategory);
    services = services.filter(s => 
      s.skills.some(sk => categorySkills.includes(sk.toLowerCase()))
    );
  }
  
  // Filter by service category (legacy)
  if (category) {
    services = services.filter(s => s.category === category);
  }
  
  // Enrich with review data and skill categories
  services = services.map(s => {
    const serviceReviews = reviews.filter(r => r.serviceId === s.id);
    const avgRating = serviceReviews.length > 0
      ? (serviceReviews.reduce((sum, r) => sum + r.rating, 0) / serviceReviews.length).toFixed(1)
      : null;
    
    // Determine skill categories
    const skillCategories = Array.from(
      new Set(s.skills.map(sk => skillTaxonomy.getCategoryForTag(sk.toLowerCase())).filter(Boolean))
    );
    
    return {
      ...s,
      reviewCount: serviceReviews.length,
      avgRating: avgRating ? parseFloat(avgRating) : null,
      skillCategories
    };
  });
  
  res.json(services);
});

// Browse all services
router.get('/api/services', (req, res) => {
  let services = loadServices();
  const reviews = loadReviews();
  
  // Enrich with review data
  services = services.map(s => {
    const serviceReviews = reviews.filter(r => r.serviceId === s.id);
    const avgRating = serviceReviews.length > 0
      ? (serviceReviews.reduce((sum, r) => sum + r.rating, 0) / serviceReviews.length).toFixed(1)
      : null;
    
    return {
      ...s,
      reviewCount: serviceReviews.length,
      avgRating: avgRating ? parseFloat(avgRating) : null
    };
  });
  
  // Sort by registration date, newest first
  services.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
  
  res.json(services);
});

// Get service details
router.get('/api/services/:id', (req, res) => {
  const services = loadServices();
  const service = services.find(s => s.id === req.params.id);
  
  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }
  
  const serviceReviews = loadReviews().filter(r => r.serviceId === service.id);
  const avgRating = serviceReviews.length > 0
    ? (serviceReviews.reduce((sum, r) => sum + r.rating, 0) / serviceReviews.length).toFixed(1)
    : null;
  
  res.json({
    ...service,
    reviews: serviceReviews,
    reviewCount: serviceReviews.length,
    avgRating: avgRating ? parseFloat(avgRating) : null
  });
});

// Register service
router.post('/api/register', (req, res) => {
  const { agent, name, description, endpoints, skills, docs_url } = req.body;
  
  if (!agent || !name || !description) {
    return res.status(400).json({ 
      error: 'agent, name, and description are required' 
    });
  }
  
  const services = loadServices();
  
  // Normalize and validate skills
  const normalized = skillTaxonomy.normalizeSkills(skills || []);
  const allSkills = [...normalized.predefined, ...normalized.freeform];
  
  // Auto-categorize based on skills using taxonomy
  let category = 'other';
  const skillCategories = Array.from(
    new Set(normalized.predefined.map(s => skillTaxonomy.getCategoryForTag(s)).filter(Boolean))
  );
  
  if (skillCategories.length > 0) {
    // Use primary skill category
    category = skillCategories[0];
  } else if (allSkills.length > 0) {
    // Legacy fallback
    if (allSkills.some(s => s.includes('ai') || s.includes('llm'))) category = 'ai';
    else if (allSkills.some(s => s.includes('data'))) category = 'data';
    else if (allSkills.some(s => s.includes('api'))) category = 'api';
    else if (allSkills.some(s => s.includes('blockchain'))) category = 'blockchain';
  }
  
  const service = {
    id: uuidv4(),
    agent,
    name,
    description,
    endpoints: endpoints || [],
    skills: allSkills,
    skillCategories,
    docs_url: docs_url || null,
    category,
    views: 0,
    registeredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  services.push(service);
  saveServices(services);
  
  res.status(201).json(service);
});

// Review service
router.post('/api/services/:id/review', (req, res) => {
  const { reviewer, rating, comment } = req.body;
  
  if (!reviewer || !rating) {
    return res.status(400).json({ error: 'reviewer and rating are required' });
  }
  
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be between 1 and 5' });
  }
  
  const services = loadServices();
  const service = services.find(s => s.id === req.params.id);
  
  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }
  
  const reviews = loadReviews();
  const review = {
    id: uuidv4(),
    serviceId: service.id,
    reviewer,
    rating: parseInt(rating),
    comment: comment || null,
    createdAt: new Date().toISOString()
  };
  
  reviews.push(review);
  saveReviews(reviews);
  
  res.status(201).json(review);
});

// Get categories with counts
router.get('/api/categories', (req, res) => {
  const services = loadServices();
  
  const categories = {};
  services.forEach(s => {
    if (!categories[s.category]) {
      categories[s.category] = 0;
    }
    categories[s.category]++;
  });
  
  const result = Object.entries(categories).map(([name, count]) => ({
    name,
    count
  })).sort((a, b) => b.count - a.count);
  
  res.json(result);
});

// Trending/popular services
router.get('/api/trending', (req, res) => {
  const services = loadServices();
  const reviews = loadReviews();
  
  // Calculate trending score based on recent reviews and views
  const now = new Date();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  
  let trending = services.map(s => {
    const recentReviews = reviews.filter(r => 
      r.serviceId === s.id && new Date(r.createdAt) > weekAgo
    ).length;
    
    const avgRating = reviews.filter(r => r.serviceId === s.id).length > 0
      ? reviews.filter(r => r.serviceId === s.id)
          .reduce((sum, r) => sum + r.rating, 0) / reviews.filter(r => r.serviceId === s.id).length
      : 0;
    
    const trendingScore = (recentReviews * 10) + (avgRating * 2) + (s.views * 0.1);
    
    return {
      ...s,
      trendingScore,
      recentReviews,
      avgRating: avgRating.toFixed(1)
    };
  });
  
  // Sort by trending score
  trending = trending.sort((a, b) => b.trendingScore - a.trendingScore).slice(0, 10);
  
  res.json(trending);
});

// Skill taxonomy endpoint
router.get('/api/skills/taxonomy', (req, res) => {
  const taxonomy = skillTaxonomy.getTaxonomy();
  res.json({
    categories: Object.keys(taxonomy).map(key => ({
      id: key,
      name: taxonomy[key].name,
      tags: taxonomy[key].tags
    })),
    allTags: skillTaxonomy.getAllTags()
  });
});

module.exports = router;
