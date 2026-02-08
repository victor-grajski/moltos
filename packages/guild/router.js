const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/guild');
const GUILDS_FILE = path.join(DATA_DIR, 'guilds.json');
const APPLICATIONS_FILE = path.join(DATA_DIR, 'applications.json');
const TREASURY_FILE = path.join(DATA_DIR, 'treasury.json');
const CERTIFICATIONS_FILE = path.join(DATA_DIR, 'certifications.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper functions
function loadGuilds() {
  try {
    return JSON.parse(fs.readFileSync(GUILDS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveGuilds(guilds) {
  fs.writeFileSync(GUILDS_FILE, JSON.stringify(guilds, null, 2));
}

function loadApplications() {
  try {
    return JSON.parse(fs.readFileSync(APPLICATIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveApplications(applications) {
  fs.writeFileSync(APPLICATIONS_FILE, JSON.stringify(applications, null, 2));
}

function loadTreasury() {
  try {
    return JSON.parse(fs.readFileSync(TREASURY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveTreasury(treasury) {
  fs.writeFileSync(TREASURY_FILE, JSON.stringify(treasury, null, 2));
}

function loadCertifications() {
  try {
    return JSON.parse(fs.readFileSync(CERTIFICATIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveCertifications(certifications) {
  fs.writeFileSync(CERTIFICATIONS_FILE, JSON.stringify(certifications, null, 2));
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'moltguild',
    guilds: loadGuilds().length,
    applications: loadApplications().filter(a => a.status === 'pending').length,
    certifications: loadCertifications().length,
    timestamp: new Date().toISOString()
  });
});

// Dashboard
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Create guild
router.post('/api/guilds', (req, res) => {
  const { name, description, founder, charter, requirements } = req.body;
  
  if (!name || !founder) {
    return res.status(400).json({ error: 'name and founder are required' });
  }
  
  const guilds = loadGuilds();
  
  // Check if guild already exists
  if (guilds.find(g => g.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'Guild with this name already exists' });
  }
  
  const guild = {
    id: uuidv4(),
    name,
    description: description || '',
    founder,
    charter: charter || '',
    requirements: requirements || [],
    members: [founder],
    reputation: 0,
    createdAt: new Date().toISOString()
  };
  
  guilds.push(guild);
  saveGuilds(guilds);
  res.status(201).json(guild);
});

// List guilds with member counts
router.get('/api/guilds', (req, res) => {
  const guilds = loadGuilds();
  const applications = loadApplications();
  
  const guildsWithStats = guilds.map(g => ({
    ...g,
    memberCount: g.members.length,
    pendingApplications: applications.filter(a => a.guildId === g.id && a.status === 'pending').length
  }));
  
  guildsWithStats.sort((a, b) => b.memberCount - a.memberCount);
  res.json(guildsWithStats);
});

// Get guild details
router.get('/api/guilds/:id', (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds.find(g => g.id === req.params.id);
  
  if (!guild) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  const applications = loadApplications().filter(a => a.guildId === req.params.id);
  const treasury = loadTreasury().filter(t => t.guildId === req.params.id);
  const certifications = loadCertifications().filter(c => c.guildId === req.params.id);
  
  const totalBalance = treasury
    .filter(t => t.type === 'deposit')
    .reduce((sum, t) => sum + t.amount, 0) -
    treasury
    .filter(t => t.type === 'withdrawal')
    .reduce((sum, t) => sum + t.amount, 0);
  
  res.json({
    ...guild,
    applications: applications.filter(a => a.status === 'pending'),
    treasuryBalance: totalBalance,
    certifiedMembers: certifications.filter(c => c.status === 'active').length
  });
});

// Apply for membership
router.post('/api/guilds/:id/apply', (req, res) => {
  const { agent, qualifications } = req.body;
  
  if (!agent) {
    return res.status(400).json({ error: 'agent is required' });
  }
  
  const guilds = loadGuilds();
  const guild = guilds.find(g => g.id === req.params.id);
  
  if (!guild) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  // Check if already a member
  if (guild.members.includes(agent)) {
    return res.status(409).json({ error: 'Agent is already a member' });
  }
  
  const applications = loadApplications();
  
  // Check if already applied
  const existingApp = applications.find(a => 
    a.guildId === req.params.id && 
    a.agent === agent && 
    a.status === 'pending'
  );
  
  if (existingApp) {
    return res.status(409).json({ error: 'Application already pending' });
  }
  
  const application = {
    id: uuidv4(),
    guildId: req.params.id,
    agent,
    qualifications: qualifications || '',
    status: 'pending',
    appliedAt: new Date().toISOString()
  };
  
  applications.push(application);
  saveApplications(applications);
  res.status(201).json(application);
});

// Approve membership
router.post('/api/guilds/:id/approve/:applicationId', (req, res) => {
  const applications = loadApplications();
  const application = applications.find(a => 
    a.id === req.params.applicationId && 
    a.guildId === req.params.id
  );
  
  if (!application) {
    return res.status(404).json({ error: 'Application not found' });
  }
  
  if (application.status !== 'pending') {
    return res.status(409).json({ error: 'Application already processed' });
  }
  
  const guilds = loadGuilds();
  const guild = guilds.find(g => g.id === req.params.id);
  
  if (!guild) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  // Add agent to guild members
  if (!guild.members.includes(application.agent)) {
    guild.members.push(application.agent);
  }
  
  application.status = 'approved';
  application.approvedAt = new Date().toISOString();
  
  saveGuilds(guilds);
  saveApplications(applications);
  
  res.json({ success: true, application, guild });
});

// Deposit to guild treasury
router.post('/api/guilds/:id/treasury/deposit', (req, res) => {
  const { agent, amount } = req.body;
  
  if (!agent || !amount || amount <= 0) {
    return res.status(400).json({ error: 'agent and positive amount are required' });
  }
  
  const guilds = loadGuilds();
  const guild = guilds.find(g => g.id === req.params.id);
  
  if (!guild) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  const treasury = loadTreasury();
  
  const transaction = {
    id: uuidv4(),
    guildId: req.params.id,
    agent,
    type: 'deposit',
    amount,
    timestamp: new Date().toISOString()
  };
  
  treasury.push(transaction);
  saveTreasury(treasury);
  res.status(201).json(transaction);
});

// Get treasury balance and history
router.get('/api/guilds/:id/treasury', (req, res) => {
  const treasury = loadTreasury().filter(t => t.guildId === req.params.id);
  
  const deposits = treasury.filter(t => t.type === 'deposit').reduce((sum, t) => sum + t.amount, 0);
  const withdrawals = treasury.filter(t => t.type === 'withdrawal').reduce((sum, t) => sum + t.amount, 0);
  const balance = deposits - withdrawals;
  
  res.json({
    guildId: req.params.id,
    balance,
    deposits,
    withdrawals,
    transactions: treasury.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  });
});

// Get guild standards
router.get('/api/guilds/:id/standards', (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds.find(g => g.id === req.params.id);
  
  if (!guild) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  res.json({
    guildId: req.params.id,
    guildName: guild.name,
    charter: guild.charter,
    requirements: guild.requirements
  });
});

// Certify agent meets guild standards
router.post('/api/guilds/:id/certify/:agent', (req, res) => {
  const { agent } = req.params;
  
  const guilds = loadGuilds();
  const guild = guilds.find(g => g.id === req.params.id);
  
  if (!guild) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  // Check if agent is a member
  if (!guild.members.includes(agent)) {
    return res.status(403).json({ error: 'Agent must be a guild member to be certified' });
  }
  
  const certifications = loadCertifications();
  
  // Check if already certified
  const existing = certifications.find(c => 
    c.guildId === req.params.id && 
    c.agent === agent && 
    c.status === 'active'
  );
  
  if (existing) {
    return res.status(409).json({ error: 'Agent already certified' });
  }
  
  const certification = {
    id: uuidv4(),
    guildId: req.params.id,
    guildName: guild.name,
    agent,
    status: 'active',
    certifiedAt: new Date().toISOString()
  };
  
  certifications.push(certification);
  saveCertifications(certifications);
  res.status(201).json(certification);
});

module.exports = router;
