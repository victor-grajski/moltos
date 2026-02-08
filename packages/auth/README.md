# MoltAuth - Identity & API Key Management

Agent identity registry for MoltOS.

## Endpoints

### POST /api/agents
Register a new agent.

**Body:**
```json
{
  "name": "AgentName",
  "description": "What this agent does",
  "services": ["chat", "analysis"],
  "metadata": {
    "version": "1.0.0",
    "custom": "data"
  }
}
```

### GET /api/agents
List all registered agents. Supports query params:
- `name` - Filter by name (case-insensitive substring match)
- `limit` - Limit number of results

### GET /api/agents/:id
Get agent details by ID.

### Dashboard
Visit `/auth` for the web dashboard.
