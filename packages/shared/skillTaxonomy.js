/**
 * Skill Taxonomy for MoltOS
 * Provides structured skill categories and compatibility scoring
 */

const SKILL_TAXONOMY = {
  infrastructure: {
    name: 'Infrastructure',
    tags: [
      'docker', 'kubernetes', 'railway', 'cloud', 'aws', 'gcp', 'azure',
      'hosting', 'deployment', 'ci/cd', 'devops', 'monitoring', 'logging',
      'uptime', 'observability', 'alerting', 'load-balancing', 'scaling'
    ]
  },
  data: {
    name: 'Data',
    tags: [
      'database', 'postgres', 'redis', 'sqlite', 'mongodb', 'mysql',
      'analytics', 'metrics', 'visualization', 'dashboard', 'reporting',
      'scraping', 'crawling', 'parsing', 'extraction', 'etl', 'pipeline',
      'storage', 'indexing', 'search', 'elasticsearch'
    ]
  },
  ml: {
    name: 'Machine Learning',
    tags: [
      'ai', 'machine learning', 'llm', 'gpt', 'claude', 'openai', 'anthropic',
      'model', 'inference', 'training', 'embeddings', 'vector-db',
      'nlp', 'language', 'sentiment', 'text-analysis', 'classification',
      'prediction', 'recommendation', 'computer-vision', 'image-recognition'
    ]
  },
  crypto: {
    name: 'Crypto & Web3',
    tags: [
      'crypto', 'bitcoin', 'ethereum', 'solana', 'polygon', 'blockchain',
      'defi', 'nft', 'web3', 'smart-contracts', 'dex', 'dao',
      'trading', 'market', 'price', 'swap', 'liquidity', 'staking',
      'wallet', 'wallet-monitoring', 'token', 'coin', 'yield-farming'
    ]
  },
  social: {
    name: 'Social & Communication',
    tags: [
      'social', 'twitter', 'discord', 'telegram', 'slack', 'community',
      'messaging', 'chat', 'notifications', 'email', 'sms',
      'posting', 'content', 'engagement', 'moderation', 'bot',
      'influencer', 'analytics', 'sentiment-tracking'
    ]
  },
  creative: {
    name: 'Creative & Media',
    tags: [
      'media', 'image', 'video', 'audio', 'tts', 'speech', 'voice',
      'design', 'ui', 'ux', 'frontend', 'css', 'react', 'vue',
      'animation', 'graphics', 'art', 'generation', 'editing',
      'music', 'sound', 'podcast', 'streaming'
    ]
  },
  automation: {
    name: 'Automation & Workflows',
    tags: [
      'automation', 'workflow', 'scheduling', 'cron', 'task',
      'orchestration', 'coordination', 'agent', 'multi-agent',
      'collaboration', 'delegation', 'retry', 'queue', 'job',
      'trigger', 'webhook', 'event-driven', 'serverless'
    ]
  },
  security: {
    name: 'Security & Privacy',
    tags: [
      'security', 'auth', 'authentication', 'authorization', 'jwt',
      'encryption', 'cryptography', 'hashing', 'signing',
      'vulnerability', 'scanning', 'penetration-testing', 'audit',
      'privacy', 'anonymization', 'compliance', 'access-control'
    ]
  },
  governance: {
    name: 'Governance & Coordination',
    tags: [
      'governance', 'voting', 'proposal', 'decision-making', 'consensus',
      'coordination', 'reputation', 'trust', 'verification',
      'dispute-resolution', 'arbitration', 'policy', 'rules',
      'incentives', 'rewards', 'penalties', 'moderation'
    ]
  }
};

/**
 * Get all categories with their tags
 */
function getTaxonomy() {
  return SKILL_TAXONOMY;
}

/**
 * Get flat list of all predefined tags
 */
function getAllTags() {
  const tags = new Set();
  Object.values(SKILL_TAXONOMY).forEach(category => {
    category.tags.forEach(tag => tags.add(tag));
  });
  return Array.from(tags).sort();
}

/**
 * Get category for a tag
 */
function getCategoryForTag(tag) {
  const lowerTag = tag.toLowerCase();
  for (const [categoryKey, category] of Object.entries(SKILL_TAXONOMY)) {
    if (category.tags.includes(lowerTag)) {
      return categoryKey;
    }
  }
  return null;
}

/**
 * Validate and normalize skill tags
 * Returns { predefined: [], freeform: [] }
 */
function normalizeSkills(skills) {
  if (!Array.isArray(skills)) return { predefined: [], freeform: [] };
  
  const allPredefined = getAllTags();
  const predefined = [];
  const freeform = [];
  
  skills.forEach(skill => {
    const normalized = skill.toLowerCase().trim();
    if (allPredefined.includes(normalized)) {
      if (!predefined.includes(normalized)) {
        predefined.push(normalized);
      }
    } else if (normalized) {
      if (!freeform.includes(normalized)) {
        freeform.push(normalized);
      }
    }
  });
  
  return { predefined, freeform };
}

/**
 * Calculate skill compatibility score between two agents
 * Returns { score, shared, complementary, explanation }
 */
function calculateCompatibility(agentASkills, agentBSkills) {
  const skillsA = new Set(agentASkills.map(s => s.toLowerCase()));
  const skillsB = new Set(agentBSkills.map(s => s.toLowerCase()));
  
  // Find shared skills
  const shared = Array.from(skillsA).filter(s => skillsB.has(s));
  
  // Find complementary skills (unique to each agent)
  const uniqueA = Array.from(skillsA).filter(s => !skillsB.has(s));
  const uniqueB = Array.from(skillsB).filter(s => !skillsA.has(s));
  
  // Count category overlaps
  const categoriesA = new Set(uniqueA.map(s => getCategoryForTag(s)).filter(Boolean));
  const categoriesB = new Set(uniqueB.map(s => getCategoryForTag(s)).filter(Boolean));
  const categoryOverlap = Array.from(categoriesA).filter(c => categoriesB.has(c)).length;
  
  // Scoring:
  // - Shared skills: foundation for collaboration (2 points each)
  // - Complementary skills: value addition (1 point each)
  // - Category overlap: synergy bonus (3 points per overlapping category)
  const score = (shared.length * 2) + 
                (uniqueA.length + uniqueB.length) * 0.5 + 
                (categoryOverlap * 3);
  
  let explanation = '';
  if (shared.length > 0) {
    explanation += `${shared.length} shared skill(s) provide common ground. `;
  }
  if (uniqueA.length > 0 || uniqueB.length > 0) {
    explanation += `${uniqueA.length + uniqueB.length} complementary skill(s) add value. `;
  }
  if (categoryOverlap > 0) {
    explanation += `${categoryOverlap} overlapping categor${categoryOverlap > 1 ? 'ies' : 'y'} show synergy.`;
  }
  
  return {
    score: parseFloat(score.toFixed(2)),
    shared,
    complementary: { agentA: uniqueA, agentB: uniqueB },
    categoryOverlap,
    explanation: explanation.trim()
  };
}

/**
 * Auto-suggest skills from text content
 */
function suggestSkills(text) {
  if (!text) return [];
  
  const lower = text.toLowerCase();
  const suggestions = new Set();
  
  getAllTags().forEach(tag => {
    // Check for exact word match or common variations
    const patterns = [
      new RegExp(`\\b${tag}\\b`, 'i'),
      new RegExp(`\\b${tag}s\\b`, 'i'),  // plural
      new RegExp(`\\b${tag.replace('-', '[ -]')}\\b`, 'i')  // hyphen variations
    ];
    
    if (patterns.some(pattern => pattern.test(lower))) {
      suggestions.add(tag);
    }
  });
  
  return Array.from(suggestions);
}

/**
 * Get skills by category
 */
function getSkillsByCategory(category) {
  const cat = SKILL_TAXONOMY[category];
  return cat ? cat.tags : [];
}

module.exports = {
  getTaxonomy,
  getAllTags,
  getCategoryForTag,
  normalizeSkills,
  calculateCompatibility,
  suggestSkills,
  getSkillsByCategory,
  SKILL_TAXONOMY
};
