import { Router } from 'express';
import { listPublicSignals } from '../services/dataStore.ts';
import { binanceMarket } from '../services/binanceMarket.ts';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : 'ALL';
    const sourceFilter = typeof req.query.source === 'string' ? req.query.source : 'ALL';

    const result = await listPublicSignals(statusFilter, sourceFilter, (sym) =>
      binanceMarket.getLivePrice(sym),
    );

    res.json({
      configured: true,
      signals: result.signals,
      events: result.events,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load signals' });
  }
});

export default router;
