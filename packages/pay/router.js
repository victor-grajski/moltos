const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data/pay');
const INVOICES_FILE = path.join(DATA_DIR, 'invoices.json');

// Ensure data files exist
function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(INVOICES_FILE)) {
    fs.writeFileSync(INVOICES_FILE, JSON.stringify([], null, 2));
  }
}

function loadInvoices() {
  ensureDataFiles();
  try {
    return JSON.parse(fs.readFileSync(INVOICES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveInvoices(invoices) {
  fs.writeFileSync(INVOICES_FILE, JSON.stringify(invoices, null, 2));
}

// Invoice state machine validation
const VALID_TRANSITIONS = {
  'created': ['funded', 'expired'],
  'funded': ['released', 'disputed'],
  'disputed': ['released', 'refunded'],
  'released': [],
  'refunded': [],
  'expired': []
};

function canTransitionTo(currentStatus, newStatus) {
  return VALID_TRANSITIONS[currentStatus]?.includes(newStatus) || false;
}

// ============ API ENDPOINTS ============

// Health check
router.get('/health', (req, res) => {
  const invoices = loadInvoices();
  const activeInvoices = invoices.filter(i => 
    ['created', 'funded', 'disputed'].includes(i.status)
  ).length;
  
  res.json({ 
    status: 'ok', 
    service: 'moltpay',
    totalInvoices: invoices.length,
    activeInvoices,
    timestamp: new Date().toISOString() 
  });
});

// Serve dashboard
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create invoice
router.post('/api/invoices', (req, res) => {
  try {
    const { from, to, amount, currency, description, bountyId } = req.body;
    
    if (!from || !to || !amount || !currency) {
      return res.status(400).json({ 
        error: 'from, to, amount, and currency are required' 
      });
    }
    
    const invoices = loadInvoices();
    const invoice = {
      id: uuidv4(),
      from,
      to,
      amount: parseFloat(amount),
      currency: currency.toUpperCase(),
      description: description || '',
      bountyId: bountyId || null,
      status: 'created',
      createdAt: new Date().toISOString(),
      fundedAt: null,
      releasedAt: null,
      disputedAt: null,
      disputeReason: null,
      resolvedAt: null,
      txHash: null
    };
    
    invoices.push(invoice);
    saveInvoices(invoices);
    
    res.status(201).json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List invoices with filters
router.get('/api/invoices', (req, res) => {
  try {
    let invoices = loadInvoices();
    const { status, from, to } = req.query;
    
    if (status) {
      invoices = invoices.filter(i => i.status === status);
    }
    
    if (from) {
      invoices = invoices.filter(i => 
        i.from.toLowerCase().includes(from.toLowerCase())
      );
    }
    
    if (to) {
      invoices = invoices.filter(i => 
        i.to.toLowerCase().includes(to.toLowerCase())
      );
    }
    
    // Sort by creation date, newest first
    invoices.sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single invoice
router.get('/api/invoices/:id', (req, res) => {
  try {
    const invoices = loadInvoices();
    const invoice = invoices.find(i => i.id === req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark invoice as funded (escrow)
router.post('/api/invoices/:id/fund', (req, res) => {
  try {
    const { txHash } = req.body;
    const invoices = loadInvoices();
    const invoice = invoices.find(i => i.id === req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    if (!canTransitionTo(invoice.status, 'funded')) {
      return res.status(409).json({ 
        error: `Cannot fund invoice with status '${invoice.status}'` 
      });
    }
    
    invoice.status = 'funded';
    invoice.fundedAt = new Date().toISOString();
    invoice.txHash = txHash || null;
    
    saveInvoices(invoices);
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Release escrow to recipient
router.post('/api/invoices/:id/release', (req, res) => {
  try {
    const { txHash } = req.body;
    const invoices = loadInvoices();
    const invoice = invoices.find(i => i.id === req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    if (!canTransitionTo(invoice.status, 'released')) {
      return res.status(409).json({ 
        error: `Cannot release invoice with status '${invoice.status}'` 
      });
    }
    
    invoice.status = 'released';
    invoice.releasedAt = new Date().toISOString();
    invoice.resolvedAt = new Date().toISOString();
    if (txHash) invoice.txHash = txHash;
    
    saveInvoices(invoices);
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Open dispute
router.post('/api/invoices/:id/dispute', (req, res) => {
  try {
    const { reason } = req.body;
    const invoices = loadInvoices();
    const invoice = invoices.find(i => i.id === req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    if (!canTransitionTo(invoice.status, 'disputed')) {
      return res.status(409).json({ 
        error: `Cannot dispute invoice with status '${invoice.status}'` 
      });
    }
    
    invoice.status = 'disputed';
    invoice.disputedAt = new Date().toISOString();
    invoice.disputeReason = reason || 'No reason provided';
    
    saveInvoices(invoices);
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get payment stats
router.get('/api/stats', (req, res) => {
  try {
    const invoices = loadInvoices();
    
    // Total volume (released invoices only)
    const releasedInvoices = invoices.filter(i => i.status === 'released');
    const totalVolume = releasedInvoices.reduce((sum, i) => sum + i.amount, 0);
    
    // Active escrows (funded invoices)
    const activeEscrows = invoices.filter(i => i.status === 'funded');
    const escrowTotal = activeEscrows.reduce((sum, i) => sum + i.amount, 0);
    
    // Top earners
    const earningsMap = {};
    releasedInvoices.forEach(i => {
      earningsMap[i.to] = (earningsMap[i.to] || 0) + i.amount;
    });
    const topEarners = Object.entries(earningsMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([agent, earnings]) => ({ agent, earnings }));
    
    // Status breakdown
    const statusCounts = {};
    invoices.forEach(i => {
      statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;
    });
    
    res.json({
      totalVolume: totalVolume.toFixed(2),
      completedPayments: releasedInvoices.length,
      activeEscrows: activeEscrows.length,
      escrowTotal: escrowTotal.toFixed(2),
      totalInvoices: invoices.length,
      topEarners,
      statusBreakdown: statusCounts,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
