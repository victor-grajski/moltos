// x402-sentinel: Core data models for wallet monitoring
// Merged into MoltMarket package

// Operator - An agent or entity that provides watcher services
const OperatorSchema = {
  id: 'string',
  name: 'string',
  wallet: 'string',
  description: 'string',
  website: 'string?',
  status: 'string',
  createdAt: 'string',
  stats: {
    watchersCreated: 'number',
    totalTriggers: 'number', 
    totalEarned: 'number',
    uptimePercent: 'number',
  },
};

// WatcherType - A template for a kind of watcher
const WatcherTypeSchema = {
  id: 'string',
  operatorId: 'string',
  name: 'string',
  category: 'string',
  description: 'string',
  price: 'number',
  configSchema: 'object',
  status: 'string',
  createdAt: 'string',
  stats: {
    instances: 'number',
    triggers: 'number',
  },
};

// Watcher - An instance of a watcher type
const WatcherSchema = {
  id: 'string',
  typeId: 'string',
  operatorId: 'string',
  customerId: 'string',
  config: 'object',
  webhook: 'string',
  status: 'string',
  createdAt: 'string',
  expiresAt: 'string?',
  lastChecked: 'string?',
  lastTriggered: 'string?',
  triggerCount: 'number',
  billingCycle: 'string',
  nextBillingAt: 'string?',
  billingHistory: 'array',
  cancelledAt: 'string?',
  cancellationReason: 'string?',
  pollingInterval: 'number',
  ttl: 'number?',
  retryPolicy: 'object',
  tier: 'string?',
  sla: 'object',
  lastCheckSuccess: 'boolean?',
  consecutiveFailures: 'number',
};

// Payment record
const PaymentSchema = {
  id: 'string',
  watcherId: 'string',
  operatorId: 'string',
  customerId: 'string',
  amount: 'number',
  operatorShare: 'number',
  platformShare: 'number',
  txHash: 'string?',
  network: 'string',
  createdAt: 'string',
};

// Categories
const CATEGORIES = [
  'wallet',
  'price',
  'contract',
  'social',
  'defi',
  'custom',
];

// Revenue split
const PLATFORM_FEE = 0.20; // 20%
const OPERATOR_SHARE = 0.80; // 80%

// Free tier
const FREE_TIER = {
  MAX_WATCHERS: 1,
  POLLING_INTERVAL_MIN: 30,
  UPGRADE_PROMPT: 'Free tier limited to 1 watcher. Upgrade to paid tier for unlimited watchers and faster polling.',
};

// Polling configuration
const POLLING_INTERVALS = [5, 15, 30, 60]; // minutes
const TTL_OPTIONS = [24, 72, 168, null]; // hours (null = no expiry)
const MAX_RETRIES_LIMIT = 5;

const DEFAULT_POLLING = {
  pollingInterval: 5,
  ttl: null,
  retryPolicy: { maxRetries: 3, backoffMs: 1000 }
};

// Customer
const CustomerSchema = {
  id: 'string',
  tier: 'string',
  freeWatchersUsed: 'number',
  createdAt: 'string',
  upgradedAt: 'string?',
  stats: {
    totalWatchersCreated: 'number',
    totalSpent: 'number',
  },
};

// Receipt - Idempotent record
const ReceiptSchema = {
  id: 'string',
  watcherId: 'string',
  typeId: 'string',
  amount: 'number',
  chain: 'string',
  rail: 'string',
  timestamp: 'string',
  fulfillmentHash: 'string',
  customerId: 'string',
  operatorId: 'string',
  paymentId: 'string',
};

// SLA Configuration
const SLA_CONFIG = {
  DEFAULT_UPTIME_THRESHOLD: 99.0,
  CONSECUTIVE_FAILURE_LIMIT: 5,
  VIOLATION_REFUND_PERCENT: 0.5,
  MEASUREMENT_WINDOW_HOURS: 24,
  GRACE_PERIOD_MINUTES: 15,
};

// Wallet monitoring aliases (fast/normal/slow/whale)
const MONITORING_ALIASES = {
  fast: { pollingInterval: 5, description: 'Check every 5 minutes (high-frequency trading)' },
  normal: { pollingInterval: 15, description: 'Check every 15 minutes (standard monitoring)' },
  slow: { pollingInterval: 60, description: 'Check every hour (portfolio tracking)' },
  whale: { pollingInterval: 5, ttl: null, description: 'Premium whale monitoring (5min, no expiry)' },
};

module.exports = {
  OperatorSchema,
  WatcherTypeSchema,
  WatcherSchema,
  PaymentSchema,
  CustomerSchema,
  ReceiptSchema,
  CATEGORIES,
  PLATFORM_FEE,
  OPERATOR_SHARE,
  FREE_TIER,
  POLLING_INTERVALS,
  TTL_OPTIONS,
  MAX_RETRIES_LIMIT,
  DEFAULT_POLLING,
  SLA_CONFIG,
  MONITORING_ALIASES,
};
