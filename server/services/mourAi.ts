import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { ENV, getMissingGeminiVars, isGeminiConfigured } from '../config/env.ts';
import { ServiceNotConfiguredError } from './supabase.ts';
import { binanceMarket } from './binanceMarket.ts';
import { summarizeIndicators } from '../../src/lib/indicators.ts';
import type {
  AiAnalysisReport,
  Language,
  TechnicalIndicatorsSummary,
  Timeframe,
} from '../../src/types/trading.ts';

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!isGeminiConfigured()) {
    throw new ServiceNotConfiguredError(
      'Gemini AI service is not configured. Missing environment variable: GEMINI_API_KEY',
      getMissingGeminiVars(),
    );
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: ENV.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

const analysisResponseSchema = {
  type: Type.OBJECT,
  properties: {
    coinName: { type: Type.STRING },
    verdict: { type: Type.STRING, enum: ['BUY', 'WAIT', 'AVOID'] },
    overallDirection: { type: Type.STRING },
    trendStrength: { type: Type.STRING },
    technicalAnalysis: { type: Type.STRING },
    supportLevels: { type: Type.ARRAY, items: { type: Type.NUMBER } },
    resistanceLevels: { type: Type.ARRAY, items: { type: Type.NUMBER } },
    entryZone: {
      type: Type.OBJECT,
      properties: {
        justified: { type: Type.BOOLEAN },
        low: { type: Type.NUMBER, nullable: true },
        high: { type: Type.NUMBER, nullable: true },
        note: { type: Type.STRING },
      },
      required: ['justified', 'note'],
    },
    tp1: { type: Type.NUMBER, nullable: true },
    tp2: { type: Type.NUMBER, nullable: true },
    tp3: { type: Type.NUMBER, nullable: true },
    stopLoss: { type: Type.NUMBER, nullable: true },
    riskRewardRatio: { type: Type.NUMBER, nullable: true },
    bullishScenario: { type: Type.STRING },
    bearishScenario: { type: Type.STRING },
    invalidationLevel: { type: Type.NUMBER, nullable: true },
    riskLevel: { type: Type.STRING, enum: ['LOW', 'MEDIUM', 'HIGH'] },
    confidenceScore: { type: Type.NUMBER },
    confidenceExplanation: { type: Type.STRING },
    supportingReasons: { type: Type.ARRAY, items: { type: Type.STRING } },
    opposingReasons: { type: Type.ARRAY, items: { type: Type.STRING } },
    technicalReasons: { type: Type.ARRAY, items: { type: Type.STRING } },
    limitationsAndUncertainty: { type: Type.STRING },
    verifiedMarketFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
    aiInterpretations: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    'coinName',
    'verdict',
    'overallDirection',
    'trendStrength',
    'technicalAnalysis',
    'supportLevels',
    'resistanceLevels',
    'entryZone',
    'bullishScenario',
    'bearishScenario',
    'riskLevel',
    'confidenceScore',
    'confidenceExplanation',
    'supportingReasons',
    'opposingReasons',
    'technicalReasons',
    'limitationsAndUncertainty',
    'verifiedMarketFacts',
    'aiInterpretations',
  ],
};

function sanitizePriceLevels(
  raw: Record<string, unknown>,
  verifiedPrice: number,
  summary: TechnicalIndicatorsSummary,
) {
  const verdict = (raw.verdict as 'BUY' | 'WAIT' | 'AVOID') || 'WAIT';
  const entryZone = (raw.entryZone as { justified: boolean; low?: number | null; high?: number | null; note: string }) || {
    justified: false,
    low: null,
    high: null,
    note: '',
  };

  const isPlausible = (val: unknown) =>
    typeof val === 'number' && Number.isFinite(val) && val > verifiedPrice * 0.25 && val < verifiedPrice * 3.5;

  let entryLow = isPlausible(entryZone.low) ? Number(entryZone.low) : null;
  let entryHigh = isPlausible(entryZone.high) ? Number(entryZone.high) : null;
  if (entryLow !== null && entryHigh !== null && entryLow > entryHigh) {
    [entryLow, entryHigh] = [entryHigh, entryLow];
  }

  let tp1 = isPlausible(raw.tp1) ? Number(raw.tp1) : null;
  let tp2 = isPlausible(raw.tp2) ? Number(raw.tp2) : null;
  let tp3 = isPlausible(raw.tp3) ? Number(raw.tp3) : null;
  let stopLoss = isPlausible(raw.stopLoss) ? Number(raw.stopLoss) : null;
  let invalidationLevel = isPlausible(raw.invalidationLevel) ? Number(raw.invalidationLevel) : stopLoss;

  // Enforce Spot long consistency when BUY/entry is justified
  if (verdict !== 'BUY' || !entryZone.justified) {
    entryZone.justified = verdict === 'BUY' && entryLow !== null && entryHigh !== null;
  }

  const refEntry = entryHigh && entryLow ? (entryHigh + entryLow) / 2 : verifiedPrice;
  if (stopLoss !== null && stopLoss >= refEntry) {
    stopLoss = null;
  }
  if (tp1 !== null && tp1 <= refEntry) tp1 = null;
  if (tp2 !== null && (tp1 === null || tp2 <= tp1)) tp2 = null;
  if (tp3 !== null && (tp2 === null || tp3 <= tp2)) tp3 = null;

  const pct = (target: number | null) =>
    target !== null && refEntry > 0 ? Number((((target - refEntry) / refEntry) * 100).toFixed(2)) : null;

  const potentialLossPercent =
    stopLoss !== null && refEntry > 0 ? Number((((stopLoss - refEntry) / refEntry) * 100).toFixed(2)) : null;

  let riskRewardRatio: number | null = null;
  if (tp2 !== null && stopLoss !== null && refEntry > stopLoss) {
    riskRewardRatio = Number(((tp2 - refEntry) / (refEntry - stopLoss)).toFixed(2));
  } else if (tp1 !== null && stopLoss !== null && refEntry > stopLoss) {
    riskRewardRatio = Number(((tp1 - refEntry) / (refEntry - stopLoss)).toFixed(2));
  }

  const rawConfidence = typeof raw.confidenceScore === 'number' ? raw.confidenceScore : 50;
  const confidenceScore = Math.min(92, Math.max(15, Math.round(rawConfidence)));

  const supports = Array.isArray(raw.supportLevels)
    ? raw.supportLevels.filter(isPlausible).slice(0, 4)
    : summary.supportLevels;
  const resistances = Array.isArray(raw.resistanceLevels)
    ? raw.resistanceLevels.filter(isPlausible).slice(0, 4)
    : summary.resistanceLevels;

  return {
    verdict,
    entryZone: {
      justified: Boolean(entryZone.justified && entryLow !== null && entryHigh !== null),
      low: entryLow,
      high: entryHigh,
      note: entryZone.note || '',
    },
    tp1,
    tp2,
    tp3,
    stopLoss,
    invalidationLevel,
    riskRewardRatio,
    potentialProfitPercent: {
      tp1: pct(tp1),
      tp2: pct(tp2),
      tp3: pct(tp3),
    },
    potentialLossPercent,
    confidenceScore,
    supportLevels: supports.length ? supports : summary.supportLevels,
    resistanceLevels: resistances.length ? resistances : summary.resistanceLevels,
  };
}

export async function runMarketAnalysis(params: {
  symbol: string;
  timeframe: Timeframe;
  language: Language;
}): Promise<AiAnalysisReport> {
  const ai = getAiClient();
  const upperSymbol = params.symbol.trim().toUpperCase();

  // Fetch real Binance Spot market data across primary + confirmation timeframes
  const [ticker, candlesPrimary, candlesHtf, orderBook] = await Promise.all([
    binanceMarket.getTickerBySymbol(upperSymbol),
    binanceMarket.getKlines(upperSymbol, params.timeframe, 250),
    binanceMarket.getKlines(upperSymbol, params.timeframe === '1d' || params.timeframe === '1w' ? '1w' : '4h', 220),
    binanceMarket.getOrderBook(upperSymbol, 20).catch(() => null),
  ]);

  if (!ticker || candlesPrimary.length < 30) {
    throw new Error(`Insufficient verified Binance Spot market data for ${upperSymbol}`);
  }

  const primarySummary = summarizeIndicators(upperSymbol, params.timeframe, candlesPrimary);
  const htfTimeframe: Timeframe = params.timeframe === '1d' || params.timeframe === '1w' ? '1w' : '4h';
  const htfSummary = summarizeIndicators(upperSymbol, htfTimeframe, candlesHtf);
  const recentCandles = candlesPrimary.slice(-20).map((c) => ({
    t: new Date(c.time * 1000).toISOString(),
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: Number(c.volume.toFixed(2)),
  }));

  const dataTimestamp = new Date().toISOString();
  const isAr = params.language === 'ar';

  const systemInstruction = `You are Mour AI, the quantitative Spot trading analyst for MourTrading.
CRITICAL RULES:
1. Never promise guaranteed profits or certainty.
2. Never fabricate prices, indicator numbers, or order book figures. Only cite values provided in the VERIFIED MARKET DATA payload.
3. Explicitly separate verified market facts from AI interpretations in the dedicated arrays.
4. For Spot trading, only recommend BUY with entryZone.justified=true when trend, momentum, and R:R (>= 1.5) justify an entry; otherwise choose WAIT or AVOID.
5. Do not present confidenceScore (0-100) as a statistically validated probability — explain in confidenceExplanation that it is an analytical confluence heuristic.
6. Output all prose fields in ${isAr ? 'Arabic (العربية الفصحى المالية الواضحة)' : 'clear professional English'}.`;

  const promptPayload = {
    pair: upperSymbol,
    baseAsset: ticker.baseAsset,
    verifiedSpotPrice: ticker.lastPrice,
    change24hPercent: ticker.priceChangePercent,
    high24h: ticker.highPrice,
    low24h: ticker.lowPrice,
    quoteVolume24hUsdt: ticker.quoteVolume,
    dataSource: 'Binance Spot Public REST/WebSocket (data-api.binance.vision)',
    dataTimestamp,
    primaryTimeframeIndicators: primarySummary,
    higherTimeframeConfirmation: htfSummary,
    orderBookSnapshot: orderBook
      ? {
          bestBid: orderBook.bestBid,
          bestAsk: orderBook.bestAsk,
          spreadPercent: orderBook.spreadPercent,
          bidVolumeTop20: orderBook.bidVolumeTop20,
          askVolumeTop20: orderBook.askVolumeTop20,
          imbalanceRatio: orderBook.imbalanceRatio,
        }
      : 'Order book unavailable for this request',
    last20Candles: recentCandles,
  };

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Analyze this verified Spot market dataset and return the structured JSON trading report:\n${JSON.stringify(promptPayload)}`,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: analysisResponseSchema,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as Record<string, unknown>;
  const sanitized = sanitizePriceLevels(parsed, ticker.lastPrice, primarySummary);

  return {
    id: `ai_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    symbol: upperSymbol,
    coinName: String(parsed.coinName || ticker.baseAsset),
    timeframe: params.timeframe,
    analysisType: 'market',
    verdict: sanitized.verdict,
    verifiedPrice: ticker.lastPrice,
    dataSource: 'Binance Spot (data-api.binance.vision)',
    dataTimestamp,
    overallDirection: String(parsed.overallDirection || primarySummary.trendDirection),
    trendStrength: String(parsed.trendStrength || primarySummary.trendStrength),
    technicalAnalysis: String(parsed.technicalAnalysis || ''),
    supportLevels: sanitized.supportLevels,
    resistanceLevels: sanitized.resistanceLevels,
    entryZone: sanitized.entryZone,
    tp1: sanitized.tp1,
    tp2: sanitized.tp2,
    tp3: sanitized.tp3,
    stopLoss: sanitized.stopLoss,
    riskRewardRatio: sanitized.riskRewardRatio,
    potentialProfitPercent: sanitized.potentialProfitPercent,
    potentialLossPercent: sanitized.potentialLossPercent,
    bullishScenario: String(parsed.bullishScenario || ''),
    bearishScenario: String(parsed.bearishScenario || ''),
    invalidationLevel: sanitized.invalidationLevel,
    riskLevel: (parsed.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH') || 'MEDIUM',
    confidenceScore: sanitized.confidenceScore,
    confidenceExplanation: String(parsed.confidenceExplanation || ''),
    supportingReasons: Array.isArray(parsed.supportingReasons) ? parsed.supportingReasons.map(String) : [],
    opposingReasons: Array.isArray(parsed.opposingReasons) ? parsed.opposingReasons.map(String) : [],
    technicalReasons: Array.isArray(parsed.technicalReasons) ? parsed.technicalReasons.map(String) : [],
    limitationsAndUncertainty: String(parsed.limitationsAndUncertainty || ''),
    verifiedMarketFacts: Array.isArray(parsed.verifiedMarketFacts) ? parsed.verifiedMarketFacts.map(String) : [],
    aiInterpretations: Array.isArray(parsed.aiInterpretations) ? parsed.aiInterpretations.map(String) : [],
    createdAt: new Date().toISOString(),
  };
}

export async function runChartVisionAnalysis(params: {
  imageBase64: string;
  mimeType: string;
  confirmedSymbol?: string;
  confirmedTimeframe?: Timeframe;
  language: Language;
}): Promise<AiAnalysisReport> {
  const ai = getAiClient();
  const isAr = params.language === 'ar';

  // Step 1: Identify coin, pair, and timeframe from the uploaded screenshot
  const recognizeSchema = {
    type: Type.OBJECT,
    properties: {
      coin: { type: Type.STRING },
      pair: { type: Type.STRING },
      timeframe: { type: Type.STRING },
      certainty: { type: Type.STRING, enum: ['HIGH', 'MEDIUM', 'LOW'] },
      visualObservations: { type: Type.STRING },
    },
    required: ['coin', 'pair', 'timeframe', 'certainty', 'visualObservations'],
  };

  const recognizeRes = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.imageBase64,
          },
        },
        {
          text: `Inspect this crypto candlestick chart screenshot. Identify the coin, Spot pair (e.g. BTCUSDT), and timeframe (1m, 5m, 15m, 1h, 4h, 1d, 1w). If uncertain, set certainty to LOW.${
            params.confirmedSymbol ? ` User provided confirmation symbol: ${params.confirmedSymbol}.` : ''
          }${params.confirmedTimeframe ? ` User provided timeframe: ${params.confirmedTimeframe}.` : ''}`,
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: recognizeSchema,
    },
  });

  const rec = JSON.parse((recognizeRes.text ?? '{}').trim()) as {
    coin?: string;
    pair?: string;
    timeframe?: string;
    certainty?: 'HIGH' | 'MEDIUM' | 'LOW';
    visualObservations?: string;
  };

  const resolvedPair = (params.confirmedSymbol || rec.pair || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const validTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
  const normTf = (params.confirmedTimeframe || rec.timeframe || '1h').toLowerCase() as Timeframe;
  const resolvedTf: Timeframe = validTimeframes.includes(normTf) ? normTf : '1h';

  const needsUserConfirmation = !params.confirmedSymbol && (rec.certainty === 'LOW' || !resolvedPair);

  // Attempt live Binance cross-verification if we have a symbol
  let ticker = resolvedPair ? await binanceMarket.getTickerBySymbol(resolvedPair).catch(() => null) : null;
  let candles = ticker ? await binanceMarket.getKlines(resolvedPair, resolvedTf, 200).catch(() => []) : [];
  const summary = ticker && candles.length >= 30 ? summarizeIndicators(resolvedPair, resolvedTf, candles) : null;

  const dataTimestamp = new Date().toISOString();
  const promptText = `Analyze the uploaded chart image together with ${
    ticker && summary
      ? `VERIFIED LIVE BINANCE DATA: ${JSON.stringify({
          pair: resolvedPair,
          verifiedPrice: ticker.lastPrice,
          indicators: summary,
          visualNote: rec.visualObservations,
        })}`
      : `ONLY visual observations (${rec.visualObservations || 'chart image'}). Live Binance verification unavailable or symbol uncertain (${resolvedPair || 'unknown'}). Since live market verification is missing or uncertain, you MUST set verdict to WAIT or AVOID and clearly warn about unverified levels!`
  }
Respond in ${isAr ? 'Arabic' : 'English'}.`;

  const reportRes = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.imageBase64,
          },
        },
        { text: promptText },
      ],
    },
    config: {
      systemInstruction:
        'You are Mour AI Vision Analyst. Combine visual chart structure with verified Binance data if available. Never fabricate live prices. Clearly state when symbol recognition is uncertain.',
      responseMimeType: 'application/json',
      responseSchema: analysisResponseSchema,
    },
  });

  const parsed = JSON.parse((reportRes.text ?? '{}').trim()) as Record<string, unknown>;
  const verifiedPrice = ticker?.lastPrice ?? 0;

  const sanitized =
    ticker && summary
      ? sanitizePriceLevels(parsed, verifiedPrice, summary)
      : {
          verdict: 'WAIT' as const,
          entryZone: { justified: false, low: null, high: null, note: isAr ? 'مطلوب تأكيد الزوج والسعر الحي قبل الدخول.' : 'Pair confirmation and live price verification required.' },
          tp1: null,
          tp2: null,
          tp3: null,
          stopLoss: null,
          invalidationLevel: null,
          riskRewardRatio: null,
          potentialProfitPercent: { tp1: null, tp2: null, tp3: null },
          potentialLossPercent: null,
          confidenceScore: Math.min(45, Number(parsed.confidenceScore || 35)),
          supportLevels: [],
          resistanceLevels: [],
        };

  return {
    id: `aiv_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    symbol: resolvedPair || 'UNKNOWN',
    coinName: String(parsed.coinName || rec.coin || resolvedPair || 'Unknown'),
    timeframe: resolvedTf,
    analysisType: 'vision',
    verdict: needsUserConfirmation ? 'WAIT' : sanitized.verdict,
    verifiedPrice,
    dataSource: ticker ? 'Chart Screenshot + Binance Spot Verified' : 'Chart Screenshot Only (Unverified Live Price)',
    dataTimestamp,
    overallDirection: String(parsed.overallDirection || 'NEUTRAL'),
    trendStrength: String(parsed.trendStrength || 'UNCERTAIN'),
    technicalAnalysis: String(parsed.technicalAnalysis || rec.visualObservations || ''),
    supportLevels: sanitized.supportLevels,
    resistanceLevels: sanitized.resistanceLevels,
    entryZone: sanitized.entryZone,
    tp1: sanitized.tp1,
    tp2: sanitized.tp2,
    tp3: sanitized.tp3,
    stopLoss: sanitized.stopLoss,
    riskRewardRatio: sanitized.riskRewardRatio,
    potentialProfitPercent: sanitized.potentialProfitPercent,
    potentialLossPercent: sanitized.potentialLossPercent,
    bullishScenario: String(parsed.bullishScenario || ''),
    bearishScenario: String(parsed.bearishScenario || ''),
    invalidationLevel: sanitized.invalidationLevel,
    riskLevel: (parsed.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH') || 'HIGH',
    confidenceScore: sanitized.confidenceScore,
    confidenceExplanation: String(parsed.confidenceExplanation || ''),
    supportingReasons: Array.isArray(parsed.supportingReasons) ? parsed.supportingReasons.map(String) : [],
    opposingReasons: Array.isArray(parsed.opposingReasons) ? parsed.opposingReasons.map(String) : [],
    technicalReasons: Array.isArray(parsed.technicalReasons) ? parsed.technicalReasons.map(String) : [],
    limitationsAndUncertainty: String(parsed.limitationsAndUncertainty || ''),
    verifiedMarketFacts: Array.isArray(parsed.verifiedMarketFacts) ? parsed.verifiedMarketFacts.map(String) : [],
    aiInterpretations: Array.isArray(parsed.aiInterpretations) ? parsed.aiInterpretations.map(String) : [],
    needsUserConfirmation,
    recognizedChartInfo: {
      coin: rec.coin,
      pair: rec.pair,
      timeframe: rec.timeframe,
      confidence: rec.certainty,
    },
    createdAt: new Date().toISOString(),
  };
}
