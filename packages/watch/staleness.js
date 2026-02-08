#!/usr/bin/env node
/**
 * MoltWatch Staleness Tracking
 * Tracks per-agent freshness and provides staleness indicators
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data/watch');
const STALENESS_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Load agent freshness data
 * Returns map of agentName -> { last_updated, last_scraped }
 */
function loadAgentFreshness() {
  const freshnessPath = path.join(DATA_DIR, 'agent-freshness.json');
  if (!fs.existsSync(freshnessPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(freshnessPath, 'utf-8'));
}

/**
 * Save agent freshness data
 */
function saveAgentFreshness(freshness) {
  const freshnessPath = path.join(DATA_DIR, 'agent-freshness.json');
  fs.writeFileSync(freshnessPath, JSON.stringify(freshness, null, 2));
}

/**
 * Update freshness for a batch of agents
 */
function updateAgentFreshness(agentNames, timestamp = new Date().toISOString()) {
  const freshness = loadAgentFreshness();
  
  for (const name of agentNames) {
    const normalizedName = name.toLowerCase();
    freshness[normalizedName] = {
      name: normalizedName,
      last_updated: timestamp,
      last_scraped: timestamp
    };
  }
  
  saveAgentFreshness(freshness);
}

/**
 * Get staleness report
 * Returns list of agents with their staleness status
 */
function getStalenessReport() {
  const freshness = loadAgentFreshness();
  const now = Date.now();
  
  const agents = Object.entries(freshness).map(([name, data]) => {
    const lastUpdate = new Date(data.last_updated);
    const staleMs = now - lastUpdate.getTime();
    const staleDays = Math.floor(staleMs / (24 * 60 * 60 * 1000));
    const staleHours = Math.floor(staleMs / (60 * 60 * 1000));
    
    return {
      name,
      last_updated: data.last_updated,
      stale_ms: staleMs,
      stale_hours: staleHours,
      stale_days: staleDays,
      is_stale: staleMs > STALENESS_THRESHOLD_MS,
      staleness_level: staleMs > 7 * STALENESS_THRESHOLD_MS ? 'critical' :
                      staleMs > 3 * STALENESS_THRESHOLD_MS ? 'high' :
                      staleMs > STALENESS_THRESHOLD_MS ? 'medium' : 'fresh'
    };
  });
  
  // Sort by staleness (most stale first)
  agents.sort((a, b) => b.stale_ms - a.stale_ms);
  
  const staleCount = agents.filter(a => a.is_stale).length;
  const totalCount = agents.length;
  const stalePercentage = totalCount > 0 ? (staleCount / totalCount * 100).toFixed(1) : 0;
  
  return {
    timestamp: new Date().toISOString(),
    threshold_hours: STALENESS_THRESHOLD_MS / (60 * 60 * 1000),
    total_agents: totalCount,
    stale_agents: staleCount,
    stale_percentage: stalePercentage,
    staleness_levels: {
      fresh: agents.filter(a => a.staleness_level === 'fresh').length,
      medium: agents.filter(a => a.staleness_level === 'medium').length,
      high: agents.filter(a => a.staleness_level === 'high').length,
      critical: agents.filter(a => a.staleness_level === 'critical').length
    },
    agents
  };
}

/**
 * Get freshness info for a specific agent
 */
function getAgentFreshness(agentName) {
  const freshness = loadAgentFreshness();
  const normalizedName = agentName.toLowerCase();
  
  if (!freshness[normalizedName]) {
    return {
      name: agentName,
      exists: false,
      error: 'Agent not found in freshness tracking'
    };
  }
  
  const data = freshness[normalizedName];
  const now = Date.now();
  const lastUpdate = new Date(data.last_updated);
  const staleMs = now - lastUpdate.getTime();
  const staleHours = Math.floor(staleMs / (60 * 60 * 1000));
  
  return {
    name: agentName,
    exists: true,
    last_updated: data.last_updated,
    stale_ms: staleMs,
    stale_hours: staleHours,
    is_stale: staleMs > STALENESS_THRESHOLD_MS,
    staleness_level: staleMs > 7 * STALENESS_THRESHOLD_MS ? 'critical' :
                    staleMs > 3 * STALENESS_THRESHOLD_MS ? 'high' :
                    staleMs > STALENESS_THRESHOLD_MS ? 'medium' : 'fresh'
  };
}

/**
 * Initialize freshness tracking for all agents in current snapshot
 */
function initializeFreshnessFromSnapshot() {
  const latestPath = path.join(DATA_DIR, 'latest.json');
  if (!fs.existsSync(latestPath)) {
    throw new Error('No snapshot found');
  }
  
  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
  const snapshotPath = path.join(DATA_DIR, latest.file);
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
  
  const agentNames = new Set();
  
  // Collect agents from posts
  for (const post of snapshot.posts || []) {
    if (post.author) {
      const authorName = typeof post.author === 'object' ? post.author.name : post.author;
      if (authorName) agentNames.add(authorName.toLowerCase());
    }
    
    // From comments
    if (post.comments) {
      for (const comment of post.comments) {
        if (comment.author) {
          const authorName = typeof comment.author === 'object' ? comment.author.name : comment.author;
          if (authorName) agentNames.add(authorName.toLowerCase());
        }
      }
    }
  }
  
  console.log(`Initializing freshness for ${agentNames.size} agents from snapshot ${latest.file}`);
  updateAgentFreshness(Array.from(agentNames), snapshot.timestamp);
  
  return { 
    initialized: agentNames.size,
    timestamp: snapshot.timestamp 
  };
}

// CLI
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'init':
      const result = initializeFreshnessFromSnapshot();
      console.log('Freshness tracking initialized:', result);
      break;
      
    case 'report':
      const report = getStalenessReport();
      console.log(JSON.stringify(report, null, 2));
      break;
      
    case 'agent':
      const agentName = process.argv[3];
      if (!agentName) {
        console.error('Usage: node staleness.js agent <name>');
        process.exit(1);
      }
      const agentInfo = getAgentFreshness(agentName);
      console.log(JSON.stringify(agentInfo, null, 2));
      break;
      
    default:
      console.log(`
MoltWatch Staleness Tracking

Commands:
  init           Initialize freshness from current snapshot
  report         Generate full staleness report
  agent <name>   Get freshness info for specific agent
      `);
  }
}

module.exports = {
  loadAgentFreshness,
  saveAgentFreshness,
  updateAgentFreshness,
  getStalenessReport,
  getAgentFreshness,
  initializeFreshnessFromSnapshot
};
