import { useState, useEffect, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Cell,
} from 'recharts';
import { credentialsReady, callMcpTool } from './api';
import './App.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawRow {
  'Reporting Date': number;
  'DR_ACC_L1.5': string;
  Amount: number;
}

interface CategoryTotal {
  name: string;
  amount: number;
  pct: number;
  color: string;
}

interface MonthlyRow {
  month: string;
  timestamp: number;
  amount: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABLE_ID = '16528';

const EXPENSE_CATEGORIES = new Set([
  'COGS', 'G&A', 'R&D', 'S&M', 'Finance expenses', 'Tax', 'Other', 'Intercompany',
]);

const CHART_COLORS = [
  '#4646CE', '#3b82f6', '#10b981', '#f97316',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b',
  '#06b6d4', '#84cc16',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const decodeHtml = (s: string): string => {
  const txt = document.createElement('textarea');
  txt.innerHTML = s;
  return txt.value;
};

const fmt = (n: number): string => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const fmtFull = (n: number): string =>
  '$' + n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const tsToMonthLabel = (ts: number): string => {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

const getYear = (ts: number): number => new Date(ts * 1000).getFullYear();

// ─── Mock data (fallback) ─────────────────────────────────────────────────────

function generateMockData(): RawRow[] {
  const categories = ['COGS', 'G&A', 'R&D', 'S&M', 'Finance expenses', 'Tax', 'Other'];
  const rows: RawRow[] = [];
  // Jan 2022 → Dec 2024
  for (let y = 2022; y <= 2024; y++) {
    for (let m = 0; m < 12; m++) {
      const date = new Date(y, m, 28);
      const ts = Math.floor(date.getTime() / 1000);
      categories.forEach((cat) => {
        const base: Record<string, number> = {
          COGS: 500_000, 'G&A': 350_000, 'R&D': 400_000, 'S&M': 300_000,
          'Finance expenses': 80_000, Tax: 120_000, Other: 60_000,
        };
        const amount = (base[cat] || 50_000) * (0.85 + Math.random() * 0.3);
        rows.push({ 'Reporting Date': ts, 'DR_ACC_L1.5': cat, Amount: amount });
      });
    }
  }
  return rows;
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="tooltip-label">{label}</div>
      {payload.map((p, i) => (
        <div className="tooltip-row" key={i}>
          <div className="tooltip-dot" style={{ background: p.color }} />
          <span className="tooltip-name">{p.name}</span>
          <span className="tooltip-value">{fmtFull(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [allRows, setAllRows] = useState<RawRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedYear, setSelectedYear] = useState<string>('All');
  const [drillCategory, setDrillCategory] = useState<string | null>(null);
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');

  // Fetch data
  useEffect(() => {
    async function load() {
      try {
        await credentialsReady;
        const raw = await callMcpTool('aggregate_table_data', {
          table_id: TABLE_ID,
          dimensions: ['Reporting Date', 'DR_ACC_L1.5'],
          metrics: [{ field: 'Amount', agg: 'SUM' }],
          filters: [
            { name: 'Scenario', values: ['Actuals'], is_excluded: false },
            { name: 'DR_ACC_L0', values: ['P&L'], is_excluded: false },
          ],
        }) as RawRow[];

        const decoded = raw.map((r) => ({
          ...r,
          'DR_ACC_L1.5': decodeHtml(r['DR_ACC_L1.5']),
        }));
        setAllRows(decoded);
      } catch {
        // Fall back to mock data
        setAllRows(generateMockData());
        setError('Using demo data (API unavailable)');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Available years
  const availableYears = [...new Set(allRows.map((r) => getYear(r['Reporting Date'])))].sort();

  // Filter rows by year
  const filteredRows = selectedYear === 'All'
    ? allRows
    : allRows.filter((r) => getYear(r['Reporting Date']) === parseInt(selectedYear));

  // Expense rows only
  const expenseRows = filteredRows.filter((r) => EXPENSE_CATEGORIES.has(r['DR_ACC_L1.5']));

  // Category totals
  const categoryMap = new Map<string, number>();
  expenseRows.forEach((r) => {
    categoryMap.set(r['DR_ACC_L1.5'], (categoryMap.get(r['DR_ACC_L1.5']) ?? 0) + r.Amount);
  });

  const totalExpenses = [...categoryMap.values()].reduce((a, b) => a + b, 0);

  const categoryTotals: CategoryTotal[] = [...categoryMap.entries()]
    .map(([name, amount], i) => ({
      name,
      amount,
      pct: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }))
    .sort((a, b) => b.amount - a.amount);

  // Month-over-month change (last 2 months of filtered data)
  const monthlyTotals = new Map<number, number>();
  expenseRows.forEach((r) => {
    monthlyTotals.set(r['Reporting Date'], (monthlyTotals.get(r['Reporting Date']) ?? 0) + r.Amount);
  });
  const sortedMonths = [...monthlyTotals.entries()].sort((a, b) => a[0] - b[0]);
  const lastMonthAmt = sortedMonths.at(-1)?.[1] ?? 0;
  const prevMonthAmt = sortedMonths.at(-2)?.[1] ?? 0;
  const momChange = prevMonthAmt > 0 ? ((lastMonthAmt - prevMonthAmt) / prevMonthAmt) * 100 : 0;
  const lastMonthLabel = sortedMonths.at(-1) ? tsToMonthLabel(sortedMonths.at(-1)![0]) : '—';

  // Largest category
  const largestCat = categoryTotals[0] ?? null;

  // Drilldown: monthly breakdown for selected category
  const drillRows: MonthlyRow[] = drillCategory
    ? expenseRows
        .filter((r) => r['DR_ACC_L1.5'] === drillCategory)
        .sort((a, b) => a['Reporting Date'] - b['Reporting Date'])
        .map((r) => ({
          month: tsToMonthLabel(r['Reporting Date']),
          timestamp: r['Reporting Date'],
          amount: r.Amount,
        }))
    : [];

  // Bar chart data for overview
  const overviewBarData = categoryTotals.map((c) => ({
    name: c.name,
    Amount: c.amount,
    color: c.color,
  }));

  const handleCategoryClick = useCallback((name: string) => {
    setDrillCategory(name);
    setChartType('bar');
  }, []);

  const handleBack = useCallback(() => {
    setDrillCategory(null);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  const drillColor = drillCategory
    ? (categoryTotals.find((c) => c.name === drillCategory)?.color ?? CHART_COLORS[0])
    : CHART_COLORS[0];

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <div className="header-left">
          <h1>Expenses Drilldown</h1>
          <p>Interactive breakdown of operating expenses</p>
        </div>
        <div className="header-controls">
          <select
            className="select-control"
            value={selectedYear}
            onChange={(e) => { setSelectedYear(e.target.value); setDrillCategory(null); }}
          >
            <option value="All">All Years</option>
            {availableYears.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      {!loading && (
        <div className="summary-cards fade-in">
          <div className="summary-card accent-blue">
            <div className="card-label">Total Expenses</div>
            <div className="card-value">{fmt(totalExpenses)}</div>
            <div className="card-sub">{selectedYear === 'All' ? 'All time' : selectedYear}</div>
          </div>
          <div className="summary-card accent-orange">
            <div className="card-label">Largest Category</div>
            <div className="card-value" style={{ fontSize: largestCat?.name && largestCat.name.length > 10 ? '1.1rem' : undefined }}>
              {largestCat?.name ?? '—'}
            </div>
            <div className="card-sub">{largestCat ? fmt(largestCat.amount) : ''}</div>
          </div>
          <div className="summary-card accent-green">
            <div className="card-label">Last Month</div>
            <div className="card-value">{fmt(lastMonthAmt)}</div>
            <div className="card-sub">{lastMonthLabel}</div>
          </div>
          <div className="summary-card accent-purple">
            <div className="card-label">Month-over-Month</div>
            <div className="card-value" style={{ color: momChange >= 0 ? '#ef4444' : '#10b981' }}>
              {momChange >= 0 ? '+' : ''}{momChange.toFixed(1)}%
            </div>
            <div className={`card-change ${momChange >= 0 ? 'negative' : 'positive'}`}>
              {momChange >= 0 ? '▲ Increased' : '▼ Decreased'}
            </div>
          </div>
        </div>
      )}

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <button
          className={`breadcrumb-item ${!drillCategory ? 'active' : ''}`}
          onClick={drillCategory ? handleBack : undefined}
        >
          All Expenses
        </button>
        {drillCategory && (
          <>
            <span className="breadcrumb-sep">›</span>
            <button className="breadcrumb-item active">{drillCategory}</button>
          </>
        )}
      </div>

      {/* Main Chart Panel */}
      <div className="chart-panel">
        {loading ? (
          <div className="loading-container">
            <div className="spinner" />
            <span>Loading financial data…</span>
          </div>
        ) : drillCategory ? (
          /* ── Drilldown View ── */
          <div className="fade-in">
            <div className="chart-panel-header">
              <div>
                <div className="chart-title">{drillCategory} — Monthly Breakdown</div>
                <div className="chart-subtitle">
                  {selectedYear === 'All' ? 'All available months' : selectedYear}
                  {' · '}{drillRows.length} data points
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="view-toggle">
                  <button className={`toggle-btn ${chartType === 'bar' ? 'active' : ''}`} onClick={() => setChartType('bar')}>Bar</button>
                  <button className={`toggle-btn ${chartType === 'line' ? 'active' : ''}`} onClick={() => setChartType('line')}>Line</button>
                </div>
                <button
                  onClick={handleBack}
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                    padding: '6px 14px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s',
                  }}
                >
                  ← Back
                </button>
              </div>
            </div>

            {drillRows.length === 0 ? (
              <div className="error-container">
                <div className="error-icon">📭</div>
                <div className="error-msg">No data for this category in the selected period.</div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                {chartType === 'bar' ? (
                  <BarChart data={drillRows} margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: '#8b90a7', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fill: '#8b90a7', fontSize: 11 }}
                      tickFormatter={fmt}
                      tickLine={false}
                      axisLine={false}
                      width={72}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="amount" name={drillCategory} fill={drillColor} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                ) : (
                  <LineChart data={drillRows} margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: '#8b90a7', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fill: '#8b90a7', fontSize: 11 }}
                      tickFormatter={fmt}
                      tickLine={false}
                      axisLine={false}
                      width={72}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="amount"
                      name={drillCategory}
                      stroke={drillColor}
                      strokeWidth={2.5}
                      dot={{ fill: drillColor, r: 3, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                )}
              </ResponsiveContainer>
            )}
          </div>
        ) : (
          /* ── Overview View ── */
          <div className="fade-in">
            <div className="chart-panel-header">
              <div>
                <div className="chart-title">Expenses by Category</div>
                <div className="chart-subtitle">
                  {selectedYear === 'All' ? 'All years combined' : selectedYear}
                  {' · '}{categoryTotals.length} categories
                </div>
                <div className="chart-hint">Click a bar or category card to drill down</div>
              </div>
            </div>

            {categoryTotals.length === 0 ? (
              <div className="error-container">
                <div className="error-icon">📊</div>
                <div className="error-msg">No expense data available for this period.</div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={overviewBarData}
                  layout="vertical"
                  margin={{ top: 4, right: 80, left: 8, bottom: 0 }}
                  onClick={(e: unknown) => {
                    const ev = e as { activePayload?: Array<{ payload: { name: string } }> } | null;
                    if (ev?.activePayload?.[0]) {
                      handleCategoryClick(ev.activePayload[0].payload.name);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: '#8b90a7', fontSize: 11 }}
                    tickFormatter={fmt}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    tick={{ fill: '#e8eaf0', fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Bar dataKey="Amount" radius={[0, 4, 4, 0]} maxBarSize={28}>
                    {overviewBarData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>

      {/* Category Cards (overview only) */}
      {!loading && !drillCategory && categoryTotals.length > 0 && (
        <div className="fade-in">
          <div className="category-grid-title">Click to explore</div>
          <div className="category-grid">
            {categoryTotals.map((cat, i) => (
              <div
                key={cat.name}
                className="category-card"
                style={{ '--cat-color': cat.color, animationDelay: `${i * 40}ms` } as React.CSSProperties}
                onClick={() => handleCategoryClick(cat.name)}
              >
                <div className="category-name">{cat.name}</div>
                <div className="category-amount">{fmt(cat.amount)}</div>
                <div className="category-pct">{cat.pct.toFixed(1)}% of total</div>
                <div className="category-bar-bg">
                  <div
                    className="category-bar-fill"
                    style={{ width: `${cat.pct}%`, background: cat.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error notice */}
      {error && (
        <div style={{ marginTop: 16, padding: '10px 16px', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 8, fontSize: '0.8rem', color: '#f97316' }}>
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
