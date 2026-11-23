export type Language = 'ar' | 'en';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export interface MarketTicker {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  weightedAvgPrice: number;
  bidPrice: number;
  askPrice: number;
  count: number;
  updatedAt: number;
}

export interface OhlcvCandle {
  time: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  bids: Array<{ price: number; qty: number }>;
  asks: Array<{ price: number; qty: number }>;
  bestBid: number;
  bestAsk: number;
  spreadPercent: number;
  bidVolumeTop20: number;
  askVolumeTop20: number;
  imbalanceRatio: number;
  updatedAt: number;
}

export interface LinePoint {
  time: number;
  value: number;
}

export interface MacdPoint {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

export interface BollingerPoint {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

export interface TechnicalIndicatorSeries {
  ema20: LinePoint[];
  ema50: LinePoint[];
  ema200: LinePoint[];
  rsi14: LinePoint[];
  macd: MacdPoint[];
  bollinger: BollingerPoint[];
  atr14: LinePoint[];
}

export interface TechnicalIndicatorsSummary {
  symbol: string;
  timeframe: Timeframe;
  candleCount: number;
  lastPrice: number;
  lastCandleTime: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macd: {
    line: number | null;
    signal: number | null;
    histogram: number | null;
  };
  bollinger: {
    upper: number | null;
    middle: number | null;
    lower: number | null;
    bandwidthPercent: number | null;
  };
  atr14: number | null;
  atrPercent: number | null;
  volumeSma20: number | null;
  volumeRatio: number | null;
  supportLevels: number[];
  resistanceLevels: number[];
  trendDirection: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  trendStrength: 'STRONG' | 'MODERATE' | 'WEAK';
  marketStructure: string;
  volatilityState: 'LOW' | 'NORMAL' | 'HIGH';
}

export interface AiAnalysisReport {
  id: string;
  symbol: string;
  coinName: string;
  timeframe: Timeframe;
  analysisType: 'market' | 'vision';
  verdict: 'BUY' | 'WAIT' | 'AVOID';
  verifiedPrice: number;
  dataSource: string;
  dataTimestamp: string;
  overallDirection: string;
  trendStrength: string;
  technicalAnalysis: string;
  supportLevels: number[];
  resistanceLevels: number[];
  entryZone: {
    justified: boolean;
    low: number | null;
    high: number | null;
    note: string;
  };
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  stopLoss: number | null;
  riskRewardRatio: number | null;
  potentialProfitPercent: {
    tp1: number | null;
    tp2: number | null;
    tp3: number | null;
  };
  potentialLossPercent: number | null;
  bullishScenario: string;
  bearishScenario: string;
  invalidationLevel: number | null;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  confidenceScore: number;
  confidenceExplanation: string;
  supportingReasons: string[];
  opposingReasons: string[];
  technicalReasons: string[];
  limitationsAndUncertainty: string;
  verifiedMarketFacts: string[];
  aiInterpretations: string[];
  needsUserConfirmation?: boolean;
  recognizedChartInfo?: {
    coin?: string;
    pair?: string;
    timeframe?: string;
    confidence?: string;
  };
  createdAt: string;
}

export type SignalStatus =
  | 'ACTIVE'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'TP3_HIT'
  | 'STOP_LOSS_HIT'
  | 'CANCELLED';

export interface TradingSignal {
  id: string;
  symbol: string;
  source: 'ADMIN' | 'AI';
  timeframe: Timeframe;
  status: SignalStatus;
  entryLow: number;
  entryHigh: number;
  tp1: number;
  tp2: number;
  tp3: number;
  stopLoss: number;
  riskRewardRatio: number;
  explanation: string;
  entryReferencePrice?: number;
  actualResultPercent?: number;
  ambiguityNote?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SignalEvent {
  id: string;
  signalId: string;
  symbol: string;
  eventType: 'CREATED' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'STOP_LOSS_HIT' | 'CANCELLED';
  triggerPrice: number;
  resultPercent: number;
  note?: string;
  occurredAt: string;
}

export interface PortfolioHolding {
  symbol: string; // e.g., BTC
  pair: string;   // e.g., BTCUSDT
  quantity: number;
  avgBuyPrice: number;
  updatedAt: string;
}

export interface PortfolioTransaction {
  id: string;
  userId: string;
  asset: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  priceUsdt: number;
  note?: string;
  executedAt: string;
}

export interface PriceAlert {
  id: string;
  userId: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW' | 'ENTRY_ZONE' | 'TP_TARGET' | 'SL_TARGET';
  targetPrice: number;
  targetPriceUpper?: number;
  emailNotify: boolean;
  status: 'ACTIVE' | 'TRIGGERED' | 'DISABLED';
  triggeredAt?: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  type: 'PRICE_ALERT' | 'SIGNAL_EVENT' | 'ANNOUNCEMENT' | 'SYSTEM';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  role: 'user' | 'admin';
  plan: 'free' | 'pro';
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface UserPreferences {
  userId: string;
  language: Language;
  defaultQuoteAsset: 'USDT';
  defaultTimeframe: Timeframe;
  emailAlertsEnabled: boolean;
  signalNotificationsEnabled: boolean;
  priceAlertsEnabled: boolean;
  updatedAt: string;
}

export interface AppConfig {
  freeDailyAiLimit: number;
  proDailyAiLimit: number;
  proMonthlyPriceUsd: number;
  proAnnualPriceUsd: number;
  proDurationDays: number;
  proFeatures: string[];
  freeFeatures: string[];
  announcement: string;
  updatedAt: string;
}

export interface ServiceReadiness {
  binanceMarket: { ok: boolean; wsConnected: boolean; lastTickAt: number | null; pairCount: number };
  geminiAi: { configured: boolean; missingVars: string[] };
  resendEmail: { configured: boolean; missingVars: string[] };
  supabase: {
    configured: boolean;
    connected: boolean;
    schemaReady: boolean;
    url: string;
    missingVars: string[];
    error?: string;
  };
  paymentGateway: { configured: boolean; status: 'pending_configuration' | 'active' };
}
