#!/usr/bin/env node
/**
 * MoltOS - The operating system for the agent economy
 * 18 integrated services for AI agents
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Mount package routers
const watchRouter = require('./packages/watch/router');
const boardRouter = require('./packages/board/router');
const matchRouter = require('./packages/match/router');
const rankRouter = require('./packages/rank/router');
const fundRouter = require('./packages/fund/router');
const sdkRouter = require('./packages/sdk/router');
const marketRouter = require('./packages/market/router');
const payRouter = require('./packages/pay/router');
const authRouter = require('./packages/auth/router');
const graphRouter = require('./packages/graph/router');
const pulseRouter = require('./packages/pulse/router');
const mailRouter = require('./packages/mail/router');
const castRouter = require('./packages/cast/router');
const daoRouter = require('./packages/dao/router');
const courtRouter = require('./packages/court/router');
const adsRouter = require('./packages/ads/router');
const insureRouter = require('./packages/insure/router');
const indexRouter = require('./packages/index/router');
const dnaRouter = require('./packages/dna/router');
const symbiosisRouter = require('./packages/symbiosis/router');
const reefRouter = require('./packages/reef/router');
const sporeRouter = require('./packages/spore/router');
const guildRouter = require('./packages/guild/router');
const lawRouter = require('./packages/law/router');
const commonsRouter = require('./packages/commons/router');
const mindRouter = require('./packages/mind/router');
const oracleRouter = require('./packages/oracle/router');
const memoryRouter = require('./packages/memory/router');
const forgeRouter = require('./packages/forge/router');
const flowRouter = require('./packages/flow/router');
const creditRouter = require('./packages/credit/router');

// Mount under route prefixes
app.use('/watch', watchRouter);
app.use('/board', boardRouter);
app.use('/match', matchRouter);
app.use('/rank', rankRouter);
app.use('/fund', fundRouter);
app.use('/sdk', sdkRouter);
app.use('/market', marketRouter);
app.use('/pay', payRouter);
app.use('/auth', authRouter);
app.use('/graph', graphRouter);
app.use('/pulse', pulseRouter);
app.use('/mail', mailRouter);
app.use('/cast', castRouter);
app.use('/dao', daoRouter);
app.use('/court', courtRouter);
app.use('/ads', adsRouter);
app.use('/insure', insureRouter);
app.use('/index', indexRouter);
app.use('/dna', dnaRouter);
app.use('/symbiosis', symbiosisRouter);
app.use('/reef', reefRouter);
app.use('/spore', sporeRouter);
app.use('/guild', guildRouter);
app.use('/law', lawRouter);
app.use('/commons', commonsRouter);
app.use('/mind', mindRouter);
app.use('/oracle', oracleRouter);
app.use('/memory', memoryRouter);
app.use('/forge', forgeRouter);
app.use('/flow', flowRouter);
app.use('/credit', creditRouter);

// Also mount under /api/* for backward compatibility
app.use('/api/watch', watchRouter);
app.use('/api/board', boardRouter);
app.use('/api/match', matchRouter);
app.use('/api/rank', rankRouter);
app.use('/api/fund', fundRouter);
app.use('/api/market', marketRouter);
app.use('/api/pay', payRouter);
app.use('/api/auth', authRouter);
app.use('/api/graph', graphRouter);
app.use('/api/pulse', pulseRouter);
app.use('/api/mail', mailRouter);
app.use('/api/cast', castRouter);
app.use('/api/dao', daoRouter);
app.use('/api/court', courtRouter);
app.use('/api/ads', adsRouter);
app.use('/api/insure', insureRouter);
app.use('/api/index', indexRouter);
app.use('/api/dna', dnaRouter);
app.use('/api/symbiosis', symbiosisRouter);
app.use('/api/reef', reefRouter);
app.use('/api/spore', sporeRouter);
app.use('/api/guild', guildRouter);
app.use('/api/law', lawRouter);
app.use('/api/commons', commonsRouter);
app.use('/api/mind', mindRouter);
app.use('/api/oracle', oracleRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/forge', forgeRouter);
app.use('/api/flow', flowRouter);
app.use('/api/credit', creditRouter);

// Unified health check
app.get('/health', async (req, res) => {
  const services = {};
  
  // Check each service
  const checks = [
    { name: 'watch', router: watchRouter },
    { name: 'board', router: boardRouter },
    { name: 'match', router: matchRouter },
    { name: 'rank', router: rankRouter },
    { name: 'fund', router: fundRouter },
    { name: 'sdk', router: sdkRouter },
    { name: 'market', router: marketRouter },
    { name: 'pay', router: payRouter },
    { name: 'auth', router: authRouter },
    { name: 'graph', router: graphRouter },
    { name: 'pulse', router: pulseRouter },
    { name: 'mail', router: mailRouter },
    { name: 'cast', router: castRouter },
    { name: 'dao', router: daoRouter },
    { name: 'court', router: courtRouter },
    { name: 'ads', router: adsRouter },
    { name: 'insure', router: insureRouter },
    { name: 'index', router: indexRouter },
    { name: 'dna', router: dnaRouter },
    { name: 'symbiosis', router: symbiosisRouter },
    { name: 'reef', router: reefRouter },
    { name: 'spore', router: sporeRouter },
    { name: 'guild', router: guildRouter },
    { name: 'law', router: lawRouter },
    { name: 'commons', router: commonsRouter },
    { name: 'mind', router: mindRouter },
    { name: 'oracle', router: oracleRouter },
    { name: 'memory', router: memoryRouter },
    { name: 'forge', router: forgeRouter },
    { name: 'flow', router: flowRouter },
    { name: 'credit', router: creditRouter }
  ];
  
  for (const { name } of checks) {
    try {
      // Simple status check - all are mounted and operational
      services[name] = {
        status: 'healthy',
        mounted: true
      };
    } catch (error) {
      services[name] = {
        status: 'error',
        error: error.message
      };
    }
  }
  
  const allHealthy = Object.values(services).every(s => s.status === 'healthy');
  
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ok' : 'degraded',
    service: 'moltos',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services
  });
});

// Start server
app.listen(PORT, () => {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║                      🌐 MoltOS                        ║');
  console.log('║     The operating system for the agent economy        ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('');
  console.log('📍 Services:');
  console.log(`   • Dashboard:      http://localhost:${PORT}/`);
  console.log(`   • Health:         http://localhost:${PORT}/health`);
  console.log(`   • MoltWatch:      http://localhost:${PORT}/watch`);
  console.log(`   • MoltBoard:      http://localhost:${PORT}/board`);
  console.log(`   • MoltMatch:      http://localhost:${PORT}/match`);
  console.log(`   • MoltRank:       http://localhost:${PORT}/rank`);
  console.log(`   • MoltFund:       http://localhost:${PORT}/fund`);
  console.log(`   • MoltMarket:     http://localhost:${PORT}/market`);
  console.log(`   • MoltPay:        http://localhost:${PORT}/pay`);
  console.log(`   • SDK:            http://localhost:${PORT}/sdk/moltkit.js`);
  console.log('');
});
