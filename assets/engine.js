/* =====================================================================
   ロト6/ロト7 予測・仮説検証エンジン
   4法則（宝田／数学理論／占星術／Claude統計）を掛け合わせて
   数字別スコアと2口の買い目、根拠レポート用データを生成する。
   ※本エンジンの「％」は過去データ上のパターン出現頻度であり、
     実際の当選確率（全組み合わせ等確率）を変えるものではない。
   ===================================================================== */
(function (global) {
  "use strict";

  const GAME = {
    loto6: {
      label: "ロト6", nPick: 6, nMax: 43,
      sumRange: [100, 160], oddAllowed: [2, 3, 4], maxConsecPairs: 1,
      thirds: [[1, 14], [15, 28], [29, 43]],
      blocks: [[1, 14], [15, 28], [29, 43]], blockQuota: [2, 2, 2],
      center: [21, 22], mirror: n => 44 - n,
      drawDays: [1, 4], // 月・木
      jackpotOdds: "1/6,096,454",
    },
    loto7: {
      label: "ロト7", nPick: 7, nMax: 37,
      sumRange: [105, 165], oddAllowed: [3, 4], maxConsecPairs: 2,
      thirds: [[1, 12], [13, 24], [25, 37]],
      blocks: [[1, 10], [11, 20], [21, 30], [31, 37]], blockQuota: [2, 2, 2, 1],
      center: [19], mirror: n => 38 - n,
      drawDays: [5], // 金
      jackpotOdds: "1/10,295,472",
    },
  };

  const WEIGHTS = { takarada: 0.30, math: 0.30, astro: 0.15, claude: 0.25 };
  const LAW_LABEL = {
    takarada: "宝田法則", math: "数学理論", astro: "占星術", claude: "Claude統計則",
  };

  /* ---------------- CSV 解析 ---------------- */
  function parseCSVText(text) {
    const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
    const header = lines[0].split(",");
    const game = header.some(h => h.trim() === "第7数字") ? "loto7" : "loto6";
    const cfg = GAME[game];
    const idx = {};
    header.forEach((h, i) => (idx[h.trim()] = i));
    if (!("開催回" in idx) || !("第1数字" in idx)) {
      throw new Error("CSVヘッダに「開催回」「第1数字」が見つかりません。みずほ銀行形式のCSVをご利用ください。");
    }
    const draws = [];
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(",");
      if (c.length < cfg.nPick + 2) continue;
      const nums = [];
      for (let k = 1; k <= cfg.nPick; k++) nums.push(parseInt(c[idx["第" + k + "数字"]], 10));
      if (nums.some(n => !(n >= 1 && n <= cfg.nMax))) continue;
      draws.push({
        round: parseInt(c[idx["開催回"]], 10),
        date: parseJDate(c[idx["日付"]]),
        numbers: nums.slice().sort((a, b) => a - b),
      });
    }
    draws.sort((a, b) => a.round - b.round);
    if (draws.length < 40) throw new Error("有効な抽選データが40回分未満です。CSVの内容をご確認ください。");
    return { game, draws };
  }

  function parseJDate(s) {
    const m = String(s).trim().match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  /* ---------------- 基礎統計 ---------------- */
  function baseStats(draws, game) {
    const cfg = GAME[game], nMax = cfg.nMax;
    const freq = {}, skip = {};
    for (let n = 1; n <= nMax; n++) { freq[n] = 0; skip[n] = draws.length; }
    draws.forEach((d, i) => d.numbers.forEach(n => { freq[n]++; skip[n] = draws.length - 1 - i; }));
    const last = draws[draws.length - 1];
    const recent5 = new Set(), recent10Count = {}, recent30 = new Set();
    for (let n = 1; n <= nMax; n++) recent10Count[n] = 0;
    draws.slice(-5).forEach(d => d.numbers.forEach(n => recent5.add(n)));
    draws.slice(-10).forEach(d => d.numbers.forEach(n => recent10Count[n]++));
    draws.slice(-30).forEach(d => d.numbers.forEach(n => recent30.add(n)));
    const sums = draws.map(d => d.numbers.reduce((a, b) => a + b, 0));
    return { freq, skip, last, recent5, recent10Count, recent30, sums };
  }

  /* ---------------- 構成型の実測率（C-1） ---------------- */
  function structuralRates(draws, game) {
    const cfg = GAME[game];
    const N = draws.length;
    let inSum = 0, hasConsec = 0, carry = 0, oddOk = 0;
    const oddDist = {};
    draws.forEach((d, i) => {
      const s = sum(d.numbers);
      if (s >= cfg.sumRange[0] && s <= cfg.sumRange[1]) inSum++;
      if (consecPairs(d.numbers) >= 1) hasConsec++;
      const odd = d.numbers.filter(n => n % 2).length;
      oddDist[odd] = (oddDist[odd] || 0) + 1;
      if (cfg.oddAllowed.includes(odd)) oddOk++;
      if (i > 0 && d.numbers.some(n => draws[i - 1].numbers.includes(n))) carry++;
    });
    return {
      sumRangePct: pct(inSum, N), consecPct: pct(hasConsec, N),
      carryPct: pct(carry, N - 1), oddOkPct: pct(oddOk, N), oddDist, total: N,
    };
  }

  function consecPairs(sorted) {
    let c = 0;
    for (let i = 0; i < sorted.length - 1; i++) if (sorted[i + 1] - sorted[i] === 1) c++;
    return c;
  }
  const pct = (a, b) => Math.round((a / b) * 1000) / 10;

  /* =====================================================================
     法則エンジン群：各エンジンは {scores, notes, tags} を返す。
  ===================================================================== */

  /* ---- ① 宝田法則 ---- */
  function scoreTakarada(draws, game) {
    const cfg = GAME[game], st = baseStats(draws, game);
    const s = zeros(cfg.nMax), tags = {}, notes = [];
    const tag = (n, t) => (tags[n] = tags[n] || []).push(t);

    st.last.numbers.forEach(n => { s[n] += 0.30; tag(n, "引っ張り軸法"); });
    notes.push("引っ張り軸候補＝前回第" + st.last.round + "回の当選数字 [" + st.last.numbers.join(", ") + "]");
    if (game === "loto7") {
      const hot = keysOf(st.recent10Count, n => st.recent10Count[n] >= 2);
      hot.forEach(n => { s[n] += 0.25; tag(n, "ホット数字法"); });
      notes.push("ホット数字（直近10回で2回以上出現）: [" + hot.join(", ") + "]");
    }
    const cold = range(1, cfg.nMax).filter(n => !st.recent30.has(n));
    cold.forEach(n => { s[n] += 0.22; tag(n, "コールド復活法"); });
    notes.push("コールドナンバー（直近30回未出現）: [" + (cold.length ? cold.join(", ") : "なし") + "]");
    const gaps = st.last.numbers.slice(1).map((n, i) => n - st.last.numbers[i]);
    let cur = st.last.numbers[0] + 1;
    const slide = [cur];
    gaps.forEach(g => { cur += g; if (cur <= cfg.nMax) slide.push(cur); });
    slide.forEach(n => { if (n >= 1 && n <= cfg.nMax) { s[n] += 0.18; tag(n, "スライドギャップ法"); } });
    notes.push("スライドギャップ候補（前回差分[" + gaps.join(",") + "]を+1起点で再現）: [" + slide.join(", ") + "]");
    cfg.center.forEach(n => { s[n] += 0.15; tag(n, game === "loto6" ? "中央21/22軸法" : "中央値固定法"); });
    if (game === "loto7") {
      for (let n = 10; n <= 19; n++) { s[n] += 0.10; tag(n, "十台ピボット法"); }
      notes.push("十台ピボット法：10〜19の黄金ゾーンへ加点");
    }
    range(1, 9).forEach(n => { s[n] += 0.05; });
    range(cfg.nMax - 3, cfg.nMax).forEach(n => { s[n] += 0.05; });
    return { scores: normalize(s), notes: notes, tags: tags };
  }

  /* ---- ② 数学理論（Gail Howard系） ---- */
  function scoreMath(draws, game) {
    const cfg = GAME[game], st = baseStats(draws, game);
    const s = zeros(cfg.nMax), tags = {}, notes = [];
    const tag = (n, t) => (tags[n] = tags[n] || []).push(t);
    let core = 0;
    for (let n = 1; n <= cfg.nMax; n++) {
      if (st.skip[n] <= 5) { s[n] += 0.45 * (1 - st.skip[n] / 6); tag(n, "M-6出現間隔則"); core++; }
      else if (st.skip[n] >= 12) { s[n] += 0.05; }
    }
    notes.push("M-6：スキップ5回以内の中核候補 " + core + "個（Gail Howard「当選数字の約半数は直近5回以内から出る」）");
    const theo = game === "loto6" ? 61.9 : 80.2;
    notes.push("M-5：前回数字が1個以上再出現する理論確率 " + theo + "%（実測もほぼ一致）→ 引っ張り1〜2個構成を採用");
    st.last.numbers.forEach(n => { s[n] += 0.12; tag(n, "M-5引っ張り則"); });
    notes.push("M-1/M-3/M-4/M-7/M-8：奇偶" + cfg.oddAllowed.join("・") + "構成／合計" + cfg.sumRange[0] + "〜" + cfg.sumRange[1] + "／連番≦" + cfg.maxConsecPairs + "組／グループ欠落≦1／同末尾≦2 を買い目フィルタとして強制適用");
    return { scores: normalize(s), notes: notes, tags: tags };
  }

  /* ---- ③ 占星術（決定論計算＋バックテスト） ---- */
  function scoreAstro(draws, game, drawDate) {
    const cfg = GAME[game], st = baseStats(draws, game);
    const s = zeros(cfg.nMax), tags = {}, notes = [];
    const tag = (n, t) => (tags[n] = tags[n] || []).push(t);
    const astro = astroContext(drawDate);
    const zoneIdx = { "新月期": 0, "上弦期": 1, "満月期": 2, "下弦期": -1 }[astro.phase];
    if (zoneIdx >= 0) {
      const lo = cfg.thirds[zoneIdx][0], hi = cfg.thirds[zoneIdx][1];
      for (let n = lo; n <= hi; n++) { s[n] += 0.30; tag(n, "A-1月相(" + astro.phase + ")"); }
      notes.push("A-1：抽選日の月齢" + astro.moonAge.toFixed(1) + "＝" + astro.phase + " → " + lo + "〜" + hi + "帯を強調");
    } else {
      range(1, cfg.nMax).filter(n => !st.recent30.has(n)).forEach(n => { s[n] += 0.30; tag(n, "A-1月相(下弦期)"); });
      notes.push("A-1：月齢" + astro.moonAge.toFixed(1) + "＝下弦期 → コールド数字の復活を強調");
    }
    if (astro.mercuryRetro) {
      keysOf(st.recent10Count, n => st.recent10Count[n] >= 2)
        .forEach(n => { s[n] += 0.25; tag(n, "A-2水星逆行"); });
      notes.push("A-2：抽選日は水星逆行期間中（近似暦） → 直近10回のホット数字の“反復”に加点");
    } else {
      range(1, cfg.nMax).filter(n => st.recent10Count[n] === 0)
        .forEach(n => { s[n] += 0.10; tag(n, "A-2水星順行"); });
      notes.push("A-2：水星順行中 → 直近10回未出現の“新規数字”へ微加点");
    }
    const rulerTails = { 0: [1], 1: [2, 7], 2: [9], 3: [5], 4: [3], 5: [6], 6: [8, 4] }[astro.weekday] || [];
    rulerTails.forEach(t => range(1, cfg.nMax).filter(n => n % 10 === t)
      .forEach(n => { s[n] += 0.15; tag(n, "A-3支配星(末尾" + t + ")"); }));
    notes.push("A-3：抽選日は" + "日月火水木金土"[astro.weekday] + "曜（支配星対応末尾 " + rulerTails.join("・") + "）の数字へ加点");
    if (astro.element === "火") { range(1, cfg.nMax).filter(n => n % 2).forEach(n => { s[n] += 0.08; tag(n, "A-4火(奇数)"); }); }
    if (astro.element === "地") { range(1, cfg.nMax).filter(n => n % 2 === 0).forEach(n => { s[n] += 0.08; tag(n, "A-4地(偶数)"); }); }
    notes.push("A-4：太陽は" + astro.sign + "（" + astro.element + "のエレメント）" + (astro.element === "風" ? "→ 末尾分散型を優先" : astro.element === "水" ? "→ 連番採用を優先" : ""));
    const bt = backtestMoonZone(draws, game);
    notes.push("A-1バックテスト：過去" + bt.total + "回で強調ゾーンからの出現は実測" + bt.measured + "%（偶然の期待値" + bt.expected + "%）→ " + (Math.abs(bt.measured - bt.expected) < 2 ? "有意差なし（偶然と同等。エンタメ指標として使用）" : "期待値との差 " + (bt.measured - bt.expected).toFixed(1) + "pt"));
    return { scores: normalize(s), notes: notes, tags: tags, astro: astro, backtest: bt };
  }

  function backtestMoonZone(draws, game) {
    const cfg = GAME[game];
    let hit = 0, tot = 0, expAcc = 0;
    draws.forEach(d => {
      if (!d.date) return;
      const phase = phaseName(moonAge(d.date));
      const zi = { "新月期": 0, "上弦期": 1, "満月期": 2 }[phase];
      if (zi === undefined) return;
      const lo = cfg.thirds[zi][0], hi = cfg.thirds[zi][1];
      d.numbers.forEach(n => { tot++; if (n >= lo && n <= hi) hit++; });
      expAcc += (hi - lo + 1) / cfg.nMax * cfg.nPick;
    });
    return { measured: pct(hit, tot), expected: pct(expAcc, tot), total: draws.length };
  }

  /* ---- ④ Claude統計則 ---- */
  function scoreClaude(draws, game) {
    const cfg = GAME[game], st = baseStats(draws, game);
    const s = zeros(cfg.nMax), tags = {}, notes = [];
    const tag = (n, t) => (tags[n] = tags[n] || []).push(t);
    const sr = structuralRates(draws, game);
    st.recent5.forEach(n => { s[n] += 0.30; tag(n, "C-2直近5回プール"); });
    notes.push("C-2：当選数字の約" + (game === "loto6" ? "53" : "65") + "%は直近5回プール（現在" + st.recent5.size + "個）から出る実測構成比 → プール内外を約半々に配分");
    const lastTails = new Set(st.last.numbers.map(n => n % 10));
    range(1, cfg.nMax).filter(n => lastTails.has(n % 10))
      .forEach(n => { s[n] += 0.18; tag(n, "C-3末尾遷移"); });
    notes.push("C-3：前回末尾集合 {" + [...lastTails].sort().join(",") + "} と同末尾の数字へ加点（実測遷移率 " + (game === "loto6" ? "49.0" : "56.6") + "%）");
    const adj = new Set();
    st.last.numbers.forEach(n => { adj.add(n - 1); adj.add(n + 1); });
    st.last.numbers.forEach(n => adj.delete(n));
    [...adj].filter(n => n >= 1 && n <= cfg.nMax)
      .forEach(n => { s[n] += 0.15; tag(n, "C-4隣接スライド"); });
    const avg = draws.length * cfg.nPick / cfg.nMax;
    for (let n = 1; n <= cfg.nMax; n++) s[n] += 0.03 * (st.freq[n] - avg) / avg;
    notes.push("C-5：全期間頻度の残差はタイブレークのみに使用（カイ二乗検定で偏りは有意でないため）");
    notes.push("C-1：構成型の実測率 ─ 合計レンジ内" + sr.sumRangePct + "%／連番含有" + sr.consecPct + "%／引っ張り" + sr.carryPct + "%／奇偶適正" + sr.oddOkPct + "% → 買い目をこの多数派の型に一致させる");
    notes.push("C-6：スキップ回数別の出現率はフラット。「そろそろ出る」バイアスはスコアから排除済み");
    return { scores: normalize(s), notes: notes, tags: tags, structural: sr };
  }

  /* =====================================================================
     買い目構築（数学フィルタ全通過を保証する貪欲＋修復方式）
  ===================================================================== */
  function buildTicket(combined, draws, game, opts) {
    const cfg = GAME[game];
    const exclude = opts.exclude || new Set();
    const order = range(1, cfg.nMax)
      .filter(n => !exclude.has(n))
      .sort((a, b) => combined[b] - combined[a]);

    let pick;
    if (opts.strategy === "zone") {
      pick = [];
      cfg.blocks.forEach((blk, bi) => {
        const cands = order.filter(n => n >= blk[0] && n <= blk[1] && !pick.includes(n));
        pick = pick.concat(cands.slice(0, cfg.blockQuota[bi]));
      });
      pick = pick.slice(0, cfg.nPick);
      let i = 0;
      while (pick.length < cfg.nPick && i < order.length) {
        if (!pick.includes(order[i])) pick.push(order[i]);
        i++;
      }
    } else {
      pick = [];
      for (const n of order) {
        if (pick.length >= cfg.nPick) break;
        const trial = pick.concat([n]).sort((a, b) => a - b);
        if (tailMax(trial) > 2) continue;
        if (consecPairs(trial) > cfg.maxConsecPairs) continue;
        pick.push(n);
      }
    }
    pick.sort((a, b) => a - b);
    return repair(pick, combined, draws, game, exclude);
  }

  function repair(pick, combined, draws, game, exclude) {
    const cfg = GAME[game], st = baseStats(draws, game);
    const pool = range(1, cfg.nMax).filter(n => !exclude.has(n));
    const ok = p => {
      const s = sum(p), odd = p.filter(n => n % 2).length;
      const carry = p.filter(n => st.last.numbers.includes(n)).length;
      return s >= cfg.sumRange[0] && s <= cfg.sumRange[1] &&
        cfg.oddAllowed.includes(odd) &&
        consecPairs(p) <= cfg.maxConsecPairs &&
        tailMax(p) <= 2 &&
        missingBlocks(p, cfg) <= 1 &&
        carry >= 1 && carry <= 2;
    };
    for (let iter = 0; iter < 200 && !ok(pick); iter++) {
      let best = null, bestScore = repairScore(pick, cfg, st) - 0.001;
      for (let i = 0; i < pick.length; i++) {
        for (const c of pool) {
          if (pick.includes(c)) continue;
          const trial = pick.slice(); trial[i] = c; trial.sort((a, b) => a - b);
          const score = repairScore(trial, cfg, st) + combined[c] * 0.5;
          if (score > bestScore) { bestScore = score; best = trial; }
        }
      }
      if (!best) break;
      pick = best;
    }
    return pick.sort((a, b) => a - b);
  }

  function repairScore(p, cfg, st) {
    let sc = 0;
    const s = sum(p), odd = p.filter(n => n % 2).length;
    if (s >= cfg.sumRange[0] && s <= cfg.sumRange[1]) sc += 10;
    else sc -= Math.min(Math.abs(s - cfg.sumRange[0]), Math.abs(s - cfg.sumRange[1])) / 5;
    if (cfg.oddAllowed.includes(odd)) sc += 6;
    if (consecPairs(p) <= cfg.maxConsecPairs) sc += 4; else sc -= 4;
    if (tailMax(p) <= 2) sc += 3; else sc -= 3;
    if (missingBlocks(p, cfg) <= 1) sc += 3; else sc -= 3;
    const carry = p.filter(n => st.last.numbers.includes(n)).length;
    if (carry >= 1 && carry <= 2) sc += 5;
    else if (carry === 0) sc -= 3;
    else sc -= (carry - 2) * 6; // 引っ張り過多は段階的に強く減点
    return sc;
  }

  function missingBlocks(p, cfg) {
    return cfg.blocks.filter(blk => !p.some(n => n >= blk[0] && n <= blk[1])).length;
  }
  function tailMax(p) {
    const c = {};
    p.forEach(n => (c[n % 10] = (c[n % 10] || 0) + 1));
    return Math.max.apply(null, Object.values(c));
  }

  /* ---------------- 買い目の根拠計算 ---------------- */
  function ticketEvidence(pick, draws, game, layers, combined) {
    const cfg = GAME[game], st = baseStats(draws, game);
    const perNumber = pick.map(n => {
      const laws = [];
      Object.keys(layers).forEach(k => {
        (layers[k].tags[n] || []).forEach(t => laws.push({ engine: k, tag: t }));
      });
      return { n: n, index: Math.round(combined[n] * 100), laws: laws };
    });
    const s = sum(pick), odd = pick.filter(n => n % 2).length;
    const cp = consecPairs(pick);
    const carry = pick.filter(n => st.last.numbers.includes(n)).length;
    let match = 0, N = 0;
    draws.forEach((d, i) => {
      if (i === 0) return;
      N++;
      const ds = sum(d.numbers), dodd = d.numbers.filter(n => n % 2).length;
      const dcp = consecPairs(d.numbers);
      const dcarry = d.numbers.filter(n => draws[i - 1].numbers.includes(n)).length;
      const sumOk = ds >= cfg.sumRange[0] && ds <= cfg.sumRange[1];
      const mySumOk = s >= cfg.sumRange[0] && s <= cfg.sumRange[1];
      if (sumOk === mySumOk && dodd === odd && (dcp >= 1) === (cp >= 1) && (dcarry >= 1) === (carry >= 1)) match++;
    });
    return {
      perNumber: perNumber, sum: s, odd: odd, even: pick.length - odd,
      consecPairs: cp, carry: carry, patternPct: pct(match, N),
      inSumRange: s >= cfg.sumRange[0] && s <= cfg.sumRange[1],
    };
  }

  /* ---------------- 前回振り返り（答え合わせ） ---------------- */
  function reviewLastDraw(draws, game) {
    if (draws.length < 41) return null;
    const cfg = GAME[game];
    const past = draws.slice(0, -1);
    const actual = draws[draws.length - 1];
    const layers = {
      takarada: scoreTakarada(past, game),
      math: scoreMath(past, game),
      astro: scoreAstro(past, game, actual.date || new Date()),
      claude: scoreClaude(past, game),
    };
    const K = cfg.nPick + 4;
    const expected = Math.round(K * cfg.nPick / cfg.nMax * 10) / 10;
    const perLaw = Object.keys(layers).map(k => {
      const top = range(1, cfg.nMax).sort((a, b) => layers[k].scores[b] - layers[k].scores[a]).slice(0, K);
      const hits = top.filter(n => actual.numbers.includes(n));
      return {
        engine: k, label: LAW_LABEL[k], topK: top.slice().sort((a, b) => a - b), K: K,
        hits: hits.slice().sort((a, b) => a - b), hitCount: hits.length, expected: expected,
        verdict: hits.length > expected + 0.9 ? "的中傾向" : hits.length >= expected - 0.9 ? "期待値並み" : "不発",
      };
    });
    const combined = combineLayers(layers, cfg);
    const tA = buildTicket(combined, past, game, { strategy: "score" });
    const tB = buildTicket(combined, past, game, { strategy: "zone", exclude: new Set(tA) });
    return {
      actual: actual, perLaw: perLaw,
      tickets: [
        { mark: "◎", pick: tA, match: tA.filter(n => actual.numbers.includes(n)) },
        { mark: "○", pick: tB, match: tB.filter(n => actual.numbers.includes(n)) },
      ],
    };
  }

  /* ---------------- 統合予測 ---------------- */
  function combineLayers(layers, cfg) {
    const combined = {};
    for (let n = 1; n <= cfg.nMax; n++) {
      combined[n] = Object.keys(WEIGHTS).reduce((a, k) => a + WEIGHTS[k] * layers[k].scores[n], 0);
    }
    const mx = Math.max.apply(null, Object.values(combined)) || 1;
    for (const n in combined) combined[n] /= mx;
    return combined;
  }

  function predictAll(draws, game, today) {
    const cfg = GAME[game];
    const next = nextDrawInfo(draws, game, today || new Date());
    const layers = {
      takarada: scoreTakarada(draws, game),
      math: scoreMath(draws, game),
      astro: scoreAstro(draws, game, next.date),
      claude: scoreClaude(draws, game),
    };
    const combined = combineLayers(layers, cfg);
    const tA = buildTicket(combined, draws, game, { strategy: "score" });
    const tB = buildTicket(combined, draws, game, { strategy: "zone", exclude: new Set(tA) });
    const tickets = [
      { mark: "◎", name: "本命", pick: tA, evidence: ticketEvidence(tA, draws, game, layers, combined) },
      { mark: "○", name: "対抗", pick: tB, evidence: ticketEvidence(tB, draws, game, layers, combined) },
    ];
    return {
      game: game, cfg: cfg, next: next, layers: layers, combined: combined, tickets: tickets,
      stats: baseStats(draws, game),
      structural: structuralRates(draws, game),
      review: reviewLastDraw(draws, game),
      sums: draws.map(d => sum(d.numbers)),
      drawCount: draws.length,
    };
  }

  function nextDrawInfo(draws, game, today) {
    const cfg = GAME[game];
    const last = draws[draws.length - 1];
    let d = new Date(Math.max(+today, last.date ? +last.date : +today));
    do { d = new Date(+d + 86400000); } while (!cfg.drawDays.includes(d.getDay()));
    return { round: last.round + 1, date: d, lastRound: last.round, lastDate: last.date };
  }

  /* ---------------- 天体計算（近似・決定論） ---------------- */
  const SYNODIC = 29.530588853;
  const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14, 0);
  function moonAge(date) {
    const days = (+date - NEW_MOON_EPOCH) / 86400000;
    return ((days % SYNODIC) + SYNODIC) % SYNODIC;
  }
  function phaseName(age) {
    if (age < 7.38) return "新月期";
    if (age < 14.77) return "上弦期";
    if (age < 22.15) return "満月期";
    return "下弦期";
  }
  const MERCURY_RETRO = [
    ["2024-04-02", "2024-04-25"], ["2024-08-05", "2024-08-28"], ["2024-11-26", "2024-12-15"],
    ["2025-03-15", "2025-04-07"], ["2025-07-18", "2025-08-11"], ["2025-11-09", "2025-11-29"],
    ["2026-02-26", "2026-03-20"], ["2026-06-29", "2026-07-23"], ["2026-10-24", "2026-11-13"],
    ["2027-02-09", "2027-03-03"], ["2027-06-10", "2027-07-04"], ["2027-10-07", "2027-10-28"],
  ];
  function isMercuryRetro(date) {
    const t = +date;
    return MERCURY_RETRO.some(p => t >= +new Date(p[0]) && t <= +new Date(p[1]) + 86399000);
  }
  function sunSign(date) {
    const m = date.getMonth() + 1, d = date.getDate();
    const md = m * 100 + d;
    if (md >= 321 && md <= 419) return { sign: "牡羊座", element: "火" };
    if (md >= 420 && md <= 520) return { sign: "牡牛座", element: "地" };
    if (md >= 521 && md <= 621) return { sign: "双子座", element: "風" };
    if (md >= 622 && md <= 722) return { sign: "蟹座", element: "水" };
    if (md >= 723 && md <= 822) return { sign: "獅子座", element: "火" };
    if (md >= 823 && md <= 922) return { sign: "乙女座", element: "地" };
    if (md >= 923 && md <= 1023) return { sign: "天秤座", element: "風" };
    if (md >= 1024 && md <= 1122) return { sign: "蠍座", element: "水" };
    if (md >= 1123 && md <= 1221) return { sign: "射手座", element: "火" };
    if (md >= 1222 || md <= 119) return { sign: "山羊座", element: "地" };
    if (md >= 120 && md <= 218) return { sign: "水瓶座", element: "風" };
    return { sign: "魚座", element: "水" };
  }
  function astroContext(date) {
    const age = moonAge(date);
    const ss = sunSign(date);
    return {
      moonAge: age, phase: phaseName(age), mercuryRetro: isMercuryRetro(date),
      weekday: date.getDay(), sign: ss.sign, element: ss.element,
    };
  }

  /* ---------------- 小物 ---------------- */
  function zeros(nMax) { const o = {}; for (let n = 1; n <= nMax; n++) o[n] = 0; return o; }
  function normalize(s) {
    const vals = Object.values(s).map(v => Math.max(0, v));
    const mx = Math.max.apply(null, vals) || 1;
    const out = {}; for (const n in s) out[n] = Math.max(0, s[n]) / mx; return out;
  }
  function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }
  function keysOf(obj, f) { return Object.keys(obj).map(Number).filter(f); }
  function sum(a) { return a.reduce((x, y) => x + y, 0); }

  const LotoEngine = {
    GAME: GAME, WEIGHTS: WEIGHTS, LAW_LABEL: LAW_LABEL,
    parseCSVText: parseCSVText, predictAll: predictAll,
    structuralRates: structuralRates, baseStats: baseStats,
    astroContext: astroContext, moonAge: moonAge, phaseName: phaseName,
    consecPairs: consecPairs, sum: sum,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = LotoEngine;
  global.LotoEngine = LotoEngine;
})(typeof window !== "undefined" ? window : globalThis);
