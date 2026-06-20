const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ─── 行业分组 ───
const GROUPS = {
  baijiu: {
    name: '白酒',
    stocks: [
      { code: 'sh600519', name: '贵州茅台' },
      { code: 'sz000858', name: '五粮液' },
      { code: 'sz000568', name: '泸州老窖' },
      { code: 'sh600809', name: '山西汾酒' },
      { code: 'sz002304', name: '洋河股份' },
      { code: 'sh600702', name: '舍得酒业' },
      { code: 'sz000596', name: '古井贡酒' },
      { code: 'sh600779', name: '水井坊' },
    ]
  },
  bank: {
    name: '银行',
    stocks: [
      { code: 'sh600036', name: '招商银行' },
      { code: 'sh601398', name: '工商银行' },
      { code: 'sh601939', name: '建设银行' },
      { code: 'sh601288', name: '农业银行' },
      { code: 'sh600000', name: '浦发银行' },
      { code: 'sh601166', name: '兴业银行' },
      { code: 'sh600016', name: '民生银行' },
      { code: 'sh601328', name: '交通银行' },
    ]
  },
  internet: {
    name: '互联网',
    stocks: [
      { code: 'hk00700', name: '腾讯控股' },
      { code: 'hk09988', name: '阿里巴巴-W' },
      { code: 'usBIDU', name: '百度' },
      { code: 'usJD', name: '京东' },
      { code: 'usNTES', name: '网易' },
      { code: 'usPDD', name: '拼多多' },
      { code: 'usMEITUAN', name: '美团' },
      { code: 'usBABA', name: '阿里巴巴' },
    ]
  },
  newenergy: {
    name: '新能源',
    stocks: [
      { code: 'sz300750', name: '宁德时代' },
      { code: 'sz002594', name: '比亚迪' },
      { code: 'sh601012', name: '隆基绿能' },
      { code: 'sz300274', name: '阳光电源' },
      { code: 'sh600438', name: '通威股份' },
      { code: 'sh688981', name: '中芯国际' },
      { code: 'sz002129', name: '中环股份' },
      { code: 'sz300014', name: '亿纬锂能' },
    ]
  },
  appliance: {
    name: '家电',
    stocks: [
      { code: 'sz000333', name: '美的集团' },
      { code: 'sz000651', name: '格力电器' },
      { code: 'sh600690', name: '海尔智家' },
      { code: 'sz002032', name: '苏泊尔' },
      { code: 'sh603195', name: '公牛集团' },
      { code: 'sz000100', name: 'TCL科技' },
      { code: 'sz002242', name: '九阳股份' },
      { code: 'sh600839', name: '四川长虹' },
    ]
  }
};

// ─── 工具函数 ───
function runCmd(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) { reject(err); return; }
      resolve(stdout);
    });
  });
}

function parseTable(md) {
  const lines = md.split('\n').filter(l => l.trim() && !l.trim().startsWith('[') && !l.trim().startsWith('---'));
  if (lines.length < 2) return [];
  // lines[0] should now be the header row
  const headers = lines[0].split('|').map(h => h.trim()).filter(h => h);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('|').map(c => c.trim()).filter(c => c);
    if (cells.length === headers.length) {
      const row = {};
      headers.forEach((h, idx) => { row[h] = cells[idx]; });
      rows.push(row);
    }
  }
  return rows;
}

function normalizeCode(code) {
  if (code.startsWith('sh') || code.startsWith('sz') || code.startsWith('hk')) return code;
  if (code.startsWith('us')) return code;
  return code;
}

// ─── API: 列出行业分组 ───
app.get('/api/groups', (req, res) => {
  const list = Object.entries(GROUPS).map(([key, g]) => ({
    id: key, name: g.name, count: g.stocks.length
  }));
  res.json(list);
});

// ─── API: 搜索公司（在行业分组中搜索） ───
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ results: [] });

  const results = [];
  Object.entries(GROUPS).forEach(([gid, g]) => {
    g.stocks.forEach(s => {
      const match = s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q);
      if (match) {
        results.push({ code: s.code, name: s.name, group: gid, groupName: g.name });
      }
    });
  });
  res.json({ results });
});

// ─── API: 获取某行业的估值对比数据 ───
app.get('/api/compare', async (req, res) => {
  const groupId = req.query.group;
  const group = GROUPS[groupId];
  if (!group) return res.status(404).json({ error: '未找到该行业分组' });

  try {
    const codes = group.stocks.map(s => s.code).join(',');
    const names = {};
    group.stocks.forEach(s => { names[s.code] = s.name; });

    // 1. 获取利润表（近20期，确保覆盖5年年度数据）
    const lrbRaw = await runCmd(`npx -y westock-data-clawhub@1.0.4 finance ${codes} --type lrb --num 20`);
    const lrbRows = parseTable(lrbRaw);

    // 2. 获取资产负债表（近20期）
    const zcfzRaw = await runCmd(`npx -y westock-data-clawhub@1.0.4 finance ${codes} --type zcfz --num 20`);
    const zcfzRows = parseTable(zcfzRaw);

    // 3. 获取年度K线
    const klineRaw = await runCmd(`npx -y westock-data-clawhub@1.0.4 kline ${codes} --period year --limit 10`);
    const klineRows = parseTable(klineRaw);

    // 4. 获取注册股本（用于计算市值）
    const profileRaw = await runCmd(`npx -y westock-data-clawhub@1.0.4 profile ${codes}`);
    const profileRows = parseTable(profileRaw);
    const shares = {};
    profileRows.forEach(p => {
      const cap = parseFloat(p.regCapital) || 0;
      shares[p.code] = cap * 10000; // 万元 → 元
    });

    // 5. 组织数据
    // 按股票代码 + 年份 构建数据索引
    const dataByCode = {};
    group.stocks.forEach(s => { dataByCode[s.code] = {}; });

    // 利润表：提取每年净利润、营收（只取年报 = -12-31）
    lrbRows.forEach(row => {
      const code = row.symbol || row.SecuCode || '';
      if (!dataByCode[code]) return;
      const endDate = (row.EndDate || '');
      if (!endDate.endsWith('-12-31')) return;
      const year = parseInt(endDate.substring(0, 4));
      if (year < 2021 || year > 2025) return;
      if (!dataByCode[code][year]) dataByCode[code][year] = {};
      dataByCode[code][year].netProfit = parseFloat(row.NPParentCompanyOwners) || 0;
      dataByCode[code][year].revenue = parseFloat(row.OperatingRevenue) || parseFloat(row.TotalOperatingRevenue) || 0;
    });

    // 资产负债表：提取净资产（只取年报）
    zcfzRows.forEach(row => {
      const code = row.symbol || row.SecuCode || '';
      if (!dataByCode[code]) return;
      const endDate = (row.EndDate || '');
      if (!endDate.endsWith('-12-31')) return;
      const year = parseInt(endDate.substring(0, 4));
      if (year < 2021 || year > 2025) return;
      if (!dataByCode[code][year]) dataByCode[code][year] = {};
      dataByCode[code][year].equity = parseFloat(row.SEWithoutMI) || parseFloat(row.TotalShareholderEquity) || 0;
    });

    // K线：提取年末股价
    klineRows.forEach(row => {
      const code = row.symbol || row.exchange || '';
      // Try to determine code from the data
      // Actually kline output doesn't include the stock code in each row
      // We need to figure out which stock this row belongs to
    });

    // K线存在的问题：批量查询时可能无法区分每行属于哪只股票
    // 改用逐个查询的方式
    
    // 逐个查询K线以确定归属
    const priceByCode = {};
    for (const s of group.stocks) {
      try {
        const kr = await runCmd(`npx -y westock-data-clawhub@1.0.4 kline ${s.code} --period year --limit 6`);
        const kRows = parseTable(kr);
        kRows.forEach(row => {
          const date = (row.date || '').substring(0, 4);
          const year = parseInt(date);
          if (year >= 2021 && year <= 2025) {
            if (!priceByCode[s.code]) priceByCode[s.code] = {};
            priceByCode[s.code][year] = parseFloat(row.last) || 0;
          }
        });
      } catch(e) {
        // 跳过查询失败的
      }
    }

    // 6. 计算PE/PB/PS
    const result = [];
    group.stocks.forEach(s => {
      const years = [];
      for (let y = 2021; y <= 2025; y++) {
        const d = dataByCode[s.code] && dataByCode[s.code][y];
        const price = priceByCode[s.code] && priceByCode[s.code][y];
        const cap = shares[s.code] || 1;

        if (d && price) {
          const marketCap = price * cap;
          const pe = d.netProfit > 0 ? marketCap / d.netProfit : null;
          const pb = d.equity > 0 ? marketCap / d.equity : null;
          const ps = d.revenue > 0 ? marketCap / d.revenue : null;

          years.push({
            year: y,
            price: price,
            pe: pe ? Math.round(pe * 10) / 10 : null,
            pb: pb ? Math.round(pb * 10) / 10 : null,
            ps: ps ? Math.round(ps * 10) / 10 : null,
          });
        }
      }

      if (years.length > 0) {
        // 计算5年均值、当前值
        const validPE = years.filter(y => y.pe !== null).map(y => y.pe);
        const validPB = years.filter(y => y.pb !== null).map(y => y.pb);
        const validPS = years.filter(y => y.ps !== null).map(y => y.ps);

        const avg = (arr) => arr.length > 0 ? Math.round(arr.reduce((a,b) => a+b, 0) / arr.length * 10) / 10 : null;
        const pct = (val, hist) => {
          if (val === null || hist.length === 0) return null;
          const below = hist.filter(v => v < val).length;
          return Math.round(below / hist.length * 100);
        };

        const current = years[years.length - 1];
        result.push({
          code: s.code,
          name: s.name,
          currentPE: current.pe,
          currentPB: current.pb,
          currentPS: current.ps,
          avgPE: avg(validPE),
          avgPB: avg(validPB),
          avgPS: avg(validPS),
          pePercentile: pct(current.pe, validPE),
          pbPercentile: pct(current.pb, validPB),
          psPercentile: pct(current.ps, validPS),
          years: years,
        });
      }
    });

    // 按市值排序（用最新价格 * 股本）
    result.sort((a, b) => {
      const lastA = a.years.length > 0 ? (a.years[a.years.length-1].price || 0) * (shares[a.code] || 0) : 0;
      const lastB = b.years.length > 0 ? (b.years[b.years.length-1].price || 0) * (shares[b.code] || 0) : 0;
      return lastB - lastA;
    });

    res.json({
      group: group.name,
      count: result.length,
      data: result,
    });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: '数据获取失败: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`估值对比工具已启动: http://localhost:${PORT}`);
});
