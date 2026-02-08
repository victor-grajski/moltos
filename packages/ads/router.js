const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const CAMPAIGNS_FILE = path.join(__dirname, '../../data/ads/campaigns.json');
const IMPRESSIONS_FILE = path.join(__dirname, '../../data/ads/impressions.json');
const CLICKS_FILE = path.join(__dirname, '../../data/ads/clicks.json');

function loadCampaigns() {
  try {
    return JSON.parse(fs.readFileSync(CAMPAIGNS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveCampaigns(campaigns) {
  fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaigns, null, 2));
}

function loadImpressions() {
  try {
    return JSON.parse(fs.readFileSync(IMPRESSIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveImpressions(impressions) {
  fs.writeFileSync(IMPRESSIONS_FILE, JSON.stringify(impressions, null, 2));
}

function loadClicks() {
  try {
    return JSON.parse(fs.readFileSync(CLICKS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveClicks(clicks) {
  fs.writeFileSync(CLICKS_FILE, JSON.stringify(clicks, null, 2));
}

// Health check
router.get('/health', (req, res) => {
  const campaigns = loadCampaigns();
  const impressions = loadImpressions();
  const clicks = loadClicks();
  
  res.json({ 
    status: 'ok', 
    service: 'moltads',
    campaigns: campaigns.length,
    impressions: impressions.length,
    clicks: clicks.length,
    uptime: process.uptime()
  });
});

// List campaigns
router.get('/api/campaigns', (req, res) => {
  let campaigns = loadCampaigns();
  const impressions = loadImpressions();
  const clicks = loadClicks();
  
  // Enrich with metrics
  campaigns = campaigns.map(c => {
    const campaignImpressions = impressions.filter(i => i.campaignId === c.id).length;
    const campaignClicks = clicks.filter(cl => cl.campaignId === c.id).length;
    
    return {
      ...c,
      impressions: campaignImpressions,
      clicks: campaignClicks,
      ctr: campaignImpressions > 0 ? (campaignClicks / campaignImpressions * 100).toFixed(2) : 0
    };
  });
  
  // Sort by creation date, newest first
  campaigns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  res.json(campaigns);
});

// Get campaign details
router.get('/api/campaigns/:id', (req, res) => {
  const campaigns = loadCampaigns();
  const campaign = campaigns.find(c => c.id === req.params.id);
  
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  
  const impressions = loadImpressions().filter(i => i.campaignId === campaign.id);
  const clicks = loadClicks().filter(cl => cl.campaignId === campaign.id);
  
  res.json({
    ...campaign,
    metrics: {
      impressions: impressions.length,
      clicks: clicks.length,
      ctr: impressions.length > 0 ? (clicks.length / impressions.length * 100).toFixed(2) : 0
    },
    recentImpressions: impressions.slice(-10).reverse(),
    recentClicks: clicks.slice(-10).reverse()
  });
});

// Create campaign
router.post('/api/campaigns', (req, res) => {
  const { advertiser, title, content, targetSkills, budget, cpm } = req.body;
  
  if (!advertiser || !title || !content) {
    return res.status(400).json({ 
      error: 'advertiser, title, and content are required' 
    });
  }
  
  const campaigns = loadCampaigns();
  const campaign = {
    id: uuidv4(),
    advertiser,
    title,
    content,
    targetSkills: targetSkills || [],
    budget: budget || 0,
    cpm: cpm || 0,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  campaigns.push(campaign);
  saveCampaigns(campaigns);
  
  res.status(201).json(campaign);
});

// Pause campaign
router.post('/api/campaigns/:id/pause', (req, res) => {
  const campaigns = loadCampaigns();
  const campaign = campaigns.find(c => c.id === req.params.id);
  
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  
  campaign.status = 'paused';
  campaign.updatedAt = new Date().toISOString();
  
  saveCampaigns(campaigns);
  res.json(campaign);
});

// Resume campaign
router.post('/api/campaigns/:id/resume', (req, res) => {
  const campaigns = loadCampaigns();
  const campaign = campaigns.find(c => c.id === req.params.id);
  
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  
  campaign.status = 'active';
  campaign.updatedAt = new Date().toISOString();
  
  saveCampaigns(campaigns);
  res.json(campaign);
});

// Serve ad
router.get('/api/serve', (req, res) => {
  const { skills, context } = req.query;
  const campaigns = loadCampaigns().filter(c => c.status === 'active');
  
  if (campaigns.length === 0) {
    return res.status(404).json({ error: 'No active campaigns available' });
  }
  
  // Simple targeting: match skills if provided
  let targetedCampaigns = campaigns;
  if (skills) {
    const skillArray = Array.isArray(skills) ? skills : [skills];
    targetedCampaigns = campaigns.filter(c => 
      c.targetSkills.length === 0 || 
      c.targetSkills.some(s => skillArray.includes(s))
    );
  }
  
  // Fallback to all campaigns if no matches
  if (targetedCampaigns.length === 0) {
    targetedCampaigns = campaigns;
  }
  
  // Pick random campaign
  const campaign = targetedCampaigns[Math.floor(Math.random() * targetedCampaigns.length)];
  
  // Record impression
  const impressions = loadImpressions();
  impressions.push({
    id: uuidv4(),
    campaignId: campaign.id,
    context: context || null,
    servedAt: new Date().toISOString()
  });
  saveImpressions(impressions);
  
  res.json({
    campaignId: campaign.id,
    title: campaign.title,
    content: campaign.content,
    advertiser: campaign.advertiser
  });
});

// Record click
router.post('/api/campaigns/:id/click', (req, res) => {
  const campaigns = loadCampaigns();
  const campaign = campaigns.find(c => c.id === req.params.id);
  
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  
  const clicks = loadClicks();
  clicks.push({
    id: uuidv4(),
    campaignId: campaign.id,
    clickedAt: new Date().toISOString()
  });
  saveClicks(clicks);
  
  res.json({ success: true });
});

// Publisher earnings
router.get('/api/earnings/:agent', (req, res) => {
  const impressions = loadImpressions();
  const clicks = loadClicks();
  const campaigns = loadCampaigns();
  
  // For now, just count impressions and clicks
  // In a real system, this would calculate actual earnings based on CPM/CPC
  const agentImpressions = impressions.length; // Would filter by agent
  const agentClicks = clicks.length; // Would filter by agent
  
  res.json({
    agent: req.params.agent,
    impressions: agentImpressions,
    clicks: agentClicks,
    estimatedEarnings: (agentImpressions * 0.01 + agentClicks * 0.10).toFixed(2)
  });
});

module.exports = router;
