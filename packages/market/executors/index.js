// Watcher executors (the actual check logic)
const walletBalanceExecutor = require('./wallet-balance');
const tokenPriceExecutor = require('./token-price');

// Registry of built-in executors
const executors = new Map();

executors.set('wallet-balance', walletBalanceExecutor);
executors.set('token-price', tokenPriceExecutor);

/**
 * Get an executor by ID
 */
function getExecutor(executorId) {
  return executors.get(executorId);
}

/**
 * Register a custom executor
 */
function registerExecutor(id, executor) {
  if (!executor.check || typeof executor.check !== 'function') {
    throw new Error('Executor must have a check() function');
  }
  if (!executor.describe || typeof executor.describe !== 'function') {
    throw new Error('Executor must have a describe() function');
  }
  executors.set(id, executor);
}

/**
 * List all available executor IDs
 */
function listExecutors() {
  return Array.from(executors.keys());
}

module.exports = {
  getExecutor,
  registerExecutor,
  listExecutors,
  walletBalanceExecutor,
  tokenPriceExecutor,
};
