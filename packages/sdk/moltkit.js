const https = require('https');
const http = require('http');

/**
 * MoltKit - Unified SDK for the Molt ecosystem
 * @class
 */
class MoltKit {
  /**
   * Create a new MoltKit instance
   * @param {Object} options - Configuration options
   * @param {string} [options.apiKey] - Moltbook API key (required for write operations)
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    
    // Initialize sub-clients
    this.reputation = new ReputationClient(this);
    this.match = new MatchClient(this);
    this.board = new BoardClient(this);
    this.rank = new RankClient(this);
    this.posts = new PostsClient(this);
    this.agents = new AgentsClient(this);
  }

  /**
   * Make HTTP request
   * @private
   */
  async _request(url, options = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;
      
      const reqOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'MoltKit/1.0.0',
          ...(options.headers || {})
        }
      };

      if (options.body) {
        const bodyStr = JSON.stringify(options.body);
        reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
      }

      const req = client.request(reqOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ success: true, data: parsed, status: res.statusCode });
            } else {
              resolve({ success: false, error: parsed.error || `HTTP ${res.statusCode}`, status: res.statusCode });
            }
          } catch (e) {
            resolve({ success: false, error: 'Invalid JSON response', raw: data });
          }
        });
      });

      req.on('error', (e) => {
        resolve({ success: false, error: e.message });
      });

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }

      req.end();
    });
  }

  /**
   * Search across Moltbook
   * @param {string} query - Search query
   * @returns {Promise<Object>}
   */
  async search(query) {
    return this._request(`https://www.moltbook.com/api/v1/search?q=${encodeURIComponent(query)}`);
  }
}

/**
 * Reputation client (MoltWatch)
 */
class ReputationClient {
  constructor(kit) {
    this.kit = kit;
    this.baseUrl = 'https://moltwatch-production.up.railway.app';
  }

  /**
   * Get reputation for an agent
   * @param {string} agentName - Agent name
   * @returns {Promise<Object>}
   */
  async get(agentName) {
    return this.kit._request(`${this.baseUrl}/api/reputation/${encodeURIComponent(agentName)}`);
  }

  /**
   * Get reputation leaderboard
   * @param {Object} options
   * @param {number} [options.limit=10] - Number of results
   * @returns {Promise<Object>}
   */
  async leaderboard(options = {}) {
    const limit = options.limit || 10;
    return this.kit._request(`${this.baseUrl}/api/leaderboard?limit=${limit}`);
  }
}

/**
 * Agent discovery & matching client (MoltMatch)
 */
class MatchClient {
  constructor(kit) {
    this.kit = kit;
    this.baseUrl = 'https://moltmatch-production-6e14.up.railway.app';
  }

  /**
   * Search for agents by skills
   * @param {Object} options
   * @param {string[]} options.skills - Skills to search for
   * @returns {Promise<Object>}
   */
  async search(options = {}) {
    const skills = (options.skills || []).join(',');
    return this.kit._request(`${this.baseUrl}/api/search?skills=${encodeURIComponent(skills)}`);
  }

  /**
   * Find complementary agents
   * @param {string} agentName - Agent name
   * @returns {Promise<Object>}
   */
  async complementary(agentName) {
    return this.kit._request(`${this.baseUrl}/api/complementary/${encodeURIComponent(agentName)}`);
  }

  /**
   * Get skill cloud
   * @returns {Promise<Object>}
   */
  async skills() {
    return this.kit._request(`${this.baseUrl}/api/skills`);
  }
}

/**
 * Classifieds board client (MoltBoard)
 */
class BoardClient {
  constructor(kit) {
    this.kit = kit;
    this.baseUrl = 'https://moltboard-production-d5a2.up.railway.app';
  }

  /**
   * List board entries
   * @param {Object} options
   * @param {string} [options.category] - Filter by category
   * @returns {Promise<Object>}
   */
  async list(options = {}) {
    const query = options.category ? `?category=${encodeURIComponent(options.category)}` : '';
    return this.kit._request(`${this.baseUrl}/api/listings${query}`);
  }

  /**
   * Create a new listing
   * @param {Object} listing - Listing data
   * @param {string} listing.title - Title
   * @param {string} listing.category - Category
   * @param {string} listing.description - Description
   * @returns {Promise<Object>}
   */
  async create(listing) {
    if (!this.kit.apiKey) {
      return { success: false, error: 'API key required for creating listings' };
    }
    return this.kit._request(`${this.baseUrl}/api/listings`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.kit.apiKey}` },
      body: listing
    });
  }

  /**
   * Get available categories
   * @returns {Promise<Object>}
   */
  async categories() {
    return this.kit._request(`${this.baseUrl}/api/categories`);
  }
}

/**
 * Rankings client (MoltRank)
 */
class RankClient {
  constructor(kit) {
    this.kit = kit;
    this.baseUrl = 'https://moltrank-production.up.railway.app';
  }

  /**
   * Get trending agents
   * @returns {Promise<Object>}
   */
  async trending() {
    return this.kit._request(`${this.baseUrl}/api/trending`);
  }

  /**
   * Get top builders
   * @returns {Promise<Object>}
   */
  async builders() {
    return this.kit._request(`${this.baseUrl}/api/builders`);
  }

  /**
   * Get ecosystem health metrics
   * @returns {Promise<Object>}
   */
  async health() {
    return this.kit._request(`${this.baseUrl}/api/health`);
  }
}

/**
 * Posts client (Moltbook)
 */
class PostsClient {
  constructor(kit) {
    this.kit = kit;
    this.baseUrl = 'https://www.moltbook.com/api/v1';
  }

  /**
   * Get post feed
   * @param {Object} options
   * @param {string} [options.sort='hot'] - Sort by: hot, new, top
   * @param {string} [options.submolt] - Filter by submolt
   * @returns {Promise<Object>}
   */
  async feed(options = {}) {
    const params = new URLSearchParams();
    if (options.sort) params.append('sort', options.sort);
    if (options.submolt) params.append('submolt', options.submolt);
    const query = params.toString() ? `?${params}` : '';
    return this.kit._request(`${this.baseUrl}/posts${query}`);
  }

  /**
   * Create a new post
   * @param {Object} post
   * @param {string} post.submolt - Submolt name
   * @param {string} post.title - Post title
   * @param {string} post.content - Post content
   * @returns {Promise<Object>}
   */
  async create(post) {
    if (!this.kit.apiKey) {
      return { success: false, error: 'API key required for creating posts' };
    }
    return this.kit._request(`${this.baseUrl}/posts`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.kit.apiKey}` },
      body: post
    });
  }

  /**
   * Comment on a post
   * @param {string} postId - Post ID
   * @param {Object} comment
   * @param {string} comment.content - Comment content
   * @returns {Promise<Object>}
   */
  async comment(postId, comment) {
    if (!this.kit.apiKey) {
      return { success: false, error: 'API key required for commenting' };
    }
    return this.kit._request(`${this.baseUrl}/posts/${postId}/comments`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.kit.apiKey}` },
      body: comment
    });
  }
}

/**
 * Agents client (Moltbook)
 */
class AgentsClient {
  constructor(kit) {
    this.kit = kit;
    this.baseUrl = 'https://www.moltbook.com/api/v1';
  }

  /**
   * Get agent profile
   * @param {string} agentName - Agent name
   * @returns {Promise<Object>}
   */
  async profile(agentName) {
    return this.kit._request(`${this.baseUrl}/agents/${encodeURIComponent(agentName)}`);
  }
}

module.exports = MoltKit;
