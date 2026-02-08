const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const skillTaxonomy = require('../shared/skillTaxonomy');

const router = express.Router();
const MOLTBOOK_API = 'https://moltbook.com';
const MOLTBOOK_TOKEN = process.env.MOLTBOOK_API_KEY || 'moltbook_sk_FrfNTK2tHCYxm004W3aWm12G5tecUWyV';
const DATA_FILE = path.join(__dirname, '../../data/match/agents.json');

// Serve static files (dashboard)
router.use(express.static(path.join(__dirname, 'public')));

// Skill keywords to detect in posts
const SKILL_KEYWORDS = [
  'crypto', 'bitcoin', 'ethereum', 'defi', 'nft', 'web3', 'blockchain',
  'monitoring', 'alerting', 'uptime', 'observability',
  'analytics', 'data', 'metrics', 'dashboard', 'visualization',
  'scraping', 'crawling', 'parsing', 'extraction',
  'nlp', 'language', 'sentiment', 'text analysis', 'embeddings',
  'ui', 'frontend', 'design', 'css', 'react',
  'api', 'backend', 'server', 'express', 'rest',
  'automation', 'workflow', 'scheduling', 'cron',
  'security', 'auth', 'encryption', 'vulnerability',
  'ai', 'machine learning', 'llm', 'gpt', 'model', 'inference',
  'devops', 'deploy', 'docker', 'ci/cd', 'railway',
  'trading', 'market', 'price', 'swap', 'liquidity',
  'social', 'twitter', 'discord', 'telegram', 'community',
  'storage', 'database', 'redis', 'postgres', 'sqlite',
  'search', 'index', 'discovery', 'recommendation',
  'media', 'image', 'video', 'audio', 'tts',
  'weather', 'calendar', 'email', 'notifications',
  'gaming', 'simulation', 'agent', 'multi-agent', 'collaboration'
];

function loadAgents() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return {}; }
}

function saveAgents(agents) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(agents, null, 2));
}

function extractSkills(text) {
  // Use taxonomy-based skill suggestion
  return skillTaxonomy.suggestSkills(text);
}

async function moltbookFetch(endpoint) {
  const res = await fetch(`${MOLTBOOK_API}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${MOLTBOOK_TOKEN}` }
  });
  if (!res.ok) throw new Error(`Moltbook API ${res.status}: ${await res.text()}`);
  return res.json();
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

router.get('/health', (req, res) => res.json({ status: 'ok', service: 'moltmatch', uptime: process.uptime() }));

router.get('/api/agents', (req, res) => {
  const agents = loadAgents();
  const list = Object.values(agents).map(a => ({
    name: a.name, skills: a.skills, karma: a.karma, postCount: a.postCount
  }));
  if (req.query.skill) {
    const skills = Array.isArray(req.query.skill) ? req.query.skill : [req.query.skill];
    const filtered = list.filter(a => skills.some(s => a.skills.includes(s)));
    return res.json(filtered);
  }
  res.json(list);
});

router.get('/api/agents/:name', (req, res) => {
  const agents = loadAgents();
  const agent = agents[req.params.name];
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

router.get('/api/match', (req, res) => {
  const agents = loadAgents();
  const skills = Array.isArray(req.query.skill) ? req.query.skill : req.query.skill ? [req.query.skill] : [];
  if (!skills.length) return res.status(400).json({ error: 'Provide ?skill=X' });
  
  const results = Object.values(agents)
    .map(a => ({ ...a, matchScore: skills.filter(s => a.skills.includes(s)).length }))
    .filter(a => a.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore);
  res.json(results);
});

router.get('/api/collabs', (req, res) => {
  const agents = loadAgents();
  const list = Object.values(agents).filter(a => a.skills.length > 0);
  const pairs = [];

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const shared = a.skills.filter(s => b.skills.includes(s));
      const uniqueA = a.skills.filter(s => !b.skills.includes(s));
      const uniqueB = b.skills.filter(s => !a.skills.includes(s));
      if (shared.length > 0 && (uniqueA.length > 0 || uniqueB.length > 0)) {
        pairs.push({
          agents: [a.name, b.name],
          sharedSkills: shared,
          complementary: { [a.name]: uniqueA, [b.name]: uniqueB },
          score: shared.length + (uniqueA.length + uniqueB.length) * 0.5
        });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  res.json(pairs.slice(0, 20));
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

router.post('/api/agents/:id/skills', (req, res) => {
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

router.get('/api/search', (req, res) => {
  const agents = loadAgents();
  const { category, skill, q } = req.query;
  
  let results = Object.values(agents);
  
  // Filter by category
  if (category) {
    const categorySkills = skillTaxonomy.getSkillsByCategory(category);
    results = results.filter(a => 
      a.skills.some(s => categorySkills.includes(s.toLowerCase()))
    );
  }
  
  // Filter by specific skill
  if (skill) {
    const skills = Array.isArray(skill) ? skill : [skill];
    results = results.filter(a => 
      skills.some(s => a.skills.includes(s.toLowerCase()))
    );
  }
  
  // Text search
  if (q) {
    const query = q.toLowerCase();
    results = results.filter(a => 
      a.name.toLowerCase().includes(query) ||
      a.bio.toLowerCase().includes(query) ||
      a.skills.some(s => s.toLowerCase().includes(query))
    );
  }
  
  // Calculate match scores if filtering
  if (category || skill) {
    const targetSkills = skill 
      ? (Array.isArray(skill) ? skill : [skill])
      : skillTaxonomy.getSkillsByCategory(category);
    
    results = results.map(a => ({
      ...a,
      matchScore: targetSkills.filter(s => a.skills.includes(s.toLowerCase())).length
    })).sort((a, b) => b.matchScore - a.matchScore);
  }
  
  res.json(results);
});

router.get('/api/compatibility', (req, res) => {
  const { agent1, agent2 } = req.query;
  
  if (!agent1 || !agent2) {
    return res.status(400).json({ error: 'Provide agent1 and agent2 parameters' });
  }
  
  const agents = loadAgents();
  const a1 = agents[agent1];
  const a2 = agents[agent2];
  
  if (!a1 || !a2) {
    return res.status(404).json({ error: 'One or both agents not found' });
  }
  
  const compatibility = skillTaxonomy.calculateCompatibility(a1.skills, a2.skills);
  
  res.json({
    agents: [agent1, agent2],
    compatibility
  });
});

module.exports = router;
