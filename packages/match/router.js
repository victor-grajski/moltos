const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const skillTaxonomy = require('../shared/skillTaxonomy');

const router = express.Router();
const MOLTBOOK_API = 'https://moltbook.com';
const MOLTBOOK_TOKEN = process.env.MOLTBOOK_API_KEY || 'moltbook_sk_FrfNTK2tHCYxm004W3aWm12G5tecUWyV';
const DATA_FILE = path.join(__dirname, '../../data/match/agents.json');
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3000';

// Serve static files (dashboard)
router.use(express.static(path.join(__dirname, 'public')));

function loadAgents() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return {}; }
}

function saveAgents(agents) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(agents, null, 2));
}

function extractSkills(text) {
  return skillTaxonomy.suggestSkills(text);
}

async function moltbookFetch(endpoint) {
  const res = await fetch(`${MOLTBOOK_API}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${MOLTBOOK_TOKEN}` }
  });
  if (!res.ok) throw new Error(`Moltbook API ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Fetch agents from /auth service and merge with local indexed data
 */
async function getAgentsRegistry() {
  const localAgents = loadAgents();
  
  try {
    // Fetch from auth service
    const res = await fetch(`${AUTH_SERVICE_URL}/auth/api/agents`, {
      timeout: 5000
    });
    
    if (res.ok) {
      const authAgents = await res.json();
      
      // Merge auth agents with local indexed data
      const merged = {};
      
      // Start with local agents (which have skill/bio data)
      Object.assign(merged, localAgents);
      
      // Add/update with auth registry data
      authAgents.forEach(agent => {
        const name = agent.name;
        if (merged[name]) {
          // Merge capabilities from auth into existing
          merged[name] = {
            ...merged[name],
            authId: agent.id,
            capabilities: agent.capabilities || [],
            services: agent.services || [],
            active: agent.active !== false,
            lastActive: agent.lastActive
          };
        } else {
          // New agent from auth, create entry
          merged[name] = {
            name: agent.name,
            authId: agent.id,
            bio: agent.description || '',
            capabilities: agent.capabilities || [],
            services: agent.services || [],
            skills: extractSkills(agent.description || ''),
            active: agent.active !== false,
            lastActive: agent.lastActive,
            karma: 0,
            followers: 0,
            postCount: 0,
            recentTopics: []
          };
        }
      });
      
      return merged;
    }
  } catch (e) {
    console.error('Failed to fetch from auth service:', e.message);
  }
  
  // Fallback to local data
  return localAgents;
}

/**
 * Calculate match score for an agent based on search criteria
 */
function calculateMatchScore(agent, options = {}) {
  const { query, skills, category } = options;
  let score = 0;
  const reasons = [];
  
  // Text query matching
  if (query) {
    const q = query.toLowerCase();
    const agentSkills = agent.skills || [];
    
    // Name match (high priority)
    if (agent.name.toLowerCase().includes(q)) {
      score += 10;
      reasons.push('name match');
    }
    
    // Bio match
    if (agent.bio && agent.bio.toLowerCase().includes(q)) {
      score += 5;
      reasons.push('bio match');
    }
    
    // Skill match
    const skillMatches = agentSkills.filter(s => s.toLowerCase().includes(q));
    if (skillMatches.length > 0) {
      score += skillMatches.length * 3;
      reasons.push(`${skillMatches.length} skill match(es)`);
    }
    
    // Capability match
    if (agent.capabilities && agent.capabilities.some(c => c.toLowerCase().includes(q))) {
      score += 4;
      reasons.push('capability match');
    }
  }
  
  // Specific skill filtering
  if (skills && skills.length > 0) {
    const agentSkills = (agent.skills || []).map(s => s.toLowerCase());
    
    skills.forEach(skill => {
      const skillLower = skill.toLowerCase();
      
      // Exact match
      if (agentSkills.includes(skillLower)) {
        score += 8;
        reasons.push(`exact: ${skill}`);
      }
      // Partial match
      else if (agentSkills.some(s => s.includes(skillLower) || skillLower.includes(s))) {
        score += 4;
        reasons.push(`partial: ${skill}`);
      }
    });
    
    // Bonus for complementary skills in same category
    skills.forEach(skill => {
      const skillCategory = skillTaxonomy.getCategoryForTag(skill.toLowerCase());
      if (skillCategory) {
        const categorySkills = skillTaxonomy.getSkillsByCategory(skillCategory);
        const complementary = agentSkills.filter(s => 
          categorySkills.includes(s) && !skills.map(sk => sk.toLowerCase()).includes(s)
        );
        if (complementary.length > 0) {
          score += complementary.length * 1.5;
          reasons.push(`${complementary.length} complementary in ${skillCategory}`);
        }
      }
    });
  }
  
  // Category matching
  if (category) {
    const categorySkills = skillTaxonomy.getSkillsByCategory(category);
    const agentSkills = (agent.skills || []).map(s => s.toLowerCase());
    
    const matches = agentSkills.filter(s => categorySkills.includes(s));
    if (matches.length > 0) {
      score += matches.length * 6;
      reasons.push(`${matches.length} ${category} skill(s)`);
    }
  }
  
  // Quality signals (small boost)
  if (agent.karma) score += Math.min(agent.karma / 10, 5);
  if (agent.postCount) score += Math.min(agent.postCount / 5, 3);
  
  return {
    score: parseFloat(score.toFixed(2)),
    reasons: reasons.slice(0, 5) // Top 5 reasons
  };
}

async function scrapeAndIndex() {
  const agents = loadAgents();
  
  let posts = [];
  try {
    const data = await moltbookFetch('/api/v1/posts?sort=new&limit=50');
    posts = data.posts || [];
  } catch (e) {
    console.error('Failed to fetch posts:', e.message);
  }

  const agentNames = new Set();
  for (const post of posts) {
    const name = typeof post.author === 'object' ? post.author?.name : post.author;
    if (name) agentNames.add(name);
  }

  for (const name of agentNames) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const profile = await moltbookFetch(`/api/v1/agents/profile?name=${encodeURIComponent(name)}`);
      
      const agentPosts = posts.filter(p => (typeof p.author === 'object' ? p.author?.name : p.author) === name);
      const allText = agentPosts.map(p => `${p.title || ''} ${p.content || ''} ${p.body || ''}`).join(' ');
      const bioText = profile.bio || profile.description || '';
      
      const skills = [...new Set([
        ...extractSkills(allText),
        ...extractSkills(bioText)
      ])];

      agents[name] = {
        ...agents[name], // Preserve auth data if exists
        name: profile.name || name,
        bio: bioText,
        avatar: profile.avatar || profile.avatarUrl || null,
        karma: profile.karma || 0,
        followers: profile.followers || 0,
        skills,
        postCount: agentPosts.length,
        recentTopics: agentPosts.slice(0, 5).map(p => p.title || p.content?.slice(0, 80) || '').filter(Boolean),
        lastIndexed: new Date().toISOString()
      };
    } catch (e) {
      console.error(`Failed to index ${name}:`, e.message);
      if (!agents[name]) {
        const agentPosts = posts.filter(p => (typeof p.author === 'object' ? p.author?.name : p.author) === name);
        const allText = agentPosts.map(p => `${p.title || ''} ${p.content || ''} ${p.body || ''}`).join(' ');
        agents[name] = {
          name,
          bio: '',
          skills: extractSkills(allText),
          postCount: agentPosts.length,
          recentTopics: agentPosts.slice(0, 5).map(p => p.title || p.content?.slice(0, 80) || '').filter(Boolean),
          lastIndexed: new Date().toISOString()
        };
      }
    }
  }

  saveAgents(agents);
  return { indexed: Object.keys(agents).length, fromPosts: posts.length };
}

// --- API Routes ---

router.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  service: 'moltmatch', 
  uptime: process.uptime(),
  authServiceUrl: AUTH_SERVICE_URL
}));

router.get('/api/agents', async (req, res) => {
  try {
    const agents = await getAgentsRegistry();
    const list = Object.values(agents).map(a => ({
      name: a.name, 
      skills: a.skills || [], 
      karma: a.karma || 0, 
      postCount: a.postCount || 0,
      active: a.active
    }));
    
    if (req.query.skill) {
      const skills = Array.isArray(req.query.skill) ? req.query.skill : [req.query.skill];
      const filtered = list.filter(a => skills.some(s => (a.skills || []).includes(s)));
      return res.json(filtered);
    }
    
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/agents/:name', async (req, res) => {
  try {
    const agents = await getAgentsRegistry();
    const agent = agents[req.params.name];
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * MAIN SEARCH ENDPOINT
 * GET /api/search?q=<query>&skills=<skill1>&skills=<skill2>&category=<cat>&limit=<n>
 */
router.get('/api/search', async (req, res) => {
  try {
    const agents = await getAgentsRegistry();
    const { q, category, limit } = req.query;
    
    // Parse skills array (handles both ?skills=x&skills=y and ?skills[]=x&skills[]=y)
    let skills = req.query.skills || req.query.skill;
    if (skills && !Array.isArray(skills)) {
      skills = [skills];
    }
    
    let results = Object.values(agents);
    
    // Filter by active status (only active by default)
    if (req.query.includeInactive !== 'true') {
      results = results.filter(a => a.active !== false);
    }
    
    // Calculate match scores for all agents
    results = results.map(agent => {
      const matchResult = calculateMatchScore(agent, { query: q, skills, category });
      return {
        ...agent,
        matchScore: matchResult.score,
        matchReasons: matchResult.reasons
      };
    });
    
    // Filter out zero-score results if there's a search query
    if (q || skills || category) {
      results = results.filter(a => a.matchScore > 0);
    }
    
    // Sort by match score (descending)
    results.sort((a, b) => b.matchScore - a.matchScore);
    
    // Apply limit
    if (limit) {
      const limitNum = parseInt(limit, 10);
      if (!isNaN(limitNum) && limitNum > 0) {
        results = results.slice(0, limitNum);
      }
    }
    
    res.json({
      query: q || null,
      skills: skills || null,
      category: category || null,
      count: results.length,
      results: results
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/match', async (req, res) => {
  try {
    const agents = await getAgentsRegistry();
    const skills = Array.isArray(req.query.skill) ? req.query.skill : req.query.skill ? [req.query.skill] : [];
    if (!skills.length) return res.status(400).json({ error: 'Provide ?skill=X' });
    
    const results = Object.values(agents)
      .map(a => {
        const matchResult = calculateMatchScore(a, { skills });
        return { 
          ...a, 
          matchScore: matchResult.score,
          matchReasons: matchResult.reasons
        };
      })
      .filter(a => a.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore);
      
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/collabs', async (req, res) => {
  try {
    const agents = await getAgentsRegistry();
    const list = Object.values(agents).filter(a => (a.skills || []).length > 0);
    const pairs = [];

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const compatibility = skillTaxonomy.calculateCompatibility(a.skills || [], b.skills || []);
        
        if (compatibility.score > 0) {
          pairs.push({
            agents: [a.name, b.name],
            sharedSkills: compatibility.shared,
            complementary: { 
              [a.name]: compatibility.complementary.agentA, 
              [b.name]: compatibility.complementary.agentB 
            },
            score: compatibility.score,
            explanation: compatibility.explanation
          });
        }
      }
    }
    
    pairs.sort((a, b) => b.score - a.score);
    res.json(pairs.slice(0, 20));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/scrape', async (req, res) => {
  try {
    const result = await scrapeAndIndex();
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Skill Taxonomy Endpoints ---

router.get('/api/skills/taxonomy', (req, res) => {
  const taxonomy = skillTaxonomy.getTaxonomy();
  res.json({
    categories: Object.keys(taxonomy).map(key => ({
      id: key,
      name: taxonomy[key].name,
      tags: taxonomy[key].tags
    })),
    allTags: skillTaxonomy.getAllTags()
  });
});

router.post('/api/agents/:id/skills', async (req, res) => {
  const agentId = req.params.id;
  const { skills } = req.body;
  
  if (!Array.isArray(skills)) {
    return res.status(400).json({ error: 'skills must be an array' });
  }
  
  const agents = loadAgents();
  const agent = agents[agentId];
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Normalize and validate skills
  const normalized = skillTaxonomy.normalizeSkills(skills);
  agent.skills = [...normalized.predefined, ...normalized.freeform];
  agent.skillCategories = Array.from(
    new Set(normalized.predefined.map(s => skillTaxonomy.getCategoryForTag(s)).filter(Boolean))
  );
  agent.lastUpdated = new Date().toISOString();
  
  saveAgents(agents);
  
  res.json({
    success: true,
    agent: agentId,
    skills: agent.skills,
    categories: agent.skillCategories,
    breakdown: normalized
  });
});

router.get('/api/compatibility', async (req, res) => {
  const { agent1, agent2 } = req.query;
  
  if (!agent1 || !agent2) {
    return res.status(400).json({ error: 'Provide agent1 and agent2 parameters' });
  }
  
  try {
    const agents = await getAgentsRegistry();
    const a1 = agents[agent1];
    const a2 = agents[agent2];
    
    if (!a1 || !a2) {
      return res.status(404).json({ error: 'One or both agents not found' });
    }
    
    const compatibility = skillTaxonomy.calculateCompatibility(a1.skills || [], a2.skills || []);
    
    res.json({
      agents: [agent1, agent2],
      compatibility
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
