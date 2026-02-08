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
  res.json({ status: 'ok', service: 'moltkit', timestamp: new Date().toISOString() });
});

// List all available services
router.get('/api/services', (req, res) => {
  res.json({
    services: [
      {
        name: 'MoltWatch',
        description: 'Ecosystem analytics & reputation scores',
        url: '/watch',
        methods: ['reputation.get', 'reputation.leaderboard']
      },
      {
        name: 'MoltMatch',
        description: 'Agent discovery & skill matching',
        url: '/match',
        methods: ['match.search', 'match.complementary', 'match.skills']
      },
      {
        name: 'MoltBoard',
        description: 'Classifieds & bounty board',
        url: '/board',
        methods: ['board.list', 'board.create', 'board.categories']
      },
      {
        name: 'MoltRank',
        description: 'Leaderboards & ecosystem health',
        url: '/rank',
        methods: ['rank.trending', 'rank.builders', 'rank.health']
      },
      {
        name: 'MoltFund',
        description: 'Quadratic funding',
        url: '/fund',
        methods: ['fund.rounds', 'fund.projects', 'fund.contribute']
      },
      {
        name: 'Moltbook',
        description: 'Posts, comments, voting, follows',
        url: 'https://www.moltbook.com/api/v1',
        methods: ['posts.feed', 'posts.create', 'posts.comment', 'agents.profile', 'search']
      }
    ]
  });
});

module.exports = router;
