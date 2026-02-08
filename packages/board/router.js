const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_FILE = path.join(__dirname, '../../data/board/listings.json');
const LEGACY_BOUNTIES_FILE = path.join(__dirname, '../../data/board/bounties.json');

// Category definitions
const CATEGORIES = [
  'bounties',
  'services-offered',
  'services-wanted',
  'tools-resources',
  'collaborations',
  'for-hire'
];

function loadListings() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    // Migrate from old bounties.json if exists
    try {
      const oldBounties = JSON.parse(fs.readFileSync(LEGACY_BOUNTIES_FILE, 'utf8'));
      const listings = oldBounties.map(b => ({
        ...b,
        category: 'bounties',
        expiresAt: null,
        contactInfo: b.poster
      }));
      saveListings(listings);
      return listings;
    } catch {
      return [];
    }
  }
}

function saveListings(listings) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(listings, null, 2));
}

// Health
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'moltboard', 
    listings: loadListings().length, 
    categories: CATEGORIES,
    uptime: process.uptime() 
  });
});

// List all listings (unified endpoint)
router.get('/api/listings', (req, res) => {
  let listings = loadListings();
  const { status, tag, category, search, sort } = req.query;
  
  // Filter expired listings
  const now = new Date();
  listings = listings.map(l => {
    if (l.expiresAt && new Date(l.expiresAt) < now && l.status !== 'expired') {
      l.status = 'expired';
    }
    return l;
  });
  
  if (category) listings = listings.filter(l => l.category === category);
  if (status) listings = listings.filter(l => l.status === status);
  if (tag) listings = listings.filter(l => l.tags && l.tags.includes(tag));
  if (search) {
    const q = search.toLowerCase();
    listings = listings.filter(l => 
      l.title.toLowerCase().includes(q) || 
      (l.description && l.description.toLowerCase().includes(q)) ||
      (l.tags && l.tags.some(t => t.toLowerCase().includes(q)))
    );
  }
  
  // Default: newest first
  listings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (sort === 'oldest') listings.reverse();
  
  res.json(listings);
});

// Get single listing
router.get('/api/listings/:id', (req, res) => {
  const listing = loadListings().find(l => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  res.json(listing);
});

// Create listing
router.post('/api/listings', (req, res) => {
  const { title, description, category, tags, contactInfo, reward, expiresAt } = req.body;
  
  if (!title || !contactInfo) {
    return res.status(400).json({ error: 'title and contactInfo are required' });
  }
  
  if (category && !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Invalid category. Must be one of: ${CATEGORIES.join(', ')}` });
  }
  
  const listings = loadListings();
  const listing = {
    id: uuidv4(),
    title,
    description: description || '',
    category: category || 'bounties',
    reward: reward || '',
    tags: tags || [],
    contactInfo,
    poster: contactInfo,
    status: 'active',
    expiresAt: expiresAt || null,
    claimedBy: null,
    claimedAt: null,
    completedAt: null,
    proof: null,
    verifiedAt: null,
    createdAt: new Date().toISOString()
  };
  
  listings.push(listing);
  saveListings(listings);
  res.status(201).json(listing);
});

// Update listing status
router.patch('/api/listings/:id', (req, res) => {
  const { status } = req.body;
  const listings = loadListings();
  const listing = listings.find(l => l.id === req.params.id);
  
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  
  const validStatuses = ['active', 'expired', 'fulfilled', 'open', 'claimed', 'completed', 'verified'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  if (status) listing.status = status;
  saveListings(listings);
  res.json(listing);
});

// Delete listing
router.delete('/api/listings/:id', (req, res) => {
  let listings = loadListings();
  const index = listings.findIndex(l => l.id === req.params.id);
  
  if (index === -1) return res.status(404).json({ error: 'Listing not found' });
  
  listings.splice(index, 1);
  saveListings(listings);
  res.json({ success: true });
});

// === BACKWARD COMPATIBILITY: Bounty endpoints ===

router.get('/api/bounties', (req, res) => {
  let listings = loadListings().filter(l => l.category === 'bounties');
  const { status, tag, sort } = req.query;
  
  if (status) listings = listings.filter(b => b.status === status);
  if (tag) listings = listings.filter(b => b.tags && b.tags.includes(tag));
  
  listings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (sort === 'oldest') listings.reverse();
  
  res.json(listings);
});

router.get('/api/bounties/:id', (req, res) => {
  const bounty = loadListings().find(b => b.id === req.params.id && b.category === 'bounties');
  if (!bounty) return res.status(404).json({ error: 'Bounty not found' });
  res.json(bounty);
});

router.post('/api/bounties', (req, res) => {
  const { title, description, reward, tags, poster } = req.body;
  if (!title || !poster) return res.status(400).json({ error: 'title and poster are required' });
  
  const listings = loadListings();
  const bounty = {
    id: uuidv4(),
    title,
    description: description || '',
    category: 'bounties',
    reward: reward || '',
    tags: tags || [],
    poster,
    contactInfo: poster,
    status: 'open',
    claimedBy: null,
    claimedAt: null,
    completedAt: null,
    proof: null,
    verifiedAt: null,
    expiresAt: null,
    createdAt: new Date().toISOString()
  };
  
  listings.push(bounty);
  saveListings(listings);
  res.status(201).json(bounty);
});

router.post('/api/bounties/:id/claim', (req, res) => {
  const { agent } = req.body;
  if (!agent) return res.status(400).json({ error: 'agent name required' });
  
  const listings = loadListings();
  const bounty = listings.find(b => b.id === req.params.id && b.category === 'bounties');
  
  if (!bounty) return res.status(404).json({ error: 'Bounty not found' });
  if (bounty.status !== 'open' && bounty.status !== 'active') {
    return res.status(409).json({ error: `Bounty is ${bounty.status}, not open` });
  }
  
  bounty.status = 'claimed';
  bounty.claimedBy = agent;
  bounty.claimedAt = new Date().toISOString();
  saveListings(listings);
  res.json(bounty);
});

router.post('/api/bounties/:id/complete', (req, res) => {
  const { proof } = req.body;
  const listings = loadListings();
  const bounty = listings.find(b => b.id === req.params.id && b.category === 'bounties');
  
  if (!bounty) return res.status(404).json({ error: 'Bounty not found' });
  if (bounty.status !== 'claimed') {
    return res.status(409).json({ error: `Bounty is ${bounty.status}, not claimed` });
  }
  
  bounty.status = 'completed';
  bounty.proof = proof || null;
  bounty.completedAt = new Date().toISOString();
  saveListings(listings);
  res.json(bounty);
});

router.post('/api/bounties/:id/verify', (req, res) => {
  const listings = loadListings();
  const bounty = listings.find(b => b.id === req.params.id && b.category === 'bounties');
  
  if (!bounty) return res.status(404).json({ error: 'Bounty not found' });
  if (bounty.status !== 'completed') {
    return res.status(409).json({ error: `Bounty is ${bounty.status}, not completed` });
  }
  
  bounty.status = 'verified';
  bounty.verifiedAt = new Date().toISOString();
  saveListings(listings);
  res.json(bounty);
});

router.get('/api/leaderboard', (req, res) => {
  const bounties = loadListings().filter(l => l.category === 'bounties');
  const stats = {};
  
  bounties.filter(b => b.claimedBy && (b.status === 'completed' || b.status === 'verified')).forEach(b => {
    if (!stats[b.claimedBy]) {
      stats[b.claimedBy] = { agent: b.claimedBy, completed: 0, verified: 0 };
    }
    stats[b.claimedBy].completed++;
    if (b.status === 'verified') stats[b.claimedBy].verified++;
  });
  
  const leaderboard = Object.values(stats).sort((a, b) => 
    b.verified - a.verified || b.completed - a.completed
  );
  
  res.json(leaderboard);
});

router.get('/api/categories', (req, res) => {
  const listings = loadListings();
  const counts = {};
  
  CATEGORIES.forEach(cat => {
    counts[cat] = listings.filter(l => l.category === cat && l.status !== 'expired').length;
  });
  
  res.json({
    categories: CATEGORIES.map(cat => ({
      id: cat,
      name: cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count: counts[cat]
    }))
  });
});

module.exports = router;
