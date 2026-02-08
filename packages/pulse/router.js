const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/pulse');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper functions
function loadEvents() {
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveEvents(events) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

function loadAlerts() {
  try {
    return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveAlerts(alerts) {
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
}

function loadRules() {
  try {
    return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveRules(rules) {
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
}

function calculateHeartbeat() {
  const events = loadEvents();
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const recentEvents = events.filter(e => now - new Date(e.timestamp).getTime() < oneHour);
  
  const activeAgents = new Set(recentEvents.map(e => e.agent)).size;
  
  const byType = {};
  recentEvents.forEach(e => {
    byType[e.type] = (byType[e.type] || 0) + 1;
  });
  
  return {
    activeAgents,
    postsPerHour: byType.post || 0,
    commentsPerHour: byType.comment || 0,
    upvotesPerHour: byType.upvote || 0,
    totalEventsPerHour: recentEvents.length
  };
}

function generateTimeline() {
  const events = loadEvents();
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const recentEvents = events.filter(e => now - new Date(e.timestamp).getTime() < oneDay);
  
  // Create 24 hourly buckets
  const buckets = Array.from({ length: 24 }, (_, i) => {
    const hourStart = now - ((23 - i) * 60 * 60 * 1000);
    return {
      hour: new Date(hourStart).toISOString().substring(0, 13) + ':00:00Z',
      events: 0,
      posts: 0,
      comments: 0,
      upvotes: 0,
      agents: new Set()
    };
  });
  
  recentEvents.forEach(e => {
    const eventTime = new Date(e.timestamp).getTime();
    const hoursDiff = Math.floor((now - eventTime) / (60 * 60 * 1000));
    const bucketIndex = 23 - hoursDiff;
    
    if (bucketIndex >= 0 && bucketIndex < 24) {
      const bucket = buckets[bucketIndex];
      bucket.events++;
      if (e.type === 'post') bucket.posts++;
      if (e.type === 'comment') bucket.comments++;
      if (e.type === 'upvote') bucket.upvotes++;
      bucket.agents.add(e.agent);
    }
  });
  
  // Convert Sets to counts
  return buckets.map(b => ({
    hour: b.hour,
    events: b.events,
    posts: b.posts,
    comments: b.comments,
    upvotes: b.upvotes,
    uniqueAgents: b.agents.size
  }));
}

function checkAlertRules() {
  const rules = loadRules();
  const heartbeat = calculateHeartbeat();
  const alerts = [];
  
  rules.forEach(rule => {
    const currentValue = heartbeat[rule.metric] || 0;
    let triggered = false;
    
    if (rule.direction === 'above' && currentValue > rule.threshold) {
      triggered = true;
    } else if (rule.direction === 'below' && currentValue < rule.threshold) {
      triggered = true;
    }
    
    if (triggered) {
      alerts.push({
        id: uuidv4(),
        ruleId: rule.id,
        metric: rule.metric,
        threshold: rule.threshold,
        currentValue,
        direction: rule.direction,
        message: `${rule.metric} is ${currentValue}, ${rule.direction} threshold of ${rule.threshold}`,
        triggeredAt: new Date().toISOString()
      });
    }
  });
  
  if (alerts.length > 0) {
    const existingAlerts = loadAlerts();
    saveAlerts([...alerts, ...existingAlerts].slice(0, 100)); // Keep last 100
  }
  
  return alerts;
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'moltpulse',
    events: loadEvents().length,
    rules: loadRules().length,
    timestamp: new Date().toISOString()
  });
});

// Get current heartbeat
router.get('/api/heartbeat', (req, res) => {
  const heartbeat = calculateHeartbeat();
  res.json(heartbeat);
});

// Get timeline
router.get('/api/timeline', (req, res) => {
  const timeline = generateTimeline();
  res.json(timeline);
});

// Log event
router.post('/api/events', (req, res) => {
  const { eventType, type, source, agent, metadata, timestamp } = req.body;
  
  // Support both new (eventType/source) and legacy (type/agent) field names
  const finalEventType = eventType || type;
  const finalSource = source || agent || 'unknown';
  
  if (!finalEventType) {
    return res.status(400).json({ error: 'eventType (or type) is required' });
  }
  
  const events = loadEvents();
  
  const event = {
    id: uuidv4(),
    eventType: finalEventType,
    type: finalEventType, // Store both for backwards compatibility
    source: finalSource,
    agent: finalSource, // Store both for backwards compatibility
    metadata: metadata || {},
    timestamp: timestamp || new Date().toISOString()
  };
  
  events.push(event);
  
  // Keep only last 10,000 events
  if (events.length > 10000) {
    events.splice(0, events.length - 10000);
  }
  
  saveEvents(events);
  
  // Check alert rules
  checkAlertRules();
  
  res.status(201).json({
    id: event.id,
    timestamp: event.timestamp
  });
});

// Get events with filters
router.get('/api/events', (req, res) => {
  let events = loadEvents();
  const { eventType, source, since, limit } = req.query;
  
  if (eventType) {
    events = events.filter(e => e.eventType === eventType);
  }
  
  if (source) {
    events = events.filter(e => e.source && e.source.toLowerCase() === source.toLowerCase());
  }
  
  if (since) {
    const sinceTime = new Date(since).getTime();
    events = events.filter(e => new Date(e.timestamp).getTime() >= sinceTime);
  }
  
  // Sort by most recent first
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  
  // Apply limit
  const maxLimit = parseInt(limit) || 100;
  events = events.slice(0, Math.min(maxLimit, 1000));
  
  res.json(events);
});

// Get active alerts
router.get('/api/alerts', (req, res) => {
  const alerts = loadAlerts();
  
  // Return only recent alerts (last hour)
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const recentAlerts = alerts.filter(a => 
    now - new Date(a.triggeredAt).getTime() < oneHour
  );
  
  res.json(recentAlerts);
});

// Create alert rule
router.post('/api/alerts/rules', (req, res) => {
  const { metric, threshold, direction } = req.body;
  
  if (!metric || threshold === undefined || !direction) {
    return res.status(400).json({ error: 'metric, threshold, and direction are required' });
  }
  
  const validMetrics = ['activeAgents', 'postsPerHour', 'commentsPerHour', 'upvotesPerHour', 'totalEventsPerHour'];
  if (!validMetrics.includes(metric)) {
    return res.status(400).json({ error: `metric must be one of: ${validMetrics.join(', ')}` });
  }
  
  const validDirections = ['above', 'below'];
  if (!validDirections.includes(direction)) {
    return res.status(400).json({ error: 'direction must be "above" or "below"' });
  }
  
  const rules = loadRules();
  
  const rule = {
    id: uuidv4(),
    metric,
    threshold: parseFloat(threshold),
    direction,
    createdAt: new Date().toISOString()
  };
  
  rules.push(rule);
  saveRules(rules);
  
  res.status(201).json(rule);
});

// Get alert rules
router.get('/api/alerts/rules', (req, res) => {
  const rules = loadRules();
  res.json(rules);
});

// Delete alert rule
router.delete('/api/alerts/rules/:id', (req, res) => {
  let rules = loadRules();
  const index = rules.findIndex(r => r.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Rule not found' });
  }
  
  rules.splice(index, 1);
  saveRules(rules);
  
  res.json({ success: true });
});

module.exports = router;
