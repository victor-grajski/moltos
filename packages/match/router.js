const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();
const PROFILES_FILE = path.join(__dirname, '../../data/match/profiles.json');

// Serve static files (dashboard)
router.use(express.static(path.join(__dirname, 'public')));

// ===== PROFILE STORAGE =====

function loadProfiles() {
  try {
    return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveProfiles(profiles) {
  const dir = path.dirname(PROFILES_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

// ===== PROFILE PARSING =====

/**
 * Extract structured profile data from workspace documents
 */
function parseProfile(docs) {
  const { soul, identity, tools, memory, agents, user, custom } = docs;
  const allText = [soul, identity, tools, memory, agents, user, custom].filter(Boolean).join('\n\n');
  
  // Extract name (look for "I am X" or "My name is X" patterns)
  let name = null;
  const namePatterns = [
    /(?:I am|I'm|My name is|Call me)\s+([A-Z][a-zA-Z0-9_-]+)/i,
    /^#\s*([A-Z][a-zA-Z0-9_-]+)/m
  ];
  
  for (const pattern of namePatterns) {
    const match = allText.match(pattern);
    if (match) {
      name = match[1];
      break;
    }
  }
  
  // Extract bio (first few paragraphs from SOUL.md or IDENTITY.md)
  let bio = '';
  if (soul) {
    const lines = soul.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    bio = lines.slice(0, 3).join(' ').slice(0, 300);
  } else if (identity) {
    const lines = identity.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    bio = lines.slice(0, 3).join(' ').slice(0, 300);
  }
  
  // Extract interests (common nouns/topics from SOUL.md and MEMORY.md)
  const interests = extractKeywords([soul, memory].filter(Boolean).join('\n\n'), {
    type: 'interests',
    patterns: [
      /(?:interested in|passionate about|love|enjoy|fascinated by)\s+([a-z\s,]+)/gi,
      /(?:topics?|interests?|hobbies):\s*([a-z\s,]+)/gi
    ]
  });
  
  // Extract skills (technical capabilities from TOOLS.md, IDENTITY.md)
  const skills = extractKeywords([tools, identity].filter(Boolean).join('\n\n'), {
    type: 'skills',
    patterns: [
      /(?:skills?|capabilities|can|able to|proficient in|experienced with):\s*([a-z\s,]+)/gi,
      /\b(programming|coding|writing|design|analysis|automation|API|database|web|mobile|AI|ML|data)\b/gi
    ]
  });
  
  // Extract current projects (from MEMORY.md or AGENTS.md)
  const currentProjects = extractKeywords([memory, agents].filter(Boolean).join('\n\n'), {
    type: 'projects',
    patterns: [
      /(?:working on|building|developing|project):\s*([A-Z][a-zA-Z0-9\s]+)/g,
      /(?:current|recent) projects?:\s*([a-z\s,]+)/gi
    ]
  });
  
  // Extract lookingFor (collaboration goals)
  const lookingFor = extractKeywords(allText, {
    type: 'lookingFor',
    patterns: [
      /(?:looking for|seeking|want to|hoping to|interested in collaborating on)\s+([a-z\s,]+)/gi,
      /(?:collaboration|partner|teammate).*?(?:for|on|with)\s+([a-z\s,]+)/gi
    ]
  });
  
  // Extract work style
  const workStyle = extractKeywords([soul, agents].filter(Boolean).join('\n\n'), {
    type: 'workStyle',
    patterns: [
      /(?:work style|approach|methodology|prefer to):\s*([a-z\s,]+)/gi,
      /\b(async|asynchronous|proactive|reactive|autonomous|collaborative|structured|flexible|fast|careful)\b/gi
    ]
  });
  
  // Extract platforms (GitHub, Twitter, etc.)
  const platforms = {};
  const platformPatterns = {
    github: /github\.com\/([a-zA-Z0-9_-]+)/i,
    twitter: /(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i,
    moltbook: /moltbook.*?(?:@|username:?\s*)([a-zA-Z0-9_-]+)/i,
    discord: /discord.*?(?:@|username:?\s*)([a-zA-Z0-9_#]+)/i
  };
  
  for (const [platform, pattern] of Object.entries(platformPatterns)) {
    const match = allText.match(pattern);
    if (match) {
      platforms[platform] = match[1];
    }
  }
  
  return {
    name: name || 'Anonymous Agent',
    bio: bio.trim() || 'No bio available',
    interests: [...new Set(interests)].slice(0, 20),
    skills: [...new Set(skills)].slice(0, 30),
    currentProjects: [...new Set(currentProjects)].slice(0, 10),
    lookingFor: [...new Set(lookingFor)].slice(0, 10),
    workStyle: [...new Set(workStyle)].slice(0, 10),
    platforms
  };
}

/**
 * Extract keywords from text using patterns and frequency analysis
 */
function extractKeywords(text, options = {}) {
  if (!text) return [];
  
  const { patterns = [], type } = options;
  const keywords = new Set();
  
  // Pattern-based extraction
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const extracted = match[1] || match[0];
      const items = extracted.split(/[,;]/);
      items.forEach(item => {
        const cleaned = item.trim().toLowerCase().replace(/^(and|or|the|a|an)\s+/i, '');
        if (cleaned.length > 2 && cleaned.length < 50) {
          keywords.add(cleaned);
        }
      });
    }
  }
  
  // Frequency-based extraction (for skills and interests)
  if (type === 'skills' || type === 'interests') {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !isStopWord(w));
    
    const freq = {};
    words.forEach(w => freq[w] = (freq[w] || 0) + 1);
    
    // Add high-frequency words
    Object.entries(freq)
      .filter(([w, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .forEach(([w]) => keywords.add(w));
  }
  
  return Array.from(keywords);
}

function isStopWord(word) {
  const stopWords = new Set([
    'this', 'that', 'these', 'those', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
    'have', 'has', 'had', 'having', 'been', 'being', 'will', 'would', 'could', 'should',
    'from', 'with', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'more', 'most', 'other', 'some', 'such', 'only', 'same', 'than', 'then', 'very', 'just'
  ]);
  return stopWords.has(word);
}

// ===== TEXT MATCHING & RANKING =====

/**
 * Calculate TF-IDF style relevance score between query and profile
 */
function calculateRelevance(profile, query, options = {}) {
  const { skills: filterSkills = [], lookingFor: filterLookingFor } = options;
  
  let score = 0;
  const reasons = [];
  const queryTerms = tokenize(query.toLowerCase());
  
  // Build searchable text from profile
  const profileText = [
    profile.name,
    profile.bio,
    ...profile.interests,
    ...profile.skills,
    ...profile.currentProjects,
    ...profile.lookingFor,
    ...profile.workStyle
  ].join(' ').toLowerCase();
  
  const profileTokens = tokenize(profileText);
  const rawDocs = profile.rawDocs || {};
  const rawText = Object.values(rawDocs).join('\n\n').toLowerCase();
  const rawTokens = tokenize(rawText);
  
  // Calculate term frequency in profile
  const tfProfile = calculateTF(profileTokens);
  const tfRaw = calculateTF(rawTokens);
  
  // Score query terms
  queryTerms.forEach(term => {
    // Name matching (highest weight)
    if (profile.name.toLowerCase().includes(term)) {
      score += 15;
      reasons.push(`name: "${term}"`);
    }
    
    // Structured field matching
    const structuredScore = (
      (profile.interests.filter(i => i.includes(term)).length * 5) +
      (profile.skills.filter(s => s.includes(term)).length * 8) +
      (profile.currentProjects.filter(p => p.toLowerCase().includes(term)).length * 6) +
      (profile.lookingFor.filter(l => l.includes(term)).length * 7)
    );
    
    if (structuredScore > 0) {
      score += structuredScore;
      reasons.push(`structured: "${term}" (${structuredScore})`);
    }
    
    // TF-IDF style scoring for bio and raw docs
    const tfScoreProfile = (tfProfile[term] || 0) * 3;
    const tfScoreRaw = (tfRaw[term] || 0) * 2;
    
    if (tfScoreProfile > 0 || tfScoreRaw > 0) {
      score += tfScoreProfile + tfScoreRaw;
      if (tfScoreProfile + tfScoreRaw >= 2) {
        reasons.push(`text: "${term}" (${(tfScoreProfile + tfScoreRaw).toFixed(1)})`);
      }
    }
  });
  
  // Multi-term phrase bonus
  if (queryTerms.length > 1) {
    const phraseScore = calculatePhraseScore(query.toLowerCase(), profileText, rawText);
    score += phraseScore;
    if (phraseScore > 0) {
      reasons.push(`phrase bonus: ${phraseScore.toFixed(1)}`);
    }
  }
  
  // Skill filter matching
  if (filterSkills.length > 0) {
    filterSkills.forEach(skill => {
      const skillLower = skill.toLowerCase();
      // Exact match
      if (profile.skills.some(s => s === skillLower)) {
        score += 12;
        reasons.push(`exact skill: "${skill}"`);
      }
      // Partial match
      else if (profile.skills.some(s => s.includes(skillLower) || skillLower.includes(s))) {
        score += 6;
        reasons.push(`partial skill: "${skill}"`);
      }
      // Raw doc match
      else if (rawText.includes(skillLower)) {
        score += 3;
        reasons.push(`skill in docs: "${skill}"`);
      }
    });
  }
  
  // LookingFor filter matching
  if (filterLookingFor) {
    const lookingForLower = filterLookingFor.toLowerCase();
    if (profile.lookingFor.some(l => l.includes(lookingForLower))) {
      score += 10;
      reasons.push(`looking for: "${filterLookingFor}"`);
    }
  }
  
  // Interest overlap bonus
  if (queryTerms.length > 0) {
    const interestOverlap = profile.interests.filter(i => 
      queryTerms.some(term => i.includes(term))
    );
    if (interestOverlap.length > 0) {
      score += interestOverlap.length * 2;
      reasons.push(`${interestOverlap.length} interest overlap(s)`);
    }
  }
  
  return {
    score: parseFloat(score.toFixed(2)),
    reasons: reasons.slice(0, 5)
  };
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !isStopWord(t));
}

function calculateTF(tokens) {
  const tf = {};
  tokens.forEach(token => {
    tf[token] = (tf[token] || 0) + 1;
  });
  // Normalize by total tokens
  const total = tokens.length || 1;
  Object.keys(tf).forEach(token => {
    tf[token] = tf[token] / total;
  });
  return tf;
}

function calculatePhraseScore(query, ...texts) {
  let score = 0;
  const combinedText = texts.join(' ');
  
  // Check if entire query appears as phrase
  if (combinedText.includes(query)) {
    score += query.split(/\s+/).length * 2;
  }
  
  // Check for partial phrases (bigrams)
  const words = query.split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (combinedText.includes(bigram)) {
      score += 1.5;
    }
  }
  
  return score;
}

// ===== API ENDPOINTS =====

router.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  service: 'moltmatch-profiles', 
  uptime: process.uptime()
}));

/**
 * POST /match/api/profiles
 * Create a new agent profile
 */
router.post('/api/profiles', (req, res) => {
  try {
    const docs = req.body;
    
    // Validate input
    if (!docs || typeof docs !== 'object') {
      return res.status(400).json({ error: 'Request body must be an object with workspace doc fields' });
    }
    
    // Parse profile from docs
    const structured = parseProfile(docs);
    
    // Generate profile ID
    const id = crypto.randomBytes(8).toString('hex');
    
    // Create full profile
    const profile = {
      id,
      ...structured,
      rawDocs: {
        soul: docs.soul || '',
        identity: docs.identity || '',
        tools: docs.tools || '',
        memory: docs.memory || '',
        agents: docs.agents || '',
        user: docs.user || '',
        custom: docs.custom || ''
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // Save to storage
    const profiles = loadProfiles();
    profiles[id] = profile;
    saveProfiles(profiles);
    
    res.status(201).json(profile);
  } catch (error) {
    console.error('Profile creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /match/api/profiles
 * List all profiles
 */
router.get('/api/profiles', (req, res) => {
  try {
    const profiles = loadProfiles();
    const list = Object.values(profiles).map(p => ({
      id: p.id,
      name: p.name,
      bio: p.bio,
      interests: p.interests,
      skills: p.skills,
      currentProjects: p.currentProjects,
      lookingFor: p.lookingFor,
      workStyle: p.workStyle,
      platforms: p.platforms,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    }));
    
    res.json({
      count: list.length,
      profiles: list
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /match/api/profiles/:id
 * Get a single profile
 */
router.get('/api/profiles/:id', (req, res) => {
  try {
    const profiles = loadProfiles();
    const profile = profiles[req.params.id];
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    // Optionally exclude raw docs from response
    const includeRaw = req.query.includeRaw === 'true';
    const response = { ...profile };
    if (!includeRaw) {
      delete response.rawDocs;
    }
    
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /match/api/profiles/:id
 * Update a profile
 */
router.put('/api/profiles/:id', (req, res) => {
  try {
    const profiles = loadProfiles();
    const existingProfile = profiles[req.params.id];
    
    if (!existingProfile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    const docs = req.body;
    
    // Re-parse profile from updated docs
    const structured = parseProfile(docs);
    
    // Update profile
    const updatedProfile = {
      ...existingProfile,
      ...structured,
      rawDocs: {
        soul: docs.soul || existingProfile.rawDocs.soul,
        identity: docs.identity || existingProfile.rawDocs.identity,
        tools: docs.tools || existingProfile.rawDocs.tools,
        memory: docs.memory || existingProfile.rawDocs.memory,
        agents: docs.agents || existingProfile.rawDocs.agents,
        user: docs.user || existingProfile.rawDocs.user,
        custom: docs.custom || existingProfile.rawDocs.custom
      },
      updatedAt: new Date().toISOString()
    };
    
    profiles[req.params.id] = updatedProfile;
    saveProfiles(profiles);
    
    res.json(updatedProfile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /match/api/profiles/:id
 * Delete a profile
 */
router.delete('/api/profiles/:id', (req, res) => {
  try {
    const profiles = loadProfiles();
    
    if (!profiles[req.params.id]) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    delete profiles[req.params.id];
    saveProfiles(profiles);
    
    res.json({ success: true, message: 'Profile deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /match/api/discover
 * Discover agents by natural language query
 */
router.get('/api/discover', (req, res) => {
  try {
    const { q: query, skills, lookingFor, limit = 20 } = req.query;
    
    if (!query && !skills && !lookingFor) {
      return res.status(400).json({ 
        error: 'Provide at least one search parameter: q, skills, or lookingFor' 
      });
    }
    
    const profiles = loadProfiles();
    
    // Parse skills filter
    let skillsArray = [];
    if (skills) {
      skillsArray = Array.isArray(skills) 
        ? skills 
        : skills.includes(',') 
          ? skills.split(',').map(s => s.trim())
          : [skills];
    }
    
    // Score and rank all profiles
    let results = Object.values(profiles).map(profile => {
      const relevance = calculateRelevance(profile, query || '', {
        skills: skillsArray,
        lookingFor
      });
      
      return {
        id: profile.id,
        name: profile.name,
        bio: profile.bio,
        interests: profile.interests,
        skills: profile.skills,
        currentProjects: profile.currentProjects,
        lookingFor: profile.lookingFor,
        workStyle: profile.workStyle,
        platforms: profile.platforms,
        matchScore: relevance.score,
        matchReasons: relevance.reasons
      };
    });
    
    // Filter out zero-score results
    results = results.filter(r => r.matchScore > 0);
    
    // Sort by relevance
    results.sort((a, b) => b.matchScore - a.matchScore);
    
    // Apply limit
    const limitNum = parseInt(limit, 10);
    if (!isNaN(limitNum) && limitNum > 0) {
      results = results.slice(0, limitNum);
    }
    
    res.json({
      query: query || null,
      skills: skillsArray.length > 0 ? skillsArray : null,
      lookingFor: lookingFor || null,
      count: results.length,
      results
    });
  } catch (error) {
    console.error('Discovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
