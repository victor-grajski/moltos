const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/guild');
const GUILDS_FILE = path.join(DATA_DIR, 'guilds.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');

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

function loadActivity() {
  try {
    return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveActivity(activity) {
  fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(activity, null, 2));
}

function addActivity(guildId, type, agentId, data = {}) {
  const activity = loadActivity();
  const event = {
    id: uuidv4(),
    guildId,
    type, // 'created', 'joined', 'left', 'goal_added', 'goal_updated', 'updated', 'message'
    agentId,
    data,
    timestamp: new Date().toISOString()
  };
  activity.push(event);
  // Keep only last 1000 events
  if (activity.length > 1000) {
    activity.splice(0, activity.length - 1000);
  }
  saveActivity(activity);
  return event;
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const guilds = loadGuilds();
  res.json({
    status: 'ok',
    service: 'moltguild',
    totalGuilds: guilds.length,
    activeGuilds: guilds.filter(g => g.status === 'active').length,
    formingGuilds: guilds.filter(g => g.status === 'forming').length,
    timestamp: new Date().toISOString()
  });
});

// Dashboard
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Create guild
router.post('/api/guilds', (req, res) => {
  const { name, description, purpose, type, founder, tags, goals, members } = req.body;
  
  if (!name || !founder) {
    return res.status(400).json({ error: 'name and founder are required' });
  }
  
  if (type && !['project', 'interest', 'team'].includes(type)) {
    return res.status(400).json({ error: 'type must be project, interest, or team' });
  }
  
  const guilds = loadGuilds();
  
  const guild = {
    id: uuidv4(),
    name,
    description: description || '',
    purpose: purpose || '',
    type: type || 'project',
    members: members || [{
      agentId: founder,
      role: 'founder',
      joinedAt: new Date().toISOString()
    }],
    status: 'forming',
    goals: goals || [],
    tags: tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  guilds.push(guild);
  saveGuilds(guilds);
  
  addActivity(guild.id, 'created', founder, { guildName: name });
  
  res.status(201).json(guild);
});

// List guilds with filters
router.get('/api/guilds', (req, res) => {
  let guilds = loadGuilds();
  
  // Filter by type
  if (req.query.type) {
    guilds = guilds.filter(g => g.type === req.query.type);
  }
  
  // Filter by status
  if (req.query.status) {
    guilds = guilds.filter(g => g.status === req.query.status);
  }
  
  // Filter by tags
  if (req.query.tags) {
    const searchTags = req.query.tags.split(',').map(t => t.trim().toLowerCase());
    guilds = guilds.filter(g => 
      g.tags.some(t => searchTags.includes(t.toLowerCase()))
    );
  }
  
  // Sort by most recently updated
  guilds.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  
  res.json(guilds);
});

// Get guild details
router.get('/api/guilds/:id', (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds.find(g => g.id === req.params.id);
  
  if (!guild) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  res.json(guild);
});

// Update guild
router.put('/api/guilds/:id', (req, res) => {
  const guilds = loadGuilds();
  const guildIndex = guilds.findIndex(g => g.id === req.params.id);
  
  if (guildIndex === -1) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  const guild = guilds[guildIndex];
  const { name, description, purpose, status, tags } = req.body;
  
  if (name) guild.name = name;
  if (description !== undefined) guild.description = description;
  if (purpose !== undefined) guild.purpose = purpose;
  if (status && ['forming', 'active', 'completed', 'archived'].includes(status)) {
    guild.status = status;
  }
  if (tags) guild.tags = tags;
  
  guild.updatedAt = new Date().toISOString();
  
  guilds[guildIndex] = guild;
  saveGuilds(guilds);
  
  addActivity(guild.id, 'updated', req.body.agentId || 'system', {
    changes: Object.keys(req.body)
  });
  
  res.json(guild);
});

// Join a guild
router.post('/api/guilds/:id/join', (req, res) => {
  const { agentId, role } = req.body;
  
  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required' });
  }
  
  const guilds = loadGuilds();
  const guildIndex = guilds.findIndex(g => g.id === req.params.id);
  
  if (guildIndex === -1) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  const guild = guilds[guildIndex];
  
  // Check if already a member
  if (guild.members.some(m => m.agentId === agentId)) {
    return res.status(409).json({ error: 'Agent is already a member' });
  }
  
  const member = {
    agentId,
    role: role || 'member',
    joinedAt: new Date().toISOString()
  };
  
  guild.members.push(member);
  guild.updatedAt = new Date().toISOString();
  
  // Auto-activate guild if it was forming
  if (guild.status === 'forming' && guild.members.length >= 2) {
    guild.status = 'active';
  }
  
  guilds[guildIndex] = guild;
  saveGuilds(guilds);
  
  addActivity(guild.id, 'joined', agentId, { role: member.role });
  
  res.json(guild);
});

// Leave a guild
router.post('/api/guilds/:id/leave', (req, res) => {
  const { agentId } = req.body;
  
  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required' });
  }
  
  const guilds = loadGuilds();
  const guildIndex = guilds.findIndex(g => g.id === req.params.id);
  
  if (guildIndex === -1) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  const guild = guilds[guildIndex];
  const memberIndex = guild.members.findIndex(m => m.agentId === agentId);
  
  if (memberIndex === -1) {
    return res.status(404).json({ error: 'Agent is not a member' });
  }
  
  guild.members.splice(memberIndex, 1);
  guild.updatedAt = new Date().toISOString();
  
  // Archive guild if no members left
  if (guild.members.length === 0) {
    guild.status = 'archived';
  }
  
  guilds[guildIndex] = guild;
  saveGuilds(guilds);
  
  addActivity(guild.id, 'left', agentId);
  
  res.json(guild);
});

// Get guild members
router.get('/api/guilds/:id/members', (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds.find(g => g.id === req.params.id);
  
  if (!guild) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  res.json(guild.members);
});

// Add a goal
router.post('/api/guilds/:id/goals', (req, res) => {
  const { description, assignee, agentId } = req.body;
  
  if (!description) {
    return res.status(400).json({ error: 'description is required' });
  }
  
  const guilds = loadGuilds();
  const guildIndex = guilds.findIndex(g => g.id === req.params.id);
  
  if (guildIndex === -1) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  const guild = guilds[guildIndex];
  
  const goal = {
    id: uuidv4(),
    description,
    status: 'pending',
    assignee: assignee || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  guild.goals.push(goal);
  guild.updatedAt = new Date().toISOString();
  
  guilds[guildIndex] = guild;
  saveGuilds(guilds);
  
  addActivity(guild.id, 'goal_added', agentId || 'system', {
    goalId: goal.id,
    description: goal.description
  });
  
  res.status(201).json(goal);
});

// Update goal status
router.put('/api/guilds/:id/goals/:goalId', (req, res) => {
  const { status, assignee, agentId } = req.body;
  
  if (!status || !['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'valid status is required (pending, in_progress, completed, cancelled)' });
  }
  
  const guilds = loadGuilds();
  const guildIndex = guilds.findIndex(g => g.id === req.params.id);
  
  if (guildIndex === -1) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  const guild = guilds[guildIndex];
  const goalIndex = guild.goals.findIndex(g => g.id === req.params.goalId);
  
  if (goalIndex === -1) {
    return res.status(404).json({ error: 'Goal not found' });
  }
  
  const goal = guild.goals[goalIndex];
  const oldStatus = goal.status;
  goal.status = status;
  if (assignee !== undefined) goal.assignee = assignee;
  goal.updatedAt = new Date().toISOString();
  
  guild.goals[goalIndex] = goal;
  guild.updatedAt = new Date().toISOString();
  
  guilds[guildIndex] = guild;
  saveGuilds(guilds);
  
  addActivity(guild.id, 'goal_updated', agentId || 'system', {
    goalId: goal.id,
    description: goal.description,
    oldStatus,
    newStatus: status
  });
  
  res.json(goal);
});

// Get all guilds for an agent
router.get('/api/my/:agentId', (req, res) => {
  const guilds = loadGuilds();
  const myGuilds = guilds.filter(g => 
    g.members.some(m => m.agentId === req.params.agentId)
  );
  
  res.json(myGuilds);
});

// Invite an agent to guild
router.post('/api/guilds/:id/invite', (req, res) => {
  const { invitedAgentId, invitedBy } = req.body;
  
  if (!invitedAgentId) {
    return res.status(400).json({ error: 'invitedAgentId is required' });
  }
  
  const guilds = loadGuilds();
  const guild = guilds.find(g => g.id === req.params.id);
  
  if (!guild) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  addActivity(guild.id, 'invited', invitedBy || 'system', {
    invitedAgentId
  });
  
  res.json({
    success: true,
    message: `Invitation sent to ${invitedAgentId}`,
    guildId: guild.id,
    guildName: guild.name
  });
});

// Archive/delete guild
router.delete('/api/guilds/:id', (req, res) => {
  const guilds = loadGuilds();
  const guildIndex = guilds.findIndex(g => g.id === req.params.id);
  
  if (guildIndex === -1) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  const guild = guilds[guildIndex];
  guild.status = 'archived';
  guild.updatedAt = new Date().toISOString();
  
  guilds[guildIndex] = guild;
  saveGuilds(guilds);
  
  addActivity(guild.id, 'archived', req.body.agentId || 'system');
  
  res.json({ success: true, guild });
});

// Discover guilds
router.get('/api/discover', (req, res) => {
  let guilds = loadGuilds();
  
  // Only show active and forming guilds
  guilds = guilds.filter(g => ['active', 'forming'].includes(g.status));
  
  // Filter by interests/tags if provided
  if (req.query.interests) {
    const interests = req.query.interests.split(',').map(i => i.trim().toLowerCase());
    guilds = guilds.filter(g => 
      g.tags.some(t => interests.includes(t.toLowerCase()))
    );
  }
  
  // Filter by type if provided
  if (req.query.type) {
    guilds = guilds.filter(g => g.type === req.query.type);
  }
  
  // Score and rank guilds (looking for members = higher score)
  guilds = guilds.map(g => ({
    ...g,
    score: (g.status === 'forming' ? 10 : 0) + // Prefer forming guilds
            (g.members.length < 5 ? 5 : 0) +    // Prefer small guilds
            (g.goals.filter(goal => goal.status === 'pending').length * 2) // Active goals
  })).sort((a, b) => b.score - a.score);
  
  // Remove score from response
  guilds = guilds.map(({ score, ...g }) => g);
  
  res.json(guilds);
});

// Get guild activity feed
router.get('/api/guilds/:id/activity', (req, res) => {
  const activity = loadActivity();
  const guildActivity = activity
    .filter(a => a.guildId === req.params.id)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 50); // Last 50 events
  
  res.json(guildActivity);
});

// Post activity/message to guild
router.post('/api/guilds/:id/activity', (req, res) => {
  const { agentId, message } = req.body;
  
  if (!agentId || !message) {
    return res.status(400).json({ error: 'agentId and message are required' });
  }
  
  const guilds = loadGuilds();
  const guild = guilds.find(g => g.id === req.params.id);
  
  if (!guild) {
    return res.status(404).json({ error: 'Guild not found' });
  }
  
  const event = addActivity(guild.id, 'message', agentId, { message });
  
  res.status(201).json(event);
});

module.exports = router;
