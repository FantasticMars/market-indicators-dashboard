export const DEFAULT_INSTRUMENTS = [
  { symbol: "SPY", name: "S&P 500 ETF", role: "US large-cap trend", group: "risk", segment: "us" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", role: "Growth leadership", group: "risk", segment: "us" },
  { symbol: "IWM", name: "Russell 2000 ETF", role: "Small-cap breadth", group: "risk", segment: "us" },
  { symbol: "RSP", name: "S&P 500 Equal Weight ETF", role: "Market breadth", group: "breadth", segment: "us" },
  { symbol: "SPXA200R", name: "S&P 500 % above 200DMA", role: "Direct market breadth", group: "breadth", segment: "us" },
  { symbol: "HY_OAS", name: "ICE BofA US High Yield OAS", role: "Credit spread", group: "credit", segment: "us" },
  { symbol: "DGS10", name: "10Y Treasury yield", role: "Long-rate level", group: "rates", segment: "us" },
  { symbol: "T10Y2Y", name: "2s10s Treasury curve", role: "Curve slope", group: "rates", segment: "us" },
  { symbol: "VIX", name: "CBOE VIX", role: "Volatility level", group: "volatility", segment: "us" },
  { symbol: "VIX3M", name: "CBOE VIX3M", role: "Volatility term structure", group: "volatility", segment: "us" },
  { symbol: "VIX9D", name: "CBOE VIX9D", role: "Near-term volatility", group: "volatility", segment: "us" },
  { symbol: "SHCOMP", name: "Shanghai Composite", role: "A-share broad market", group: "china", segment: "china" },
  { symbol: "CSI300", name: "CSI 300", role: "A-share large caps", group: "china", segment: "china" },
  { symbol: "CN_M1_M2_GAP", name: "M1-M2 growth gap", role: "Money activation", group: "macro", segment: "china" },
  { symbol: "CN_CORP_MLT_LOAN_YOY", name: "Corporate mid/long loan YoY", role: "Credit impulse", group: "credit", segment: "china" },
  { symbol: "CN_HOUSEHOLD_NBFI_DEPOSIT_GAP", name: "Household vs NBFI deposit gap", role: "Deposit rotation", group: "funds", segment: "china" },
  { symbol: "CN_FX_SETTLEMENT_FLOW", name: "FX settlement surplus + CNY", role: "External flow", group: "external", segment: "china" },
  { symbol: "HSI", name: "Hang Seng Index", role: "Hong Kong market", group: "hk", segment: "hong_kong" },
  { symbol: "FXI", name: "China Large-Cap ETF", role: "Offshore China risk", group: "global", segment: "hong_kong" },
  { symbol: "KWEB", name: "China Internet ETF", role: "China growth proxy", group: "global", segment: "hong_kong" },
  { symbol: "BTC", name: "Bitcoin spot", role: "24/7 BTC spot risk", group: "crypto", segment: "crypto" },
];

export const EXPOSURE_BANDS = [
  { min: 75, range: "80-100%", label: "进攻", note: "趋势、信用、广度和波动结构同步健康。" },
  { min: 60, range: "60-80%", label: "偏积极", note: "主要风险资产占优，但仍需确认弱项。" },
  { min: 45, range: "40-60%", label: "中性", note: "市场分歧较大，仓位不宜自动加速。" },
  { min: 30, range: "20-40%", label: "防御", note: "多项信号走弱，优先控制回撤。" },
  { min: 0, range: "0-25%", label: "风险收缩", note: "趋势或波动结构明显恶化。" },
];

const SEGMENT_DEFINITIONS = [
  {
    id: "us",
    name: "美国",
    description: "美股趋势、市场广度、HY OAS 信用利差、真实利率曲线和 VIX 期限结构。",
    weight: 45,
    formula: "美国综合 = Σ(可用子指标分数 × 权重) / Σ(可用权重)；价格类输入使用 70% level + 30% 5D/20D ROC。",
  },
  {
    id: "china",
    name: "中国",
    description: "A 股、国内货币信用、资金搬家和外汇流的风险偏好。",
    weight: 22,
    formula: "中国综合 = Σ(可用子指标分数 × 权重) / Σ(可用权重)；宏观序列按自身历史分布评分。",
    observationNotes: [
      {
        title: "估值观察：10Y 国债收益率 + ERP",
        body: "10Y 国债收益率有 PBOC 中债国债收益统计表来源；ERP 还需要稳定、可自动验证的指数盈利收益率或 PE 数据源，当前不纳入分数。",
        sourceUrl: "https://www.pbc.gov.cn/diaochatongjisi/116219/116319/2026ntjsj/jrsctj/index.html",
      },
    ],
  },
  {
    id: "hong_kong",
    name: "香港 / 离岸中国",
    description: "港股、离岸中国 ETF 和中概成长代理的风险偏好。",
    weight: 13,
    formula: "香港 / 离岸中国综合 = Σ(可用子指标分数 × 权重) / Σ(可用权重)；价格类输入使用 70% level + 30% 5D/20D ROC。",
  },
  {
    id: "crypto",
    name: "加密货币 / BTC",
    description: "使用 24/7 BTC spot 观察加密风险偏好；IBIT 仅适合作为美股时段代理观察。",
    weight: 20,
    formula: "加密货币综合 = Σ(可用子指标分数 × 权重) / Σ(可用权重)；BTC spot 使用 70% level + 30% 5D/20D ROC。",
  },
];

export function buildMarketModel(quotesPayload, instruments = DEFAULT_INSTRUMENTS) {
  const quotes = new Map((quotesPayload.quotes || []).map((quote) => [quote.symbol, quote]));
  const components = instruments.map((instrument) => buildComponent(instrument, quotes.get(instrument.symbol), quotesPayload));
  const segments = buildSegments(components);
  const healthScore = weightedAverage(segments.filter((segment) => segment.score !== null));
  const activeBand = getExposureBand(healthScore);
  const successful = components.filter((component) => component.ok).length;
  const failed = components.filter((component) => !component.ok);
  const signals = segments.flatMap((segment) => segment.indicators);

  return {
    components,
    segments,
    signals,
    healthScore,
    activeBand,
    successful,
    failed,
    source: quotesPayload.source || "local proxy",
    timestamp: quotesPayload.timestamp || new Date().toISOString(),
    realtimeStatus: quotesPayload.realtime_status || "snapshot_or_delayed",
  };
}

export function buildHistoryPoint(model) {
  return {
    timestamp: model.timestamp,
    composite: model.healthScore,
    segments: Object.fromEntries(model.segments.map((segment) => [
      segment.id,
      {
        score: segment.score,
        trend: segment.trend.direction,
        confidence: segment.confidence,
      },
    ])),
  };
}

export function applyBandHysteresis(score, state = {}, options = {}) {
  const buffer = options.buffer ?? 3;
  const confirmations = options.confirmations ?? 2;
  const rawBand = getExposureBand(score);
  if (!rawBand) {
    return { activeBand: null, rawBand: null, pendingBand: null, pendingCount: 0 };
  }

  const activeBand = bandByRange(state.activeRange || state.activeBand?.range) || rawBand;
  if (activeBand.range === rawBand.range) {
    return {
      activeBand,
      rawBand,
      pendingBand: null,
      pendingCount: 0,
      activeRange: activeBand.range,
      pendingRange: null,
    };
  }

  if (!crossedBandBoundary(score, activeBand, rawBand, buffer)) {
    return {
      activeBand,
      rawBand,
      pendingBand: null,
      pendingCount: 0,
      activeRange: activeBand.range,
      pendingRange: null,
    };
  }

  const pendingCount = state.pendingRange === rawBand.range ? (state.pendingCount || 0) + 1 : 1;
  if (pendingCount >= confirmations) {
    return {
      activeBand: rawBand,
      rawBand,
      pendingBand: null,
      pendingCount: 0,
      activeRange: rawBand.range,
      pendingRange: null,
    };
  }

  return {
    activeBand,
    rawBand,
    pendingBand: rawBand,
    pendingCount,
    activeRange: activeBand.range,
    pendingRange: rawBand.range,
  };
}

function buildComponent(instrument, quote = {}, quotesPayload = {}) {
  const price = numberOrNull(quote.price);
  const previousClose = numberOrNull(quote.previous_close);
  const dayChangePct = numberOrNull(quote.day_change_pct) ?? (
    price && previousClose ? percentChange(price, previousClose) : null
  );
  const rangePosition = numberOrNull(quote.range_position);
  const metricDirection = quote.metric_direction || defaultMetricDirection(instrument.group);
  const metricBasis = quote.metric_basis || "price_range_plus_momentum";
  const history = normalizeHistory(quote.history);
  const roc5 = rateOfChange(history, 5);
  const roc20 = rateOfChange(history, 20);
  const slopeDirection = slopeFromHistory(history, metricDirection);
  const levelScore = directionalLevelScore(rangePosition, metricDirection);
  const momentum = momentumScore(roc5, roc20, slopeDirection, metricDirection);
  const trend = scoreTrend(levelScore, momentum, metricDirection, instrument.group, quote);

  return {
    ...instrument,
    name: quote.name || instrument.name,
    ok: Boolean(quote.ok),
    error: quote.error || null,
    market: quote.market || inferMarket(instrument.symbol),
    currency: quote.currency || "USD",
    price,
    previousClose,
    open: numberOrNull(quote.open),
    high: numberOrNull(quote.high),
    low: numberOrNull(quote.low),
    high52w: numberOrNull(quote.high_52w),
    low52w: numberOrNull(quote.low_52w),
    dayChangePct,
    rangePosition,
    levelScore,
    momentumScore: momentum,
    roc5,
    roc20,
    slopeDirection,
    trendDirection: trend.direction,
    trend,
    metricDirection,
    metricBasis,
    confidence: clamp(numberOrNull(quote.confidence) ?? 0.85, 0, 1),
    divergenceFlag: Boolean(quote.divergence_flag),
    secondarySource: quote.secondary_source || null,
    frequency: quote.frequency || defaultFrequency(instrument.symbol),
    asOfDate: quote.as_of_date || quote.quote_timestamp || quote.timestamp || null,
    proxyNote: quote.proxy_note || null,
    quoteTimestamp: quote.quote_timestamp || quote.timestamp || null,
    source: quote.source || quotesPayload.source || "unknown",
    sourceUrl: quote.source_url || quote.verify_url || "",
    realtimeStatus: quote.realtime_status || quotesPayload.realtime_status || "unknown",
    detail: quote.detail || null,
    history,
  };
}

function buildSegments(components) {
  const bySymbol = new Map(components.map((component) => [component.symbol, component]));

  const indicatorsBySegment = {
    us: [
      indicator({
        id: "us_equity_trend",
        name: "美股趋势",
        weight: 22,
        inputs: pick(bySymbol, ["SPY", "QQQ", "IWM"]),
        description: "用 SPY、QQQ、IWM 的 52 周位置和 5D/20D 平滑 ROC 衡量大盘、成长和小盘的趋势一致性。",
        formula: "平均(70% 52 周位置 + 30% 5D/20D ROC 与 slope)",
      }),
      dmaBreadthIndicator(bySymbol),
      breadthIndicator(bySymbol),
      indicator({
        id: "us_credit_spread",
        name: "HY OAS 信用利差",
        weight: 18,
        inputs: pick(bySymbol, ["HY_OAS"]),
        description: "ICE BofA US High Yield OAS 越高代表信用压力越大；20D 利差扩大是 long-only 降风险早期信号。",
        formula: "70% OAS 自身历史分位反向分 + 30% 20D 利差变化率反向分",
      }),
      rateIndicator(bySymbol),
      vixTermStructureIndicator(bySymbol),
    ],
    china: [
      indicator({
        id: "china_a_share",
        name: "A 股趋势",
        weight: 25,
        inputs: pick(bySymbol, ["SHCOMP", "CSI300"]),
        description: "上证综指和沪深 300 用来判断 A 股整体与大盘核心资产状态。",
        formula: "平均(70% 指数 52 周位置 + 30% 5D/20D ROC 与 slope)",
      }),
      indicator({
        id: "china_m1_m2_gap",
        name: "M1-M2 剪刀差",
        weight: 20,
        inputs: pick(bySymbol, ["CN_M1_M2_GAP"]),
        description: "比较 M1 同比和 M2 同比，判断钱是否从账面流动性转为交易性活钱。",
        formula: "M1-M2 剪刀差按自身历史分布评分，并用月度变化方向做 30% 动量层",
      }),
      indicator({
        id: "china_corporate_mlt_credit",
        name: "企业中长贷同比",
        weight: 20,
        inputs: pick(bySymbol, ["CN_CORP_MLT_LOAN_YOY"]),
        description: "企事业单位中长期贷款同比越强，越能说明宽信用进入企业资本开支和长期融资。",
        formula: "企业中长贷同比按自身历史分布评分，并用月度变化方向做 30% 动量层",
      }),
      indicator({
        id: "china_deposit_rotation",
        name: "居民 vs 非银存款剪刀差",
        weight: 15,
        inputs: pick(bySymbol, ["CN_HOUSEHOLD_NBFI_DEPOSIT_GAP"]),
        description: "比较非银存款月增量与住户存款月增量，观察居民资金是否搬入非银体系。",
        formula: "居民与非银存款剪刀差按自身历史分布评分，并用月度变化方向做 30% 动量层",
      }),
      indicator({
        id: "china_fx_flow",
        name: "结售汇顺差 + 汇率",
        weight: 20,
        inputs: pick(bySymbol, ["CN_FX_SETTLEMENT_FLOW"]),
        description: "用银行结售汇顺差和美元兑人民币期末汇率变化观察外部资金压力。",
        formula: "结售汇顺差按自身历史分布评分，并用月度变化方向做 30% 动量层",
      }),
    ],
    hong_kong: [
      indicator({
        id: "hk_market_trend",
        name: "港股趋势",
        weight: 35,
        inputs: pick(bySymbol, ["HSI"]),
        description: "用恒生指数的 52 周区间位置和 5D/20D ROC 判断香港本地市场趋势。",
        formula: "HSI 70% 52 周位置 + 30% 5D/20D ROC 与 slope",
      }),
      indicator({
        id: "hk_offshore_china_risk",
        name: "离岸中国风险偏好",
        weight: 35,
        inputs: pick(bySymbol, ["FXI", "KWEB"]),
        description: "FXI 和 KWEB 共同反映离岸中国大盘与成长资产的风险偏好。",
        formula: "平均(70% 52 周位置 + 30% 5D/20D ROC 与 slope)",
      }),
      indicator({
        id: "hk_offshore_consistency",
        name: "港股 / 中概一致性",
        weight: 30,
        inputs: pick(bySymbol, ["HSI", "FXI", "KWEB"]),
        description: "比较恒指、FXI、KWEB 是否同向修复或同向走弱，避免单一市场噪音。",
        formula: "平均分 - 分歧惩罚",
        scoreOverride: crossMarketConsistencyScore(pick(bySymbol, ["HSI", "FXI", "KWEB"])),
      }),
    ],
    crypto: [
      indicator({
        id: "btc_trend",
        name: "BTC spot 趋势",
        weight: 50,
        inputs: pick(bySymbol, ["BTC"]),
        description: "使用 24/7 BTC spot 观察加密风险偏好，不使用 IBIT 作为价格代理。",
        formula: "BTC spot 70% 52 周位置 + 30% 5D/20D ROC 与 slope",
      }),
      indicator({
        id: "btc_momentum",
        name: "BTC 平滑动量",
        weight: 30,
        inputs: pick(bySymbol, ["BTC"]),
        description: "用 BTC spot 的 5D/20D ROC 判断短期风险偏好是否改善。",
        formula: "5D ROC * 40% + 20D ROC * 60%，映射到 0-100",
        scoreOverride: bySymbol.get("BTC")?.momentumScore ?? null,
      }),
      indicator({
        id: "btc_drawdown_risk",
        name: "BTC 回撤压力",
        weight: 20,
        inputs: pick(bySymbol, ["BTC"]),
        description: "距离 52 周高位越远，回撤压力越高；用于避免只看短期动量。",
        formula: "BTC spot 52 周位置",
        scoreOverride: bySymbol.get("BTC")?.levelScore ?? null,
      }),
    ],
  };

  return SEGMENT_DEFINITIONS.map((definition) => {
    const indicators = indicatorsBySegment[definition.id] || [];
    const score = weightedAverage(indicators);
    const availableWeight = sumWeights(indicators.filter((item) => item.score !== null));
    const totalWeight = sumWeights(indicators);
    const trend = aggregateTrend(indicators);
    const confidence = aggregateConfidence(indicators);
    return {
      ...definition,
      score,
      status: scoreLabel(score),
      trend,
      confidence,
      indicators,
      availableWeight,
      totalWeight,
      observationNotes: definition.observationNotes || [],
    };
  });
}

function indicator({ id, name, weight, inputs, description, formula, scoreOverride = undefined }) {
  const usableInputs = inputs.filter((input) => input && input.ok);
  const score = scoreOverride === undefined
    ? average(usableInputs.map((input) => input.trend.score).filter(isFiniteNumber))
    : scoreOverride;
  const primary = usableInputs[0] || inputs[0] || {};
  const trend = aggregateComponentTrend(usableInputs);
  const confidence = usableInputs.length ? average(usableInputs.map((input) => input.confidence).filter(isFiniteNumber)) : 0;

  return {
    id,
    name,
    weight,
    score,
    status: scoreLabel(score),
    trend,
    confidence,
    description,
    formula,
    sourceName: primary.source || "unavailable",
    sourceUrl: primary.sourceUrl || "https://gu.qq.com/",
    observedAt: primary.asOfDate || primary.quoteTimestamp || primary.timestamp || null,
    realtimeStatus: primary.realtimeStatus || "unknown",
    frequency: primary.frequency || "unknown",
    inputs: inputs.map(formatInput),
  };
}

function dmaBreadthIndicator(bySymbol) {
  const breadth = bySymbol.get("SPXA200R");
  const directValue = numberOrNull(breadth?.price) ?? numberOrNull(breadth?.rangePosition);
  const score = breadth?.ok && isFiniteNumber(directValue) ? clamp(directValue, 0, 100) : null;

  return indicator({
    id: "us_pct_above_200dma",
    name: "% above 200DMA",
    weight: 20,
    inputs: pick(bySymbol, ["SPXA200R"]),
    description: "S&P 500 成分股中位于 200 日均线之上的比例；这是更直接的市场广度指标。",
    formula: "% above 200DMA 直接作为 0-100 分；无可用源时不参与美国综合分分母",
    scoreOverride: score,
  });
}

function breadthIndicator(bySymbol) {
  const rsp = bySymbol.get("RSP");
  const spy = bySymbol.get("SPY");
  let score = null;
  if (rsp?.ok && spy?.ok && isFiniteNumber(rsp.trend.score) && isFiniteNumber(spy.trend.score)) {
    const breadthSpread = (rsp.levelScore ?? 50) - (spy.levelScore ?? 50);
    const momentumSpread = (rsp.momentumScore ?? 50) - (spy.momentumScore ?? 50);
    score = clamp(average([rsp.trend.score, 50 + breadthSpread * 1.2 + momentumSpread * 0.5]), 0, 100);
  }

  return indicator({
    id: "us_market_breadth",
    name: "等权广度代理",
    weight: 13,
    inputs: pick(bySymbol, ["RSP", "SPY"]),
    description: "用等权 S&P 500 ETF 与市值加权 SPY 对比，判断上涨是否由少数权重股驱动。",
    formula: "RSP 自身 70% level + 30% ROC，并叠加 RSP-SPY level/ROC 扩散",
    scoreOverride: score,
  });
}

function rateIndicator(bySymbol) {
  const dgs10 = bySymbol.get("DGS10");
  const curve = bySymbol.get("T10Y2Y");
  let score = null;
  if (dgs10?.ok && curve?.ok) {
    score = weightedAverage([
      { score: dgs10.trend.score, weight: 45 },
      { score: curve.trend.score, weight: 55 },
    ]);
  }

  return indicator({
    id: "us_rate_expectations",
    name: "真实利率曲线",
    weight: 12,
    inputs: pick(bySymbol, ["DGS10", "T10Y2Y"]),
    description: "用 FRED 10Y yield 和 2s10s 曲线观察利率与曲线压力；不再用 TLT/SHY 价格代理。",
    formula: "DGS10 45% 反向压力分 + T10Y2Y 55% 曲线斜率分，均含 70% level + 30% 5D/20D ROC",
    scoreOverride: score,
  });
}

function vixTermStructureIndicator(bySymbol) {
  const vix = bySymbol.get("VIX");
  const vix3m = bySymbol.get("VIX3M");
  const vix9d = bySymbol.get("VIX9D");
  let score = null;
  if (vix?.ok && vix3m?.ok && isFiniteNumber(vix.price) && isFiniteNumber(vix3m.price) && vix3m.price !== 0) {
    const ratio = vix.price / vix3m.price;
    const calmScore = ratio <= 1
      ? 75 + (1 - ratio) * 50
      : 50 - (ratio - 1) * 100;
    const nearTermPenalty = vix9d?.ok && isFiniteNumber(vix9d.price) && vix.price
      ? Math.max(0, (vix9d.price / vix.price - 1.02) * 80)
      : 0;
    score = clamp(calmScore - nearTermPenalty, 0, 100);
  }

  return indicator({
    id: "us_vix_term_structure",
    name: "VIX 期限结构",
    weight: 15,
    inputs: pick(bySymbol, ["VIX", "VIX3M", "VIX9D"]),
    description: "VIX/VIX3M 小于 1 代表 contango 与风险平静；大于 1 代表 backwardation 与急性压力。",
    formula: "VIX/VIX3M ratio：contango(<1) 加分，backwardation(>1) 快速扣分；VIX9D/VIX 过高额外扣分",
    scoreOverride: score,
  });
}

function pick(bySymbol, symbols) {
  return symbols.map((symbol) => bySymbol.get(symbol)).filter(Boolean);
}

function formatInput(component) {
  return {
    symbol: component.symbol,
    name: component.name,
    market: component.market,
    price: component.price,
    currency: component.currency,
    dayChangePct: component.dayChangePct,
    rangePosition: component.rangePosition,
    levelScore: component.levelScore,
    momentumScore: component.momentumScore,
    roc5: component.roc5,
    roc20: component.roc20,
    trendDirection: component.trendDirection,
    metricDirection: component.metricDirection,
    metricBasis: component.metricBasis,
    frequency: component.frequency,
    asOfDate: component.asOfDate,
    confidence: component.confidence,
    divergenceFlag: component.divergenceFlag,
    secondarySource: component.secondarySource,
    high52w: component.high52w,
    low52w: component.low52w,
    sourceName: component.source,
    sourceUrl: component.sourceUrl || "https://gu.qq.com/",
    observedAt: component.asOfDate || component.quoteTimestamp,
    realtimeStatus: component.realtimeStatus,
    proxyNote: component.proxyNote,
    error: component.error,
    detail: component.detail,
  };
}

function crossMarketConsistencyScore(components) {
  const usable = components.filter((component) => component?.ok && isFiniteNumber(component.trend.score));
  if (!usable.length) return null;
  const scores = usable.map((component) => component.trend.score);
  const avg = average(scores);
  const dispersion = Math.max(...scores) - Math.min(...scores);
  return clamp(avg - dispersion * 0.25, 0, 100);
}

function scoreTrend(levelScore, momentum, metricDirection, group, quote) {
  if (!isFiniteNumber(levelScore)) {
    return { score: null, label: "数据不足", tone: "neutral", detail: "缺少可评分 level", direction: "flat" };
  }
  const score = isFiniteNumber(momentum) ? clamp(levelScore * 0.7 + momentum * 0.3, 0, 100) : clamp(levelScore, 0, 100);
  const direction = trendDirectionFromMomentum(momentum);
  const directionText = directionLabel(direction);

  if (group === "volatility" || metricDirection === "lower_is_better") {
    if (score >= 70) return { score, label: "压力低", tone: "good", detail: `${directionText}；低值更健康`, direction };
    if (score >= 45) return { score, label: "压力中性", tone: "neutral", detail: `${directionText}；低值更健康`, direction };
    return { score, label: "压力高", tone: "bad", detail: `${directionText}；低值更健康`, direction };
  }

  if (quote?.metric_basis === "historical_distribution") {
    if (score >= 70) return { score, label: "历史偏强", tone: "good", detail: `${directionText}；位于自身历史分布上沿`, direction };
    if (score >= 45) return { score, label: "历史中性", tone: "neutral", detail: `${directionText}；位于自身历史分布中段`, direction };
    return { score, label: "历史偏弱", tone: "bad", detail: `${directionText}；位于自身历史分布下沿`, direction };
  }

  if (score >= 75) return { score, label: "强势区", tone: "good", detail: `${directionText}；价格位于 52 周区间上沿`, direction };
  if (score >= 55) return { score, label: "偏强", tone: "good", detail: `${directionText}；价格高于区间中位`, direction };
  if (score >= 35) return { score, label: "中性", tone: "neutral", detail: `${directionText}；价格处于 52 周区间中段`, direction };
  return { score, label: "偏弱", tone: "bad", detail: `${directionText}；价格接近 52 周低位`, direction };
}

function directionalLevelScore(rangePosition, metricDirection) {
  if (!isFiniteNumber(rangePosition)) return null;
  const score = clamp(rangePosition, 0, 100);
  return metricDirection === "lower_is_better" ? 100 - score : score;
}

function momentumScore(roc5, roc20, slopeDirection, metricDirection) {
  const usable = [roc5, roc20].filter(isFiniteNumber);
  if (!usable.length) return null;
  const raw = isFiniteNumber(roc5) && isFiniteNumber(roc20) ? roc5 * 0.4 + roc20 * 0.6 : usable[0];
  const directional = metricDirection === "lower_is_better" ? -raw : raw;
  const slopeBonus = slopeDirection === "improving" ? 4 : slopeDirection === "deteriorating" ? -4 : 0;
  return clamp(50 + directional * 2 + slopeBonus, 0, 100);
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((point) => ({
      date: point.date || point.timestamp || point[0],
      value: numberOrNull(point.value ?? point.close ?? point.price ?? point[1]),
    }))
    .filter((point) => point.date && isFiniteNumber(point.value));
}

function rateOfChange(history, periods) {
  if (history.length < 2) return null;
  const latest = history[history.length - 1].value;
  const priorIndex = Math.max(0, history.length - 1 - periods);
  const prior = history[priorIndex].value;
  return percentChange(latest, prior);
}

function slopeFromHistory(history, metricDirection) {
  if (history.length < 3) return "flat";
  const recent = history.slice(-3).map((point) => point.value);
  const slope = recent[recent.length - 1] - recent[0];
  const adjusted = metricDirection === "lower_is_better" ? -slope : slope;
  if (adjusted > 0) return "improving";
  if (adjusted < 0) return "deteriorating";
  return "flat";
}

function trendDirectionFromMomentum(momentum) {
  if (!isFiniteNumber(momentum)) return "flat";
  if (momentum >= 55) return "improving";
  if (momentum <= 45) return "deteriorating";
  return "flat";
}

function aggregateComponentTrend(components) {
  const directions = components.map((component) => component.trendDirection);
  return trendObject(directionFromVotes(directions));
}

function aggregateTrend(indicators) {
  const directions = indicators
    .filter((indicator) => indicator.score !== null)
    .map((indicator) => indicator.trend.direction);
  return trendObject(directionFromVotes(directions));
}

function directionFromVotes(directions) {
  const score = directions.reduce((sum, direction) => {
    if (direction === "improving") return sum + 1;
    if (direction === "deteriorating") return sum - 1;
    return sum;
  }, 0);
  if (score > 0) return "improving";
  if (score < 0) return "deteriorating";
  return "flat";
}

function trendObject(direction) {
  return {
    direction,
    label: directionLabel(direction),
    symbol: direction === "improving" ? "↑" : direction === "deteriorating" ? "↓" : "→",
    tone: direction === "improving" ? "good" : direction === "deteriorating" ? "bad" : "neutral",
  };
}

function directionLabel(direction) {
  if (direction === "improving") return "改善";
  if (direction === "deteriorating") return "恶化";
  return "走平";
}

function aggregateConfidence(indicators) {
  const available = indicators.filter((indicator) => indicator.score !== null);
  if (!available.length) return 0;
  return clamp(average(available.map((indicator) => indicator.confidence).filter(isFiniteNumber)), 0, 1);
}

function scoreLabel(score) {
  if (!isFiniteNumber(score)) return { label: "无数据", tone: "neutral" };
  if (score >= 70) return { label: "健康", tone: "good" };
  if (score >= 45) return { label: "中性", tone: "neutral" };
  return { label: "压力", tone: "bad" };
}

function weightedAverage(items) {
  const usable = items.filter((item) => isFiniteNumber(item.score) && isFiniteNumber(item.weight));
  const totalWeight = usable.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return null;
  return usable.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
}

function sumWeights(items) {
  return items
    .filter((item) => isFiniteNumber(item.weight))
    .reduce((sum, item) => sum + item.weight, 0);
}

function average(values) {
  const usable = values.filter(isFiniteNumber);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function percentChange(current, prior) {
  if (!isFiniteNumber(current) || !isFiniteNumber(prior) || prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getExposureBand(score) {
  if (!isFiniteNumber(score)) return null;
  return EXPOSURE_BANDS.find((band) => score >= band.min) || EXPOSURE_BANDS[EXPOSURE_BANDS.length - 1];
}

function bandByRange(range) {
  return EXPOSURE_BANDS.find((band) => band.range === range) || null;
}

function crossedBandBoundary(score, activeBand, targetBand, buffer) {
  const activeIndex = EXPOSURE_BANDS.findIndex((band) => band.range === activeBand.range);
  const targetIndex = EXPOSURE_BANDS.findIndex((band) => band.range === targetBand.range);
  if (targetIndex < activeIndex) {
    return score >= targetBand.min + buffer;
  }
  return score <= activeBand.min - buffer;
}

function defaultMetricDirection(group) {
  return group === "volatility" ? "lower_is_better" : "higher_is_better";
}

function defaultFrequency(symbol) {
  if (symbol.startsWith("CN_")) return "monthly";
  if (symbol === "BTC") return "24/7 spot";
  return "daily";
}

function inferMarket(symbol) {
  if (["SHCOMP", "CSI300"].includes(symbol)) return "CN";
  if (symbol === "HSI") return "HK";
  if (symbol === "BTC") return "CRYPTO";
  if (symbol.startsWith("CN_")) return "CN";
  return "US";
}
