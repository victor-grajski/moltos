const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const POLICIES_FILE = path.join(__dirname, '../../data/insure/policies.json');
const CLAIMS_FILE = path.join(__dirname, '../../data/insure/claims.json');

function loadPolicies() {
  try {
    return JSON.parse(fs.readFileSync(POLICIES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function savePolicies(policies) {
  fs.writeFileSync(POLICIES_FILE, JSON.stringify(policies, null, 2));
}

function loadClaims() {
  try {
    return JSON.parse(fs.readFileSync(CLAIMS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveClaims(claims) {
  fs.writeFileSync(CLAIMS_FILE, JSON.stringify(claims, null, 2));
}

// Health check
router.get('/health', (req, res) => {
  const policies = loadPolicies();
  const claims = loadClaims();
  
  res.json({ 
    status: 'ok', 
    service: 'moltinsure',
    policies: policies.length,
    claims: claims.length,
    uptime: process.uptime()
  });
});

// List policies
router.get('/api/policies', (req, res) => {
  let policies = loadPolicies();
  
  // Check expiration
  const now = new Date();
  policies = policies.map(p => {
    if (p.expiresAt && new Date(p.expiresAt) < now && p.status === 'active') {
      p.status = 'expired';
    }
    return p;
  });
  
  // Save updated statuses
  savePolicies(policies);
  
  // Sort by creation date, newest first
  policies.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  res.json(policies);
});

// Get policy details
router.get('/api/policies/:id', (req, res) => {
  const policies = loadPolicies();
  const policy = policies.find(p => p.id === req.params.id);
  
  if (!policy) {
    return res.status(404).json({ error: 'Policy not found' });
  }
  
  const claims = loadClaims().filter(c => c.policyId === policy.id);
  
  res.json({
    ...policy,
    claims
  });
});

// Create policy
router.post('/api/policies', (req, res) => {
  const { holder, type, coverage, premium, invoiceId } = req.body;
  
  if (!holder || !type || !coverage || !premium) {
    return res.status(400).json({ 
      error: 'holder, type, coverage, and premium are required' 
    });
  }
  
  const validTypes = ['transaction', 'service', 'escrow'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ 
      error: `type must be one of: ${validTypes.join(', ')}` 
    });
  }
  
  const policies = loadPolicies();
  
  // Default 30-day policy
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  
  const policy = {
    id: uuidv4(),
    holder,
    type,
    coverage: parseFloat(coverage),
    premium: parseFloat(premium),
    invoiceId: invoiceId || null,
    status: 'active',
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  policies.push(policy);
  savePolicies(policies);
  
  res.status(201).json(policy);
});

// File claim
router.post('/api/policies/:id/claim', (req, res) => {
  const { reason, evidence } = req.body;
  
  if (!reason) {
    return res.status(400).json({ error: 'reason is required' });
  }
  
  const policies = loadPolicies();
  const policy = policies.find(p => p.id === req.params.id);
  
  if (!policy) {
    return res.status(404).json({ error: 'Policy not found' });
  }
  
  if (policy.status !== 'active') {
    return res.status(409).json({ 
      error: `Cannot file claim on ${policy.status} policy` 
    });
  }
  
  const claims = loadClaims();
  const claim = {
    id: uuidv4(),
    policyId: policy.id,
    reason,
    evidence: evidence || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolution: null
  };
  
  claims.push(claim);
  saveClaims(claims);
  
  policy.status = 'claimed';
  policy.updatedAt = new Date().toISOString();
  savePolicies(policies);
  
  res.status(201).json(claim);
});

// Approve claim
router.post('/api/policies/:id/approve', (req, res) => {
  const policies = loadPolicies();
  const policy = policies.find(p => p.id === req.params.id);
  
  if (!policy) {
    return res.status(404).json({ error: 'Policy not found' });
  }
  
  if (policy.status !== 'claimed') {
    return res.status(409).json({ error: 'Policy has no pending claim' });
  }
  
  const claims = loadClaims();
  const claim = claims.find(c => c.policyId === policy.id && c.status === 'pending');
  
  if (!claim) {
    return res.status(404).json({ error: 'Claim not found' });
  }
  
  claim.status = 'approved';
  claim.resolution = 'approved';
  claim.resolvedAt = new Date().toISOString();
  saveClaims(claims);
  
  policy.status = 'expired'; // Policy consumed after payout
  policy.updatedAt = new Date().toISOString();
  savePolicies(policies);
  
  res.json({ policy, claim });
});

// Deny claim
router.post('/api/policies/:id/deny', (req, res) => {
  const { reason } = req.body;
  
  if (!reason) {
    return res.status(400).json({ error: 'reason is required' });
  }
  
  const policies = loadPolicies();
  const policy = policies.find(p => p.id === req.params.id);
  
  if (!policy) {
    return res.status(404).json({ error: 'Policy not found' });
  }
  
  if (policy.status !== 'claimed') {
    return res.status(409).json({ error: 'Policy has no pending claim' });
  }
  
  const claims = loadClaims();
  const claim = claims.find(c => c.policyId === policy.id && c.status === 'pending');
  
  if (!claim) {
    return res.status(404).json({ error: 'Claim not found' });
  }
  
  claim.status = 'denied';
  claim.resolution = reason;
  claim.resolvedAt = new Date().toISOString();
  saveClaims(claims);
  
  policy.status = 'active'; // Policy remains active after denied claim
  policy.updatedAt = new Date().toISOString();
  savePolicies(policies);
  
  res.json({ policy, claim });
});

// Insurance pool stats
router.get('/api/stats', (req, res) => {
  const policies = loadPolicies();
  const claims = loadClaims();
  
  const activePolicies = policies.filter(p => p.status === 'active');
  const totalCoverage = activePolicies.reduce((sum, p) => sum + p.coverage, 0);
  const totalPremiums = policies.reduce((sum, p) => sum + p.premium, 0);
  
  const approvedClaims = claims.filter(c => c.status === 'approved').length;
  const totalClaims = claims.length;
  const claimsRatio = totalClaims > 0 ? (approvedClaims / totalClaims * 100).toFixed(2) : 0;
  
  res.json({
    totalCoverage,
    totalPremiums,
    activePolicies: activePolicies.length,
    totalPolicies: policies.length,
    totalClaims,
    approvedClaims,
    claimsRatio: parseFloat(claimsRatio)
  });
});

module.exports = router;
