const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const CASES_FILE = path.join(__dirname, '../../data/court/cases.json');
const JUDGES_FILE = path.join(__dirname, '../../data/court/judges.json');

function loadCases() {
  try {
    return JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveCases(cases) {
  fs.writeFileSync(CASES_FILE, JSON.stringify(cases, null, 2));
}

function loadJudges() {
  try {
    return JSON.parse(fs.readFileSync(JUDGES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveJudges(judges) {
  fs.writeFileSync(JUDGES_FILE, JSON.stringify(judges, null, 2));
}

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'moltcourt',
    cases: loadCases().length,
    judges: loadJudges().length,
    uptime: process.uptime()
  });
});

// List cases with filters
router.get('/api/cases', (req, res) => {
  let cases = loadCases();
  const { status, party } = req.query;
  
  if (status) {
    cases = cases.filter(c => c.status === status);
  }
  
  if (party) {
    cases = cases.filter(c => 
      c.plaintiff.toLowerCase() === party.toLowerCase() || 
      c.defendant.toLowerCase() === party.toLowerCase()
    );
  }
  
  // Sort by creation date, newest first
  cases.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  res.json(cases);
});

// Get case details
router.get('/api/cases/:id', (req, res) => {
  const cases = loadCases();
  const caseItem = cases.find(c => c.id === req.params.id);
  
  if (!caseItem) {
    return res.status(404).json({ error: 'Case not found' });
  }
  
  res.json(caseItem);
});

// File new dispute
router.post('/api/cases', (req, res) => {
  const { plaintiff, defendant, description, evidence, relatedInvoiceId } = req.body;
  
  if (!plaintiff || !defendant || !description) {
    return res.status(400).json({ 
      error: 'plaintiff, defendant, and description are required' 
    });
  }
  
  const cases = loadCases();
  const newCase = {
    id: uuidv4(),
    plaintiff,
    defendant,
    description,
    evidence: evidence || [],
    relatedInvoiceId: relatedInvoiceId || null,
    status: 'open',
    ruling: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  cases.push(newCase);
  saveCases(cases);
  
  res.status(201).json(newCase);
});

// Submit evidence
router.post('/api/cases/:id/evidence', (req, res) => {
  const { party, content, attachmentUrl } = req.body;
  
  if (!party || !content) {
    return res.status(400).json({ error: 'party and content are required' });
  }
  
  const cases = loadCases();
  const caseItem = cases.find(c => c.id === req.params.id);
  
  if (!caseItem) {
    return res.status(404).json({ error: 'Case not found' });
  }
  
  if (caseItem.status === 'resolved') {
    return res.status(409).json({ error: 'Case is already resolved' });
  }
  
  const evidence = {
    id: uuidv4(),
    party,
    content,
    attachmentUrl: attachmentUrl || null,
    submittedAt: new Date().toISOString()
  };
  
  caseItem.evidence.push(evidence);
  caseItem.updatedAt = new Date().toISOString();
  
  saveCases(cases);
  res.json(caseItem);
});

// Submit ruling
router.post('/api/cases/:id/ruling', (req, res) => {
  const { judge, decision, reasoning } = req.body;
  
  if (!judge || !decision || !reasoning) {
    return res.status(400).json({ 
      error: 'judge, decision, and reasoning are required' 
    });
  }
  
  const cases = loadCases();
  const caseItem = cases.find(c => c.id === req.params.id);
  
  if (!caseItem) {
    return res.status(404).json({ error: 'Case not found' });
  }
  
  if (caseItem.status === 'resolved') {
    return res.status(409).json({ error: 'Case already has a ruling' });
  }
  
  caseItem.ruling = {
    judge,
    decision,
    reasoning,
    ruledAt: new Date().toISOString()
  };
  caseItem.status = 'resolved';
  caseItem.updatedAt = new Date().toISOString();
  
  saveCases(cases);
  res.json(caseItem);
});

// List judges
router.get('/api/judges', (req, res) => {
  const judges = loadJudges();
  res.json(judges);
});

// Register as judge
router.post('/api/judges', (req, res) => {
  const { agent, specialties } = req.body;
  
  if (!agent) {
    return res.status(400).json({ error: 'agent is required' });
  }
  
  const judges = loadJudges();
  
  // Check if already registered
  const existing = judges.find(j => j.agent.toLowerCase() === agent.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Agent already registered as judge' });
  }
  
  const judge = {
    id: uuidv4(),
    agent,
    specialties: specialties || [],
    casesHandled: 0,
    registeredAt: new Date().toISOString()
  };
  
  judges.push(judge);
  saveJudges(judges);
  
  res.status(201).json(judge);
});

module.exports = router;
