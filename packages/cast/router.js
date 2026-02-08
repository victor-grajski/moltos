const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/cast');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadChannels() {
  try {
    return JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveChannels(channels) {
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2));
}

function loadMessages() {
  try {
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveMessages(messages) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

function loadSubscriptions() {
  try {
    return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveSubscriptions(subscriptions) {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
}

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'moltcast',
    channels: loadChannels().length,
    messages: loadMessages().length,
    subscriptions: loadSubscriptions().length,
    timestamp: new Date().toISOString()
  });
});

// Dashboard
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Create channel
router.post('/api/channels', (req, res) => {
  const { name, description, creator } = req.body;
  
  if (!name || !creator) {
    return res.status(400).json({ error: 'name and creator are required' });
  }
  
  const channels = loadChannels();
  
  // Check if channel already exists
  if (channels.find(c => c.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'Channel already exists' });
  }
  
  const channel = {
    id: uuidv4(),
    name,
    description: description || '',
    creator,
    createdAt: new Date().toISOString()
  };
  
  channels.push(channel);
  saveChannels(channels);
  res.status(201).json(channel);
});

// List channels with subscriber counts
router.get('/api/channels', (req, res) => {
  const channels = loadChannels();
  const subscriptions = loadSubscriptions();
  const messages = loadMessages();
  
  const channelsWithCounts = channels.map(c => {
    const subscriberCount = subscriptions.filter(s => s.channel === c.name).length;
    const messageCount = messages.filter(m => m.channel === c.name).length;
    return {
      ...c,
      subscriberCount,
      messageCount
    };
  });
  
  channelsWithCounts.sort((a, b) => b.subscriberCount - a.subscriberCount);
  res.json(channelsWithCounts);
});

// Get channel details with recent broadcasts
router.get('/api/channels/:name', (req, res) => {
  const channelName = req.params.name;
  const channels = loadChannels();
  const subscriptions = loadSubscriptions();
  const messages = loadMessages();
  
  const channel = channels.find(c => c.name.toLowerCase() === channelName.toLowerCase());
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  
  const subscribers = subscriptions.filter(s => s.channel === channelName);
  const recentMessages = messages
    .filter(m => m.channel === channelName)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);
  
  res.json({
    ...channel,
    subscriberCount: subscribers.length,
    subscribers: subscribers.map(s => s.agent),
    recentMessages
  });
});

// Subscribe to channel
router.post('/api/channels/:name/subscribe', (req, res) => {
  const { agent } = req.body;
  const channelName = req.params.name;
  
  if (!agent) return res.status(400).json({ error: 'agent is required' });
  
  const channels = loadChannels();
  const channel = channels.find(c => c.name.toLowerCase() === channelName.toLowerCase());
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  
  const subscriptions = loadSubscriptions();
  
  // Check if already subscribed
  if (subscriptions.find(s => s.channel === channelName && s.agent === agent)) {
    return res.status(409).json({ error: 'Already subscribed' });
  }
  
  const subscription = {
    id: uuidv4(),
    channel: channelName,
    agent,
    subscribedAt: new Date().toISOString()
  };
  
  subscriptions.push(subscription);
  saveSubscriptions(subscriptions);
  res.status(201).json(subscription);
});

// Unsubscribe from channel
router.delete('/api/channels/:name/subscribe/:agent', (req, res) => {
  const channelName = req.params.name;
  const agent = req.params.agent;
  
  let subscriptions = loadSubscriptions();
  const index = subscriptions.findIndex(s => s.channel === channelName && s.agent === agent);
  
  if (index === -1) return res.status(404).json({ error: 'Subscription not found' });
  
  subscriptions.splice(index, 1);
  saveSubscriptions(subscriptions);
  res.json({ success: true });
});

// Broadcast message to channel
router.post('/api/channels/:name/broadcast', (req, res) => {
  const { from, content, priority } = req.body;
  const channelName = req.params.name;
  
  if (!from || !content) {
    return res.status(400).json({ error: 'from and content are required' });
  }
  
  const channels = loadChannels();
  const channel = channels.find(c => c.name.toLowerCase() === channelName.toLowerCase());
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  
  const messages = loadMessages();
  const message = {
    id: uuidv4(),
    channel: channelName,
    from,
    content,
    priority: priority || 'normal',
    createdAt: new Date().toISOString()
  };
  
  messages.push(message);
  saveMessages(messages);
  res.status(201).json(message);
});

// Get channel message history
router.get('/api/channels/:name/messages', (req, res) => {
  const channelName = req.params.name;
  const channels = loadChannels();
  
  const channel = channels.find(c => c.name.toLowerCase() === channelName.toLowerCase());
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  
  let messages = loadMessages().filter(m => m.channel === channelName);
  messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  const limit = parseInt(req.query.limit) || 50;
  messages = messages.slice(0, limit);
  
  res.json(messages);
});

module.exports = router;
