// x402-sentinel: Recurring billing system (merged into MoltMarket)
const store = require('./store');
const { PLATFORM_FEE, OPERATOR_SHARE } = require('./models');

/**
 * Find all watchers that have billing due (nextBillingAt <= now)
 */
async function checkDueBillings() {
  const now = new Date().toISOString();
  const watchers = await store.getWatchers({ status: 'active' });
  
  return watchers.filter(watcher => {
    if (watcher.billingCycle === 'one-time') return false;
    if (!watcher.nextBillingAt) return false;
    return watcher.nextBillingAt <= now;
  });
}

/**
 * Process billing for a specific watcher
 */
async function processBilling(watcherId) {
  const watcher = await store.getWatcher(watcherId);
  if (!watcher) {
    throw new Error(`Watcher ${watcherId} not found`);
  }

  if (watcher.billingCycle === 'one-time') {
    return {
      success: false,
      reason: 'Watcher has one-time billing cycle',
    };
  }

  if (!watcher.nextBillingAt || watcher.nextBillingAt > new Date().toISOString()) {
    return {
      success: false,
      reason: 'Billing not due yet',
    };
  }

  const watcherType = await store.getWatcherType(watcher.typeId);
  if (!watcherType) {
    throw new Error(`Watcher type ${watcher.typeId} not found`);
  }

  const billingDate = watcher.nextBillingAt;
  const processedAt = new Date().toISOString();
  
  try {
    // Simulate payment (90% success rate)
    const paymentSuccessful = Math.random() > 0.1;
    
    if (!paymentSuccessful) {
      const billingRecord = {
        id: store.generateId(),
        billingDate,
        processedAt,
        amount: watcherType.price,
        status: 'failed',
        paymentId: null,
        failureReason: 'Simulated payment failure',
      };

      const updatedHistory = [...(watcher.billingHistory || []), billingRecord];
      await store.updateWatcher(watcherId, {
        status: 'suspended',
        billingHistory: updatedHistory,
      });

      console.log(`💸 Billing failed for watcher ${watcherId} - marked as suspended`);
      
      return {
        success: false,
        reason: 'Payment failed',
        billingRecord,
        watcherStatus: 'suspended',
      };
    }

    // Successful billing
    const payment = await store.createPayment({
      watcherId,
      operatorId: watcher.operatorId,
      customerId: watcher.customerId,
      amount: watcherType.price,
      operatorShare: watcherType.price * OPERATOR_SHARE,
      platformShare: watcherType.price * PLATFORM_FEE,
      network: process.env.NETWORK || 'eip155:8453',
    });

    const billingRecord = {
      id: store.generateId(),
      billingDate,
      processedAt,
      amount: watcherType.price,
      status: 'success',
      paymentId: payment.id,
      failureReason: null,
    };

    // Calculate next billing date
    let nextBillingAt = null;
    if (watcher.billingCycle === 'weekly') {
      const nextWeek = new Date(billingDate);
      nextWeek.setDate(nextWeek.getDate() + 7);
      nextBillingAt = nextWeek.toISOString();
    } else if (watcher.billingCycle === 'monthly') {
      const nextMonth = new Date(billingDate);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      nextBillingAt = nextMonth.toISOString();
    }

    const updatedHistory = [...(watcher.billingHistory || []), billingRecord];
    await store.updateWatcher(watcherId, {
      nextBillingAt,
      billingHistory: updatedHistory,
    });

    await store.incrementOperatorStats(watcher.operatorId, 'totalEarned', payment.operatorShare);

    console.log(`✅ Billing successful for watcher ${watcherId} - next billing: ${nextBillingAt}`);

    return {
      success: true,
      billingRecord,
      payment,
      nextBillingAt,
      watcherStatus: 'active',
    };

  } catch (error) {
    const billingRecord = {
      id: store.generateId(),
      billingDate,
      processedAt,
      amount: watcherType.price,
      status: 'failed',
      paymentId: null,
      failureReason: `System error: ${error.message}`,
    };

    const updatedHistory = [...(watcher.billingHistory || []), billingRecord];
    await store.updateWatcher(watcherId, {
      status: 'suspended',
      billingHistory: updatedHistory,
    });

    console.error(`❌ Billing system error for watcher ${watcherId}:`, error.message);

    return {
      success: false,
      reason: 'System error',
      billingRecord,
      watcherStatus: 'suspended',
      error: error.message,
    };
  }
}

/**
 * Process all due billings
 */
async function processAllDueBillings() {
  const dueBillings = await checkDueBillings();
  const results = {
    totalDue: dueBillings.length,
    successful: 0,
    failed: 0,
    suspended: 0,
    details: [],
  };

  for (const watcher of dueBillings) {
    try {
      const result = await processBilling(watcher.id);
      results.details.push({
        watcherId: watcher.id,
        result,
      });

      if (result.success) {
        results.successful++;
      } else {
        results.failed++;
        if (result.watcherStatus === 'suspended') {
          results.suspended++;
        }
      }
    } catch (error) {
      console.error(`Error processing billing for ${watcher.id}:`, error);
      results.failed++;
      results.details.push({
        watcherId: watcher.id,
        result: {
          success: false,
          reason: 'Processing error',
          error: error.message,
        },
      });
    }
  }

  return results;
}

module.exports = {
  checkDueBillings,
  processBilling,
  processAllDueBillings,
};
