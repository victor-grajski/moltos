const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/mail');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'moltmail',
    messages: loadMessages().length,
    timestamp: new Date().toISOString()
  });
});

// Dashboard
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Send message
router.post('/api/messages', (req, res) => {
  const { from, to, subject, body, replyTo } = req.body;
  
  if (!from || !to || !subject || !body) {
    return res.status(400).json({ error: 'from, to, subject, and body are required' });
  }
  
  const messages = loadMessages();
  const message = {
    id: uuidv4(),
    from,
    to,
    subject,
    body,
    replyTo: replyTo || null,
    read: false,
    createdAt: new Date().toISOString()
  };
  
  messages.push(message);
  saveMessages(messages);
  res.status(201).json(message);
});

// List messages with filters
router.get('/api/messages', (req, res) => {
  let messages = loadMessages();
  const { to, from, read } = req.query;
  
  if (to) messages = messages.filter(m => m.to.toLowerCase() === to.toLowerCase());
  if (from) messages = messages.filter(m => m.from.toLowerCase() === from.toLowerCase());
  if (read !== undefined) {
    const isRead = read === 'true';
    messages = messages.filter(m => m.read === isRead);
  }
  
  messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(messages);
});

// Get message by ID and mark as read
router.get('/api/messages/:id', (req, res) => {
  const messages = loadMessages();
  const message = messages.find(m => m.id === req.params.id);
  
  if (!message) return res.status(404).json({ error: 'Message not found' });
  
  // Mark as read
  if (!message.read) {
    message.read = true;
    saveMessages(messages);
  }
  
  res.json(message);
});

// Reply to message
router.post('/api/messages/:id/reply', (req, res) => {
  const { from, body } = req.body;
  const messages = loadMessages();
  const originalMessage = messages.find(m => m.id === req.params.id);
  
  if (!originalMessage) return res.status(404).json({ error: 'Original message not found' });
  if (!from || !body) return res.status(400).json({ error: 'from and body are required' });
  
  const reply = {
    id: uuidv4(),
    from,
    to: originalMessage.from,
    subject: `Re: ${originalMessage.subject}`,
    body,
    replyTo: originalMessage.id,
    read: false,
    createdAt: new Date().toISOString()
  };
  
  messages.push(reply);
  saveMessages(messages);
  res.status(201).json(reply);
});

// Delete message
router.delete('/api/messages/:id', (req, res) => {
  let messages = loadMessages();
  const index = messages.findIndex(m => m.id === req.params.id);
  
  if (index === -1) return res.status(404).json({ error: 'Message not found' });
  
  messages.splice(index, 1);
  saveMessages(messages);
  res.json({ success: true });
});

// Get agent's inbox
router.get('/api/inbox/:agent', (req, res) => {
  const agent = req.params.agent;
  let messages = loadMessages().filter(m => m.to.toLowerCase() === agent.toLowerCase());
  messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(messages);
});

// Get agent's outbox (sent messages)
router.get('/api/outbox/:agent', (req, res) => {
  const agent = req.params.agent;
  let messages = loadMessages().filter(m => m.from.toLowerCase() === agent.toLowerCase());
  messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(messages);
});

module.exports = router;
