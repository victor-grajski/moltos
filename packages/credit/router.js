const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/credit');
const APPLICATIONS_FILE = path.join(DATA_DIR, 'applications.json');
const LOANS_FILE = path.join(DATA_DIR, 'loans.json');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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

function loadLoans() {
  try {
    return JSON.parse(fs.readFileSync(LOANS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveLoans(loans) {
  fs.writeFileSync(LOANS_FILE, JSON.stringify(loans, null, 2));
}

function loadScores() {
  try {
    return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveScores(scores) {
  fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2));
}

function calculateCreditScore(agent) {
  const loans = loadLoans().filter(l => l.borrower === agent);
  const applications = loadApplications().filter(a => a.agent === agent);
  
  let score = 500; // Base score
  
  // Good payment history increases score
  const completedLoans = loans.filter(l => l.status === 'completed');
  score += completedLoans.length * 20;
  
  // Defaults decrease score
  const defaultedLoans = loans.filter(l => l.status === 'defaulted');
  score -= defaultedLoans.length * 100;
  
  // Active loans slightly decrease score
  const activeLoans = loans.filter(l => l.status === 'active');
  score -= activeLoans.length * 10;
  
  // Approved applications increase score slightly
  const approved = applications.filter(a => a.status === 'approved');
  score += approved.length * 5;
  
  return Math.max(300, Math.min(850, score));
}

// Serve dashboard
router.use(express.static(path.join(__dirname, 'public')));

// Health check
router.get('/health', (req, res) => {
  const applications = loadApplications();
  const loans = loadLoans();
  res.json({
    status: 'ok',
    service: 'moltcredit',
    applications: applications.length,
    activeLoans: loans.filter(l => l.status === 'active').length,
    timestamp: new Date().toISOString()
  });
});

// Apply for credit
router.post('/api/applications', (req, res) => {
  const { agent, amount, purpose, term } = req.body;
  
  if (!agent || !amount || !purpose || !term) {
    return res.status(400).json({ error: 'agent, amount, purpose, and term are required' });
  }
  
  const creditScore = calculateCreditScore(agent);
  
  const applications = loadApplications();
  const application = {
    id: uuidv4(),
    agent,
    amount: parseFloat(amount),
    purpose,
    term,
    creditScore,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  
  applications.push(application);
  saveApplications(applications);
  
  // Update credit score cache
  const scores = loadScores();
  scores[agent] = creditScore;
  saveScores(scores);
  
  res.status(201).json(application);
});

// List applications
router.get('/api/applications', (req, res) => {
  let applications = loadApplications();
  const { status } = req.query;
  
  if (status) {
    applications = applications.filter(a => a.status === status);
  }
  
  applications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(applications);
});

// Get application details
router.get('/api/applications/:id', (req, res) => {
  const applications = loadApplications();
  const application = applications.find(a => a.id === req.params.id);
  
  if (!application) {
    return res.status(404).json({ error: 'Application not found' });
  }
  
  res.json(application);
});

// Approve application
router.post('/api/applications/:id/approve', (req, res) => {
  const { lender, terms } = req.body;
  const applications = loadApplications();
  const application = applications.find(a => a.id === req.params.id);
  
  if (!application) {
    return res.status(404).json({ error: 'Application not found' });
  }
  
  if (application.status !== 'pending') {
    return res.status(400).json({ error: 'Application already processed' });
  }
  
  if (!lender) {
    return res.status(400).json({ error: 'lender is required' });
  }
  
  // Create loan
  const loans = loadLoans();
  const loan = {
    id: uuidv4(),
    applicationId: req.params.id,
    borrower: application.agent,
    lender,
    amount: application.amount,
    term: application.term,
    terms: terms || {},
    balance: application.amount,
    status: 'active',
    createdAt: new Date().toISOString()
  };
  
  loans.push(loan);
  saveLoans(loans);
  
  // Update application
  application.status = 'approved';
  application.lender = lender;
  application.approvedAt = new Date().toISOString();
  saveApplications(applications);
  
  res.json({ application, loan });
});

// Deny application
router.post('/api/applications/:id/deny', (req, res) => {
  const { reason } = req.body;
  const applications = loadApplications();
  const application = applications.find(a => a.id === req.params.id);
  
  if (!application) {
    return res.status(404).json({ error: 'Application not found' });
  }
  
  if (application.status !== 'pending') {
    return res.status(400).json({ error: 'Application already processed' });
  }
  
  application.status = 'denied';
  application.reason = reason || 'Not specified';
  application.deniedAt = new Date().toISOString();
  
  saveApplications(applications);
  res.json(application);
});

// Get active loans
router.get('/api/loans', (req, res) => {
  const loans = loadLoans();
  loans.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(loans);
});

// Make repayment
router.post('/api/loans/:id/repay', (req, res) => {
  const { amount } = req.body;
  const loans = loadLoans();
  const loan = loans.find(l => l.id === req.params.id);
  
  if (!loan) {
    return res.status(404).json({ error: 'Loan not found' });
  }
  
  if (loan.status !== 'active') {
    return res.status(400).json({ error: 'Loan is not active' });
  }
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }
  
  const paymentAmount = parseFloat(amount);
  loan.balance -= paymentAmount;
  
  if (loan.balance <= 0) {
    loan.status = 'completed';
    loan.completedAt = new Date().toISOString();
  }
  
  loan.lastPayment = {
    amount: paymentAmount,
    date: new Date().toISOString()
  };
  
  saveLoans(loans);
  
  // Recalculate credit score
  const creditScore = calculateCreditScore(loan.borrower);
  const scores = loadScores();
  scores[loan.borrower] = creditScore;
  saveScores(scores);
  
  res.json(loan);
});

// Get credit score
router.get('/api/score/:agent', (req, res) => {
  const agent = req.params.agent;
  const creditScore = calculateCreditScore(agent);
  
  const loans = loadLoans().filter(l => l.borrower === agent);
  const applications = loadApplications().filter(a => a.agent === agent);
  
  res.json({
    agent,
    creditScore,
    totalLoans: loans.length,
    activeLoans: loans.filter(l => l.status === 'active').length,
    completedLoans: loans.filter(l => l.status === 'completed').length,
    defaultedLoans: loans.filter(l => l.status === 'defaulted').length,
    totalApplications: applications.length
  });
});

// Get stats
router.get('/api/stats', (req, res) => {
  const loans = loadLoans();
  const applications = loadApplications();
  const scores = loadScores();
  
  const totalLending = loans.reduce((sum, l) => sum + l.amount, 0);
  const totalOutstanding = loans
    .filter(l => l.status === 'active')
    .reduce((sum, l) => sum + l.balance, 0);
  
  const defaultRate = loans.length > 0
    ? (loans.filter(l => l.status === 'defaulted').length / loans.length * 100).toFixed(1)
    : 0;
  
  const avgCreditScore = Object.values(scores).length > 0
    ? (Object.values(scores).reduce((sum, s) => sum + s, 0) / Object.values(scores).length).toFixed(0)
    : 0;
  
  res.json({
    totalLending,
    totalOutstanding,
    activeLoans: loans.filter(l => l.status === 'active').length,
    defaultRate: parseFloat(defaultRate),
    avgCreditScore: parseInt(avgCreditScore),
    pendingApplications: applications.filter(a => a.status === 'pending').length
  });
});

module.exports = router;
