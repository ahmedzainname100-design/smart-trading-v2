(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const config = window.SMART_TRADING_CONFIG || { apiConfigured: false };
  const state = { market: [], toastTimer: null, chartWidget: null };
  const ASSET_META = {
    'XAU/USD': { icon: 'Au', title: 'الذهب مقابل الدولار' },
    'XAG/USD': { icon: 'Ag', title: 'الفضة مقابل الدولار' },
    'EUR/USD': { icon: '€', title: 'اليورو مقابل الدولار' },
    'GBP/USD': { icon: '£', title: 'الإسترليني مقابل الدولار' },
    'USD/JPY': { icon: '¥', title: 'الدولار مقابل الين' },
    'BTC/USD': { icon: '₿', title: 'بيتكوين مقابل الدولار' }
  };

  function number(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function money(value, digits = 2) {
    if (!Number.isFinite(Number(value))) return '—';
    return '$' + number(value, digits);
  }
  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }
  function setNotice(message, hidden = false) {
    $('notice-text').textContent = message;
    $('data-notice').hidden = hidden;
  }
  function sparkline(seed, down = false) {
    let value = 12 + (seed % 7);
    const points = [];
    for (let i = 0; i < 12; i += 1) {
      value += Math.sin((i + seed) * 1.35) * 2.4 + (down ? -0.15 : 0.25);
      points.push(`${i * 7},${Math.max(3, Math.min(22, value))}`);
    }
    return `<svg class="mini-chart ${down ? 'down' : ''}" viewBox="0 0 77 25" aria-hidden="true"><polyline points="${points.join(' ')}"></polyline></svg>`;
  }
  function renderMarket(items) {
    const grid = $('market-grid');
    grid.replaceChildren();
    items.forEach((item, index) => {
      const meta = ASSET_META[item.symbol] || { icon: '•', title: item.name };
      const card = document.createElement('article');
      card.className = 'market-card';
      const priceText = Number.isFinite(Number(item.price)) ? number(item.price, item.symbol === 'EUR/USD' || item.symbol === 'GBP/USD' ? 5 : item.symbol === 'USD/JPY' || item.symbol === 'XAG/USD' ? 3 : 2) : 'غير متاح';
      const change = Number(item.change_percent);
      const changeClass = Number.isFinite(change) ? (change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral') : 'neutral';
      const changeText = Number.isFinite(change) ? `${change > 0 ? '+' : ''}${number(change, 2)}%` : '—';
      const isDemo = Boolean(item.demo);
      const statusText = isDemo ? 'بيانات توضيحية' : item.is_live ? 'تم التحديث' : item.error ? 'السعر غير متاح' : 'آخر بيانات متاحة';
      card.innerHTML = `
        <div class="market-card-top"><div class="asset-name"><span class="asset-icon">${meta.icon}</span><div><strong>${item.name}</strong><small>${item.symbol}</small></div></div><span class="asset-category">${item.category}</span></div>
        <div class="market-price-row"><strong class="market-price">${priceText}</strong><span class="market-change ${changeClass}">${changeText}</span></div>
        <div class="market-card-bottom"><span>${statusText}</span>${sparkline(index + 3, Number.isFinite(change) && change < 0)}</div>`;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `عرض شارت ${item.name}`);
      const openChart = () => selectChart(item.tv_symbol || 'OANDA:XAUUSD', item.symbol);
      card.addEventListener('click', openChart);
      card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openChart(); } });
      grid.appendChild(card);
    });
  }
  async function loadMarket() {
    $('refresh-market').disabled = true;
    $('refresh-market').textContent = 'جارٍ التحديث…';
    try {
      const response = await fetch('/api/market', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error('تعذر تحميل قائمة الأسواق');
      const data = await response.json();
      state.market = Array.isArray(data.items) ? data.items : [];
      renderMarket(state.market);
      const live = state.market.some((item) => item.is_live && Number.isFinite(Number(item.price)));
      $('connection-status').textContent = live ? 'بيانات سوق متصلة' : 'الأسعار الحية غير مفعلة';
      $('top-status').textContent = live ? 'بيانات سوق متصلة' : 'وضع العرض';
      if (live) setNotice('يتم عرض بيانات من مزود السوق. قد تختلف سرعة التحديث أو تأخر الأسعار حسب الرمز وباقة مزود البيانات.');
      else if (!config.apiConfigured) setNotice('وضع المعاينة: القيم الرقمية في بطاقات الأسواق توضيحية وليست أسعارًا حية. لتفعيل الأسعار الحية، أضف TWELVE_DATA_API_KEY في إعدادات الاستضافة. الشارت المضمن يأتي من TradingView.');
      else setNotice('مفتاح مزود البيانات مضبوط، لكن لم يصل سعر حي صالح لبعض الرموز. تحقق من صلاحية الرمز وحدود باقة API.');
      updateGoldCard(state.market.find((item) => item.symbol === 'XAU/USD'));
    } catch (error) {
      $('connection-status').textContent = 'تعذر الاتصال';
      $('top-status').textContent = 'تعذر تحديث البيانات';
      setNotice('تعذر الاتصال بخادم المنصة. حدّث الصفحة أو راجع سجل التطبيق.');
      showToast(error.message || 'حدث خطأ أثناء تحميل الأسواق');
    } finally {
      $('refresh-market').disabled = false;
      $('refresh-market').textContent = '↻ تحديث الأسعار';
    }
  }
  function updateGoldCard(item) {
    if (!item) return;
    $('gold-price').textContent = Number.isFinite(Number(item.price)) ? `$${number(item.price, 2)}` : 'غير متاح';
    const change = Number(item.change_percent);
    $('gold-change').textContent = Number.isFinite(change) ? `${change > 0 ? '▲ +' : change < 0 ? '▼ ' : ''}${number(change, 2)}% من الإغلاق السابق` : (item.error || 'لا تتوفر نسبة تغير');
    $('gold-change').className = `gold-change ${Number.isFinite(change) && change > 0 ? 'positive' : Number.isFinite(change) && change < 0 ? 'negative' : 'neutral'}`;
    $('gold-source').textContent = item.demo ? 'قيمة توضيحية' : (item.source || '—');
    $('gold-updated').textContent = item.updated_at ? String(item.updated_at) : item.demo ? 'غير متصل ببيانات حية' : '—';
    $('level-current').textContent = Number.isFinite(Number(item.price)) ? number(item.price, 2) : '—';
    ['pip-entry', 'risk-entry', 'pl-entry', 'rr-entry'].forEach((id) => { if ($(id) && !$(id).dataset.userEdited) $(id).value = Number.isFinite(Number(item.price)) ? item.price : $(id).value; });
    calculateAll();
  }
  function selectChart(tvSymbol, marketSymbol) {
    $('chart-symbol').value = tvSymbol;
    if (marketSymbol && ASSET_META[marketSymbol]) $('chart-title').textContent = ASSET_META[marketSymbol].title;
    else $('chart-title').textContent = tvSymbol;
    buildChart();
    $('chart-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function buildChart() {
    const symbol = $('chart-symbol').value || 'OANDA:XAUUSD';
    const interval = $('chart-interval').value || 'D';
    const container = $('tradingview-chart');
    container.replaceChildren();
    if (!window.TradingView || typeof window.TradingView.widget !== 'function') {
      const msg = document.createElement('div');
      msg.className = 'chart-placeholder';
      msg.textContent = 'تعذر تحميل الشارت من TradingView. تحقق من الاتصال بالإنترنت ثم أعد تحميل الصفحة.';
      container.appendChild(msg);
      return;
    }
    try {
      state.chartWidget = new window.TradingView.widget({
        autosize: true,
        symbol,
        interval,
        timezone: 'Asia/Dubai',
        theme: 'dark',
        style: '1',
        locale: 'ar_AE',
        enable_publishing: false,
        allow_symbol_change: true,
        hide_side_toolbar: false,
        withdateranges: true,
        details: true,
        hotlist: false,
        calendar: false,
        studies: ['RSI@tv-basicstudies', 'MACD@tv-basicstudies', 'MASimple@tv-basicstudies'],
        container_id: 'tradingview-chart',
        support_host: 'https://www.tradingview.com'
      });
    } catch (error) {
      console.error('TradingView widget failed:', error);
      container.innerHTML = '<div class="chart-placeholder">لم يتمكن الشارت من التحميل. جرّب تحديث الصفحة.</div>';
    }
  }
  function finiteInput(id) {
    const element = $(id);
    if (!element) return NaN;
    const value = Number(element.value);
    return element.value.trim() !== '' && Number.isFinite(value) ? value : NaN;
  }
  function calculatePips() {
    const entry = finiteInput('pip-entry');
    const exit = finiteInput('pip-exit');
    const size = finiteInput('pip-size');
    if (![entry, exit, size].every(Number.isFinite) || size <= 0) { $('pip-result').textContent = 'أدخل قيمًا صحيحة'; return; }
    const points = (exit - entry) / size;
    $('pip-result').textContent = `${number(points, 2)} نقطة`;
    $('pip-result').className = points > 0 ? 'positive' : points < 0 ? 'negative' : 'neutral';
  }
  function calculateRisk() {
    const balance = finiteInput('risk-balance');
    const percent = finiteInput('risk-percent');
    const entry = finiteInput('risk-entry');
    const stop = finiteInput('risk-stop');
    const perLot = finiteInput('risk-value');
    const riskCash = balance * percent / 100;
    $('risk-cash').textContent = Number.isFinite(riskCash) && riskCash >= 0 ? money(riskCash) : '—';
    const distance = Math.abs(entry - stop);
    const lots = distance > 0 && perLot > 0 ? riskCash / (distance * perLot) : NaN;
    $('risk-lots').textContent = Number.isFinite(lots) && lots >= 0 && Number.isFinite(percent) && percent <= 100 ? `${number(lots, 3)} لوت` : 'تحقق من المدخلات';
    $('risk-lots').className = Number.isFinite(lots) ? '' : 'negative';
  }
  function calculateProfitLoss() {
    const entry = finiteInput('pl-entry');
    const exit = finiteInput('pl-exit');
    const lots = finiteInput('pl-lots');
    const perLot = finiteInput('pl-value');
    if (![entry, exit, lots, perLot].every(Number.isFinite) || lots < 0 || perLot < 0) { $('pl-result').textContent = 'تحقق من المدخلات'; return; }
    const direction = $('pl-direction').value === 'sell' ? -1 : 1;
    const result = (exit - entry) * direction * lots * perLot;
    $('pl-result').textContent = `${result > 0 ? '+' : result < 0 ? '−' : ''}${money(Math.abs(result))}`;
    $('pl-result').className = result > 0 ? 'positive' : result < 0 ? 'negative' : 'neutral';
  }
  function calculateRR() {
    const entry = finiteInput('rr-entry');
    const stop = finiteInput('rr-stop');
    const target = finiteInput('rr-target');
    const direction = $('rr-direction').value === 'sell' ? -1 : 1;
    const risk = (entry - stop) * direction;
    const reward = (target - entry) * direction;
    if (![entry, stop, target].every(Number.isFinite) || risk <= 0 || reward <= 0) {
      $('rr-result').textContent = 'تحقق من الاتجاه والمستويات';
      $('rr-result').className = 'negative';
      $('rr-bar-fill').style.width = '0%';
      $('rr-note').textContent = 'للشراء: الوقف أسفل الدخول والهدف أعلاه. للبيع: العكس.';
      return;
    }
    const ratio = reward / risk;
    $('rr-result').textContent = `1 : ${number(ratio, 2)}`;
    $('rr-result').className = ratio >= 2 ? 'positive' : 'neutral';
    $('rr-bar-fill').style.width = `${Math.min(100, ratio / (ratio + 1) * 100)}%`;
    $('rr-note').textContent = `المخاطرة السعرية ${number(risk, 4)} مقابل عائد مستهدف ${number(reward, 4)}.`;
  }
  function calculateAll() { calculatePips(); calculateRisk(); calculateProfitLoss(); calculateRR(); }
  function bindCalculatorInputs() {
    ['pip-entry','pip-exit','pip-size','risk-balance','risk-percent','risk-entry','risk-stop','risk-value','pl-entry','pl-exit','pl-lots','pl-value','rr-entry','rr-stop','rr-target'].forEach((id) => {
      $(id).addEventListener('input', (event) => { event.currentTarget.dataset.userEdited = 'true'; calculateAll(); });
    });
    ['pl-direction','rr-direction'].forEach((id) => $(id).addEventListener('change', calculateAll));
  }
  async function loadTechnicalReadout() {
    if (!config.apiConfigured) return;
    try {
      const response = await fetch('/api/candles?symbol=XAU%2FUSD&interval=1day', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (!data.available || !Array.isArray(data.candles) || data.candles.length < 20) return;
      const closes = data.candles.map((c) => Number(c.close)).filter(Number.isFinite);
      const highs = data.candles.map((c) => Number(c.high)).filter(Number.isFinite);
      const lows = data.candles.map((c) => Number(c.low)).filter(Number.isFinite);
      const ema = (values, period) => {
        if (values.length < period) return NaN;
        const k = 2 / (period + 1);
        let result = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
        for (let i = period; i < values.length; i += 1) result = values[i] * k + result * (1 - k);
        return result;
      };
      const last = closes[closes.length - 1];
      const e20 = ema(closes, 20), e50 = ema(closes, 50);
      if (Number.isFinite(e20) && Number.isFinite(e50)) {
        $('trend-value').textContent = e20 > e50 ? 'ميل صاعد' : e20 < e50 ? 'ميل هابط' : 'محايد';
        $('trend-value').className = `signal-value ${e20 > e50 ? 'positive' : e20 < e50 ? 'negative' : 'neutral'}`;
      }
      const sample = closes.slice(-15);
      let gains = 0, losses = 0;
      for (let i = 1; i < sample.length; i += 1) { const d = sample[i] - sample[i - 1]; if (d > 0) gains += d; else losses += Math.abs(d); }
      const rsi = losses === 0 ? 100 : 100 - (100 / (1 + (gains / 14) / (losses / 14)));
      $('rsi-value').textContent = Number.isFinite(rsi) ? `${number(rsi, 1)} ${rsi >= 70 ? '(تشبع شراء)' : rsi <= 30 ? '(تشبع بيع)' : '(متوسط)'}` : '—';
      $('rsi-value').className = `signal-value ${rsi >= 70 ? 'negative' : rsi <= 30 ? 'positive' : 'neutral'}`;
      const e12 = ema(closes, 12), e26 = ema(closes, 26);
      $('momentum-value').textContent = Number.isFinite(e12) && Number.isFinite(e26) ? (e12 > e26 ? 'زخم إيجابي' : e12 < e26 ? 'زخم سلبي' : 'محايد') : 'غير متاح';
      $('momentum-value').className = `signal-value ${e12 > e26 ? 'positive' : e12 < e26 ? 'negative' : 'neutral'}`;
      const recentHigh = Math.max(...highs.slice(-20));
      const recentLow = Math.min(...lows.slice(-20));
      $('resistance-level').textContent = number(recentHigh, 2);
      $('support-level').textContent = number(recentLow, 2);
      $('level-current').textContent = number(last, 2);
      const range = recentHigh - recentLow;
      const position = range > 0 ? Math.max(0, Math.min(100, ((last - recentLow) / range) * 100)) : 50;
      document.querySelector('.current-marker').style.right = `${100 - position}%`;
      document.querySelector('.resistance-marker').style.right = '0%';
    } catch (error) {
      console.warn('Technical readout unavailable:', error);
    }
  }
  function finite(id) { return finiteInput(id); }
  function calculateFibonacci() {
    const high = finite('fib-high'), low = finite('fib-low');
    if (![high, low].every(Number.isFinite) || high <= low) { $('fib-236').textContent = 'تحقق من القمة والقاع'; $('fib-618').textContent = '—'; return; }
    const range = high - low;
    const up = $('fib-direction').value === 'up';
    const level = (ratio) => up ? high - range * ratio : low + range * ratio;
    $('fib-236').textContent = `${number(level(.236), 4)} / ${number(level(.382), 4)}`;
    $('fib-618').textContent = `${number(level(.5), 4)} / ${number(level(.618), 4)}`;
  }
  function calculateGann() {
    const base = finite('gann-base'), unit = finite('gann-unit'), bars = finite('gann-bars');
    if (![base, unit, bars].every(Number.isFinite) || unit <= 0 || bars < 1) { $('gann-result').textContent = 'تحقق من المدخلات'; return; }
    $('gann-result').textContent = number(base + ($('gann-direction').value === 'up' ? 1 : -1) * unit * bars, 4);
  }
  function calculateCycles() {
    const raw = $('cycle-date').value, days = finite('cycle-days'), count = finite('cycle-count');
    if (!raw || !Number.isFinite(days) || !Number.isFinite(count) || days < 1 || count < 1) { $('cycle-result').textContent = 'تحقق من المدخلات'; return; }
    const start = new Date(`${raw}T12:00:00`);
    const dates = [];
    for (let i = 1; i <= Math.min(24, Math.floor(count)); i += 1) {
      const d = new Date(start); d.setDate(d.getDate() + Math.floor(days) * i);
      dates.push(d.toLocaleDateString('en-CA'));
    }
    $('cycle-result').textContent = dates.join(' · ');
  }
  function calculatePivots() {
    const h = finite('pivot-high'), l = finite('pivot-low'), c = finite('pivot-close');
    if (![h, l, c].every(Number.isFinite) || h < l) { $('pivot-p').textContent = 'تحقق من H/L/C'; $('pivot-rs').textContent = '—'; return; }
    const p = (h + l + c) / 3, r1 = 2 * p - l, s1 = 2 * p - h;
    $('pivot-p').textContent = number(p, 4);
    $('pivot-rs').textContent = `${number(r1, 4)} / ${number(s1, 4)}`;
  }
  function bindExtendedTools() {
    ['fib-high','fib-low'].forEach(id => $(id).addEventListener('input', calculateFibonacci));
    $('fib-direction').addEventListener('change', calculateFibonacci);
    ['gann-base','gann-unit','gann-bars'].forEach(id => $(id).addEventListener('input', calculateGann));
    $('gann-direction').addEventListener('change', calculateGann);
    ['cycle-date','cycle-days','cycle-count'].forEach(id => $(id).addEventListener('input', calculateCycles));
    ['pivot-high','pivot-low','pivot-close'].forEach(id => $(id).addEventListener('input', calculatePivots));
    calculateFibonacci(); calculateGann(); calculateCycles(); calculatePivots();
  }

  function init() {
    $('current-date').textContent = new Intl.DateTimeFormat('ar-AE', { dateStyle: 'medium' }).format(new Date());
    bindCalculatorInputs();
    bindExtendedTools();
    calculateAll();
    loadMarket();
    loadTechnicalReadout();
    // Load chart after external script gets a chance to initialize.
    let attempts = 0;
    const waitForChart = setInterval(() => {
      attempts += 1;
      if (window.TradingView && typeof window.TradingView.widget === 'function') { clearInterval(waitForChart); buildChart(); }
      else if (attempts >= 20) { clearInterval(waitForChart); buildChart(); }
    }, 250);
    $('refresh-market').addEventListener('click', loadMarket);
    $('chart-symbol').addEventListener('change', () => {
      const symbol = $('chart-symbol').value;
      const option = $('chart-symbol').selectedOptions[0];
      $('chart-title').textContent = option ? option.textContent : symbol;
      buildChart();
    });
    $('chart-interval').addEventListener('change', buildChart);
    $('open-gold-chart').addEventListener('click', () => selectChart('OANDA:XAUUSD', 'XAU/USD'));
    $('notice-close').addEventListener('click', () => $('data-notice').hidden = true);
    $('menu-toggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
    document.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', () => $('sidebar').classList.remove('open')));
    // Refresh market prices conservatively to respect provider rate limits.
    setInterval(loadMarket, 60000);
    setInterval(loadTechnicalReadout, 300000);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
