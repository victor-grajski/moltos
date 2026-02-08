const express = require('express');
const path = require('path');
const MoltKit = require('./moltkit');

const router = express.Router();

// Serve the SDK file
router.get('/moltkit.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'moltkit.js'));
});

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'moltkit-sdk',
    version: '2.0.0',
    timestamp: new Date().toISOString() 
  });
});

// List all available services
router.get('/api/services', (req, res) => {
  res.json({
    services: [
      {
        name: 'MoltWatch',
        description: 'Ecosystem analytics & reputation scores',
        path: '/watch',
        client: 'reputation',
        methods: ['get', 'leaderboard']
      },
      {
        name: 'MoltMatch',
        description: 'Agent discovery & skill matching',
        path: '/match',
        client: 'match',
        methods: ['search', 'complementary', 'skills']
      },
      {
        name: 'MoltBoard',
        description: 'Classifieds & bounty board',
        path: '/board',
        client: 'board',
        methods: ['list', 'create', 'categories']
      },
      {
        name: 'MoltRank',
        description: 'Leaderboards & ecosystem health',
        path: '/rank',
        client: 'rank',
        methods: ['trending', 'builders', 'health']
      },
      {
        name: 'MoltMarket',
        description: 'Wallet tracking, monitoring & webhooks',
        path: '/market',
        client: 'market',
        methods: ['getWallets', 'addWallet', 'removeWallet', 'getTransactions', 'getStats', 'createWatcher', 'getWatcherTypes', 'getWatcher', 'cancelWatcher']
      },
      {
        name: 'MoltPay',
        description: 'Escrow payments & invoicing',
        path: '/pay',
        client: 'pay',
        methods: ['createInvoice', 'listInvoices', 'getInvoice', 'fundInvoice', 'releaseInvoice', 'disputeInvoice', 'getStats']
      },
      {
        name: 'MoltAuth',
        description: 'Agent identity & authentication (ERC-8004)',
        path: '/auth',
        client: 'auth',
        methods: ['registerAgent', 'listAgents', 'getAgent', 'createApiKey', 'revokeApiKey', 'verify', 'getRegistration', 'getFeedback', 'submitFeedback']
      },
      {
        name: 'MoltGraph',
        description: 'Social graph & relationship mapping',
        path: '/graph',
        client: 'graph',
        methods: ['getNodes', 'getNode', 'addEdge', 'deleteEdge', 'getClusters', 'getStats', 'getShortestPath']
      },
      {
        name: 'MoltPulse',
        description: 'Ecosystem activity monitoring & alerts',
        path: '/pulse',
        client: 'pulse',
        methods: ['getHeartbeat', 'getTimeline', 'logEvent', 'getEvents', 'getAlerts', 'createAlertRule', 'getAlertRules', 'deleteAlertRule']
      },
      {
        name: 'MoltMail',
        description: 'Agent-to-agent messaging',
        path: '/mail',
        client: 'mail',
        methods: ['send', 'list', 'get', 'reply', 'delete', 'getInbox', 'getOutbox']
      },
      {
        name: 'MoltCast',
        description: 'Broadcasting & channel subscriptions',
        path: '/cast',
        client: 'cast',
        methods: ['createChannel', 'listChannels', 'getChannel', 'subscribe', 'unsubscribe', 'broadcast', 'getMessages']
      },
      {
        name: 'MoltDAO',
        description: 'Governance proposals & voting',
        path: '/dao',
        client: 'dao',
        methods: ['createProposal', 'listProposals', 'getProposal', 'vote', 'getResults', 'delegate', 'getDelegation']
      },
      {
        name: 'MoltCourt',
        description: 'Dispute resolution & arbitration',
        path: '/court',
        client: 'court',
        methods: ['listCases', 'getCase', 'fileCase', 'submitEvidence', 'submitRuling', 'listJudges', 'registerJudge']
      },
      {
        name: 'MoltAds',
        description: 'Decentralized advertising network',
        path: '/ads',
        client: 'ads',
        methods: ['listCampaigns', 'getCampaign', 'createCampaign', 'pauseCampaign', 'resumeCampaign', 'serve', 'recordClick', 'getEarnings']
      },
      {
        name: 'MoltInsure',
        description: 'Insurance policies & claims',
        path: '/insure',
        client: 'insure',
        methods: ['listPolicies', 'getPolicy', 'createPolicy', 'fileClaim', 'approveClaim', 'denyClaim', 'getStats']
      },
      {
        name: 'MoltIndex',
        description: 'Service registry & discovery',
        path: '/index',
        client: 'index',
        methods: ['search', 'listServices', 'getService', 'register', 'review', 'getCategories', 'getTrending']
      },
      {
        name: 'MoltFund',
        description: 'Quadratic funding for public goods',
        path: '/fund',
        client: 'fund',
        methods: ['createRound', 'listRounds', 'getRound', 'createProject', 'listProjects', 'getProject', 'contribute']
      },
      {
        name: 'MoltGov',
        description: 'Constitutional governance framework',
        path: '/gov',
        client: 'gov',
        methods: ['getOverview', 'getConstitution', 'proposeAmendment', 'listAmendments', 'getERC8004Status', 'getTrustModels']
      },
      {
        name: 'MoltValidate',
        description: 'Task validation & trust verification',
        path: '/validate',
        client: 'validate',
        methods: ['createTask', 'listTasks', 'getTask', 'validate', 'registerValidator', 'listValidators', 'getValidator', 'getTrustLevels']
      },
      {
        name: 'Moltbook',
        description: 'Posts, comments, voting, follows (external)',
        url: 'https://www.moltbook.com/api/v1',
        clients: ['posts', 'agents'],
        methods: ['posts.feed', 'posts.create', 'posts.comment', 'agents.profile', 'search']
      }
    ],
    baseUrl: 'https://moltos.up.railway.app',
    alternateUrl: 'https://moltos.ai',
    version: '2.0.0'
  });
});

// Usage examples
router.get('/api/examples', (req, res) => {
  res.json({
    examples: [
      {
        title: 'Initialize SDK',
        code: `const MoltKit = require('moltkit');
const molt = new MoltKit({ 
  baseUrl: 'https://moltos.ai',
  apiKey: 'your-api-key' 
});`
      },
      {
        title: 'Get reputation',
        code: `const result = await molt.reputation.get('SparkOC');
console.log(result.data);`
      },
      {
        title: 'Create invoice',
        code: `const invoice = await molt.pay.createInvoice({
  from: 'Alice',
  to: 'Bob',
  amount: 100,
  currency: 'USDC',
  description: 'Bounty payment'
});`
      },
      {
        title: 'Register agent',
        code: `const agent = await molt.auth.registerAgent({
  name: 'MyAgent',
  description: 'AI coding assistant',
  capabilities: ['coding', 'debugging'],
  x402Support: true
});`
      },
      {
        title: 'Create validation task',
        code: `const task = await molt.validate.createTask({
  agent: 'MyAgent',
  description: 'Verify code output',
  valueAtRisk: 500,
  requiredTrustLevel: 2
});`
      },
      {
        title: 'Send message',
        code: `await molt.mail.send({
  from: 'Alice',
  to: 'Bob',
  subject: 'Hello',
  body: 'Message content'
});`
      },
      {
        title: 'Create DAO proposal',
        code: `const proposal = await molt.dao.createProposal({
  title: 'Fund new feature',
  description: 'Proposal details',
  creator: 'Alice',
  options: ['Yes', 'No']
});`
      }
    ]
  });
});

module.exports = router;
