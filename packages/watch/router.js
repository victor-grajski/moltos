const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Import analytics modules
const { 
  loadOrBuildGraph, 
  findRelatedAgents, 
  getMostConnectedAgents, 
  getTrendingTopics, 
  getGraphStats 
} = require('./graph.js');

const { 
  findRisingSpots, 
  getSnapshotFiles, 
  loadSnapshot 
} = require('./rising.js');

const { 
  getFollowRecommendations 
} = require('./recommendations.js');

const { 
  getSubmoltClusters 
} = require('./clusters.js');

const {
  computeReputationScores,
  getAgentReputation,
  TIERS,
} = require('./reputation.js');

const { 
  loadSnapshotsFromPastWeek,
  analyzeWeeklyData,
  formatWeeklyRollup 
} = require('./rollup.js');

const DATA_DIR = path.join(__dirname, '../../data/watch');

// Expose DATA_DIR for modules
global.MOLTWATCH_DATA_DIR = DATA_DIR;

// ============ API ENDPOINTS ============

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'moltwatch',
    timestamp: new Date().toISOString() 
  });
});

// Knowledge graph summary
router.get('/api/graph', (req, res) => {
  try {
    const graph = loadOrBuildGraph();
    const stats = getGraphStats();
    
    const topAgents = graph.nodes.agents
      .sort((a, b) => b.postCount - a.postCount)
      .slice(0, 10)
      .map(a => ({
        name: a.name,
        postCount: a.postCount,
        submoltCount: a.submolts.length
      }));
    
    const topSubmolts = graph.nodes.submolts
      .sort((a, b) => b.agents.length - a.agents.length)
      .slice(0, 10)
      .map(s => ({
        name: s.name,
        display_name: s.display_name,
        subscribers: s.subscribers,
        agentCount: s.agents.length
      }));
      
    const topTopics = getTrendingTopics(10);
    
    res.json({
      stats,
      topAgents,
      topSubmolts,
      topTopics
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Agent detail
router.get('/api/graph/agent/:name', (req, res) => {
  try {
    const agentName = req.params.name;
    const graph = loadOrBuildGraph();
    
    const agent = graph.nodes.agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
    if (!agent) {
      return res.status(404).json({ error: `Agent '${agentName}' not found` });
    }
    
    const related = findRelatedAgents(agentName);
    
    res.json({
      name: agent.name,
      postCount: agent.postCount,
      submolts: agent.submolts,
      submoltCount: agent.submolts.length,
      related: related.topRelated || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rising spots
router.get('/api/rising', (req, res) => {
  try {
    const snapshotFiles = getSnapshotFiles();
    
    if (snapshotFiles.length < 2) {
      return res.json({
        message: 'Need at least 2 snapshots to detect rising spots',
        risingSpots: []
      });
    }
    
    const newerSnapshot = loadSnapshot(snapshotFiles[0]);
    const olderSnapshot = loadSnapshot(snapshotFiles[1]);
    
    if (!newerSnapshot || !olderSnapshot) {
      return res.status(500).json({ error: 'Failed to load snapshots' });
    }
    
    const risingSpots = findRisingSpots(newerSnapshot, olderSnapshot);
    
    res.json({
      newerSnapshot: path.basename(snapshotFiles[0]),
      olderSnapshot: path.basename(snapshotFiles[1]),
      risingSpots
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Who to follow recommendations
router.get('/api/recommendations', (req, res) => {
  try {
    const { agent } = req.query;
    
    if (!agent) {
      return res.status(400).json({ error: 'Agent parameter required' });
    }
    
    const recommendations = getFollowRecommendations(agent, 20);
    res.json(recommendations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submolt clusters
router.get('/api/clusters', (req, res) => {
  try {
    const clusters = getSubmoltClusters();
    res.json(clusters);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Activity heatmap
router.get('/api/heatmap', (req, res) => {
  try {
    const graph = loadOrBuildGraph();

    // Try to load heatmap data from latest snapshot
    let hourlyActivity;
    try {
      const latestMeta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'latest.json'), 'utf8'));
      const snapshot = JSON.parse(fs.readFileSync(path.join(DATA_DIR, latestMeta.file), 'utf8'));
      if (snapshot.heatmapData && snapshot.heatmapData.length === 24) {
        hourlyActivity = snapshot.heatmapData;
      }
    } catch (_) { /* fall through */ }

    // Fallback: compute from snapshot posts/comments if heatmapData not present
    if (!hourlyActivity) {
      try {
        const latestMeta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'latest.json'), 'utf8'));
        const snapshot = JSON.parse(fs.readFileSync(path.join(DATA_DIR, latestMeta.file), 'utf8'));
        const counts = new Array(24).fill(0);
        if (snapshot.posts) {
          for (const p of snapshot.posts) {
            if (p.created) counts[new Date(p.created).getUTCHours()]++;
            if (p.comments) {
              for (const c of p.comments) {
                if (c.created) counts[new Date(c.created).getUTCHours()]++;
              }
            }
          }
        }
        hourlyActivity = counts.map((activity, hour) => ({ hour, activity }));
      } catch (_) {
        hourlyActivity = Array.from({ length: 24 }, (_, hour) => ({ hour, activity: 0 }));
      }
    }

    const submoltActivity = graph.nodes.submolts
      .map(s => ({
        name: s.name,
        display_name: s.display_name,
        agentCount: s.agents.length,
        subscribers: s.subscribers
      }))
      .sort((a, b) => b.agentCount - a.agentCount)
      .slice(0, 20);

    res.json({
      hourlyActivity,
      submoltActivity
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Weekly rollup
router.get('/api/rollup', (req, res) => {
  try {
    const snapshots = loadSnapshotsFromPastWeek();
    const analysis = analyzeWeeklyData(snapshots);
    const rollup = formatWeeklyRollup(analysis);
    res.json({
      snapshots: snapshots.length,
      rollup: rollup
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Overall ecosystem stats
router.get('/api/stats', (req, res) => {
  try {
    const stats = getGraphStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reputation scores
router.get('/api/reputation', (req, res) => {
  try {
    const scores = computeReputationScores();
    const { sort, tier, limit: rawLimit } = req.query;
    let results = scores;

    // Filter by tier
    if (tier) {
      results = results.filter(a => a.tier === tier.toLowerCase());
    }

    // Sort options
    if (sort === 'posts') results.sort((a, b) => b.postCount - a.postCount);
    else if (sort === 'name') results.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'comments') results.sort((a, b) => b.commentsMade - a.commentsMade);
    // default: by score (already sorted)

    const limit = Math.min(parseInt(rawLimit) || 100, 500);
    results = results.slice(0, limit);

    res.json({
      total: scores.length,
      tiers: TIERS,
      agents: results,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Single agent reputation breakdown
router.get('/api/reputation/:agentName', (req, res) => {
  try {
    const rep = getAgentReputation(req.params.agentName);
    if (!rep) {
      return res.status(404).json({ error: `Agent '${req.params.agentName}' not found` });
    }
    res.json(rep);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Scrape status endpoint
let lastScrapeTime = null;
let scrapeInProgress = false;

router.get('/api/scrape/status', (req, res) => {
  const snapshotCount = fs.existsSync(DATA_DIR) 
    ? fs.readdirSync(DATA_DIR).filter(f => f.startsWith('snapshot-')).length 
    : 0;
  
  res.json({
    lastScrape: lastScrapeTime?.toISOString() || null,
    scrapeInProgress,
    snapshotCount
  });
});

module.exports = router;
