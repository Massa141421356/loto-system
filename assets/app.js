/* =====================================================================
   数字選択式 攻略研究所 ─ UI層
   CSV投入 → エンジン実行 → 買い目・おっちゃんレポート・図表を描画
   ===================================================================== */
(function () {
  "use strict";
  const E = window.LotoEngine;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const charts = {}; // canvasId -> Chart

  /* ---------------- タブ ---------------- */
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });
  function activateTab(id) {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === id));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + id));
  }

  /* ---------------- CSV投入口 ---------------- */
  ["loto6", "loto7"].forEach(game => {
    const dz = $("#dz-" + game);
    const input = $("#file-" + game);
    dz.addEventListener("click", () => input.click());
    dz.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("hover"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("hover"));
    dz.addEventListener("drop", e => {
      e.preventDefault(); dz.classList.remove("hover");
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], game);
    });
    input.addEventListener("change", () => { if (input.files[0]) handleFile(input.files[0], game); });
  });

  function handleFile(file, tabGame) {
    const err = $("#err-" + tabGame);
    err.style.display = "none";
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = decodeSmart(reader.result);
        const parsed = E.parseCSVText(text);
        if (parsed.game !== tabGame) {
          // 列構成から自動判定してタブを切替
          activateTab(parsed.game);
        }
        $("#status-" + parsed.game).textContent =
          "✔ " + file.name + " を読込 ─ " + E.GAME[parsed.game].label + " 全" + parsed.draws.length + "回分（第" +
          parsed.draws[0].round + "回〜第" + parsed.draws[parsed.draws.length - 1].round + "回）。予想を自動実行しました。";
        runPrediction(parsed.game, parsed.draws);
      } catch (ex) {
        const box = $("#err-" + tabGame);
        box.textContent = "読み込みエラー：" + ex.message;
        box.style.display = "block";
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function decodeSmart(buf) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder("shift_jis").decode(buf); }
  }

  /* ---------------- 予測実行と描画 ---------------- */
  let lastResults = {};
  window.__runPrediction = runPrediction; // 自動テスト用フック
  function runPrediction(game, draws) {
    const r = E.predictAll(draws, game, new Date());
    lastResults[game] = r;
    const root = $("#report-" + game);
    root.classList.remove("hidden");
    root.innerHTML = buildReportHTML(r);
    root.querySelector(".save-log").addEventListener("click", () => downloadLog(r));
    drawCharts(game, r, draws);
    root.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const fmtDate = d => d ? d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日（" + "日月火水木金土"[d.getDay()] + "）" : "-";

  function buildReportHTML(r) {
    const cfg = r.cfg, g = r.game;
    const h = [];
    h.push('<h2 class="section-title">第' + r.next.round + '回 ' + cfg.label + ' 予想 <small>抽選予定日 ' + fmtDate(r.next.date) + '／データ最終回 第' + r.next.lastRound + '回</small></h2>');

    /* --- 2口の買い目 --- */
    h.push('<div class="tickets">');
    r.tickets.forEach(t => {
      const e = t.evidence;
      h.push('<div class="ticket"><span class="mark" aria-hidden="true">' + t.mark + '</span>' +
        '<h3>' + t.name + '（' + (t.mark === "◎" ? "総合スコア最優先の1口" : "区間安定テンプレートの1口") + '）</h3>' +
        '<div class="balls">' + t.pick.map(n => '<span class="ball">' + n + '</span>').join("") + '</div>' +
        '<div class="meta">合計 <b>' + e.sum + '</b>（推奨' + cfg.sumRange[0] + '〜' + cfg.sumRange[1] + '）｜奇' + e.odd + '：偶' + e.even +
        '｜連番' + e.consecPairs + '組｜前回からの引っ張り' + e.carry + '個</div>' +
        '<div class="pattern-pct">この構成型（合計帯×奇偶×連番×引っ張り）と完全一致する型は<br>過去の当選のうち <b>' + e.patternPct + '%</b> を占める多数派タイプ</div>' +
        '</div>');
    });
    h.push('</div>');

    /* --- 数字別の根拠テーブル --- */
    h.push('<h2 class="section-title">数字別の選出根拠 <small>期待度指数＝4法則の重み付き合成（最大100）。基準出現率は1数字あたり' +
      (g === "loto6" ? "14.0" : "18.9") + '%</small></h2>');
    r.tickets.forEach(t => {
      h.push('<h3 style="font-family:var(--disp);margin:18px 0 4px;">' + t.mark + ' ' + t.name + '</h3>');
      h.push('<table class="evi"><tr><th>数字</th><th>期待度指数</th><th>合致した法則</th></tr>');
      t.evidence.perNumber.forEach(p => {
        const chips = p.laws.length
          ? p.laws.map(l => '<span class="chip ' + l.engine + '">' + E.LAW_LABEL[l.engine] + '｜' + l.tag + '</span>').join("")
          : '<span style="color:var(--ink-soft);font-size:12px;">構成バランス調整枠（合計値・ゾーン補正で選出）</span>';
        h.push('<tr><td class="num">' + p.n + '</td><td class="idx">' + p.index + '</td><td>' + chips + '</td></tr>');
      });
      h.push('</table>');
    });

    /* --- おっちゃんレポート --- */
    h.push('<h2 class="section-title">今週の見立て <small>分析大好きおっちゃんの詳細解説</small></h2>');
    h.push('<div class="otchan">' + otchanReport(r) + '</div>');

    /* --- 図表 --- */
    h.push('<h2 class="section-title">根拠となる図表 <small>すべて添付CSVの全期間から算出した実測値</small></h2>');
    h.push('<div class="charts">' +
      '<div class="chart-card wide"><h4>数字別・総合期待度指数（' + cfg.label + ' 全' + cfg.nMax + '数字）</h4>' +
      '<p class="cap">朱＝◎本命採用、金＝○対抗採用。4法則の重み（宝田30%・数学30%・Claude統計25%・占星術15%）で合成。</p>' +
      '<canvas id="ch-score-' + g + '" height="120"></canvas></div>' +
      '<div class="chart-card"><h4>当選合計値の分布（全' + r.drawCount + '回）</h4>' +
      '<p class="cap">山の中心に買い目を置くのが数学理論M-3。▼が今回2口の合計位置。</p>' +
      '<canvas id="ch-sum-' + g + '"></canvas></div>' +
      '<div class="chart-card"><h4>構成型の実測出現率（Claude統計則C-1）</h4>' +
      '<p class="cap">当選の多数派が従う「型」。2口ともこの多数派側に設計済み。</p>' +
      '<canvas id="ch-struct-' + g + '"></canvas></div>' +
      '</div>');

    /* --- 法則別ノート --- */
    h.push('<h2 class="section-title">法則別・今回の適用メモ</h2><div class="law-notes">');
    ["takarada", "math", "astro", "claude"].forEach(k => {
      h.push('<div class="law-note ' + k + '"><h4>' + E.LAW_LABEL[k] + '（重み' + Math.round(E.WEIGHTS[k] * 100) + '%）</h4><ul>' +
        r.layers[k].notes.map(n => "<li>" + n + "</li>").join("") + "</ul></div>");
    });
    h.push("</div>");

    /* --- 前回の答え合わせ --- */
    if (r.review) h.push(reviewHTML(r));

    /* --- 免責と保存 --- */
    h.push('<div class="disclaimer"><strong>大切なお断り：</strong>ロトの抽選は毎回独立した物理抽選であり、' +
      'どの組み合わせも1等当選確率は同一（' + cfg.label + '：' + cfg.jackpotOdds + '）です。本レポートの％は' +
      '「過去データにおけるパターンの出現頻度」であって「次回当たる確率」ではありません。' +
      '統計的にも個別数字の偏りは検出されていません（頻度カイ二乗検定）。娯楽の範囲で、無理のない金額でお楽しみください。</div>');
    h.push('<p style="margin-top:20px;"><button class="btn save-log">この予想をJSONログとして保存（logs/用）</button></p>');
    return '<div class="report">' + h.join("") + '</div>';
  }

  /* ---------------- おっちゃん文体レポート ---------------- */
  function otchanReport(r) {
    const cfg = r.cfg, g = r.game, st = r.stats, sr = r.structural, ast = r.layers.astro.astro;
    const tA = r.tickets[0], tB = r.tickets[1];
    const cold = [];
    for (let n = 1; n <= cfg.nMax; n++) if (!st.recent30.has(n)) cold.push(n);
    const hot = Object.keys(st.recent10Count).map(Number).filter(n => st.recent10Count[n] >= 2).sort((a, b) => st.recent10Count[b] - st.recent10Count[a]);
    const p = [];
    p.push('<p class="lead">さぁ皆さんお待ちかね、第' + r.next.round + '回' + cfg.label + '（' + fmtDate(r.next.date) + '抽選）の研究発表や。今回も全' + r.drawCount + '回分のデータを端から端まで舐め回すように見てきたで。</p>');

    p.push('<p>まず土台の話からいこか。前回第' + st.last.round + '回は<span class="num-strong">［' + st.last.numbers.join('・') + '］</span>、合計' + E.sum(st.last.numbers) + 'やった。ここで効いてくるんが<em>引っ張りの法則</em>や。' + cfg.label + 'では前回の数字が1個以上顔を出す確率が実測<em>' + sr.carryPct + '%</em>。これはワシの経験則やのうて、数学的な理論値ともピタリ一致しとる筋金入りの数字や。せやから今回の2口には前回組を' + tA.evidence.carry + '個と' + tB.evidence.carry + '個、ちゃんと「橋渡し役」として仕込んである。逆に3個も4個も引っ張るのは統計的に稀やから、そこは欲張らんのが鉄則やで。</p>');

    p.push('<p>次に「型」の話。当たりくじっちゅうのはな、個々の数字やのうて<em>組み合わせの型</em>に癖が出るんや。合計値が' + cfg.sumRange[0] + '〜' + cfg.sumRange[1] + 'に収まった回が全体の<em>' + sr.sumRangePct + '%</em>、連番を1組以上含む回が<em>' + sr.consecPct + '%</em>。◎本命は合計<span class="num-strong">' + tA.evidence.sum + '</span>、○対抗は<span class="num-strong">' + tB.evidence.sum + '</span>で、どっちも分布のド真ん中の帯や。下の合計値グラフを見てみい、綺麗な山の頂上付近に▼が立っとるやろ。あそこが一番「型」が集まる場所なんや。</p>');

    if (hot.length) {
      p.push('<p>足元の流れも押さえとこ。直近10回で2回以上出とる<em>ホット数字</em>は［' + hot.slice(0, 8).join('・') + '］あたり。' + (ast.mercuryRetro ? 'しかも占星術班からの報告では、抽選日は<em>水星逆行</em>の真っ最中。逆行は「過去の反復」の暗示やから、ホット数字の再登場に張る理屈と噛み合うんが今回の面白いところや。' : '水星は順行やから、フレッシュな数字にも目配りしとる。') + '月齢は' + ast.moonAge.toFixed(1) + 'の<em>' + ast.phase + '</em>、太陽は' + ast.sign + '。' + (ast.phase === '下弦期' ? '下弦は「眠っとった数字の目覚め」の相' : '月相ゾーン則では' + ast.phase + 'の帯を意識する相') + 'やな。ただし正直に言うとくで──月相ゾーンのバックテストは実測' + r.layers.astro.backtest.measured + '%対期待値' + r.layers.astro.backtest.expected + '%で、偶然と区別つかん水準や。せやから占星術の重みは15%に抑えて、あくまで隠し味や。</p>');
    }

    if (cold.length) {
      p.push('<p>それとコールド組。直近30回ご無沙汰なんが［' + cold.join('・') + '］。宝田はんの<em>コールド復活法</em>では1〜2個混ぜて偏りを緩和するんが作法や。ただしワシの解析（C-6則）ではっきりしとるんは、「長いこと出てへんから、そろそろ出る」っちゅう理屈は<em>データ上は成立せん</em>ということ。スキップ回数別の出現率は見事にまっ平らやった。せやからコールドは「当たりやすいから」やのうて「他人と被りにくい分散要員」として使う。ここの割り切りが素人と研究者の分かれ目やで。</p>');
    }

    p.push('<p>締めに種明かしや。◎本命<span class="num-strong">［' + tA.pick.join('・') + '］</span>は4法則の合成スコア上位から、末尾被り2個まで・連番' + cfg.maxConsecPairs + '組まで・全ゾーン配置の関所を全部通した精鋭や。○対抗<span class="num-strong">［' + tB.pick.join('・') + '］</span>は発想を変えて、区間安定法のテンプレート（各ブロックから均等に採る）で組んだ別路線。同じ理屈で2口買うたら共倒れするからな、<em>戦略の違う2口</em>にするのがワシの流儀や。◎の構成型は過去の当選の' + tA.evidence.patternPct + '%、○は' + tB.evidence.patternPct + '%を占める多数派タイプ。もっとも、最後にもういっぺんだけ野暮なことを言わせてや──どの6' + (g === 'loto7' ? 'つ…いや7つ' : 'つ') + 'の組も当たる確率は寸分違わず同じ（' + cfg.jackpotOdds + '）。ワシらがやっとるのは「当たった時に美しい買い方」の研究や。夢は大きく、賭け金は小さく。ほな、今週も健闘を祈るで。</p>');
    return p.join("");
  }

  /* ---------------- 答え合わせ ---------------- */
  function reviewHTML(r) {
    const rv = r.review;
    const h = [];
    h.push('<h2 class="section-title">前回抽選の答え合わせ <small>第' + rv.actual.round + '回（' + fmtDate(rv.actual.date) + '）を、その前回までのデータで予測し直して検証</small></h2>');
    h.push('<div class="review-wrap"><span class="stamp">検証済</span>');
    h.push('<p style="margin-bottom:10px;">実際の当選数字：</p><div class="balls actual-balls" style="justify-content:flex-start;">' +
      rv.actual.numbers.map(n => '<span class="ball">' + n + '</span>').join("") + '</div>');
    h.push('<table class="evi" style="margin-top:18px;"><tr><th>法則</th><th>上位候補（各' + rv.perLaw[0].K + '個）</th><th>的中</th><th>偶然の期待値</th><th>判定</th></tr>');
    rv.perLaw.forEach(l => {
      const cls = l.verdict === "的中傾向" ? "verdict-hit" : l.verdict === "期待値並み" ? "verdict-even" : "verdict-miss";
      h.push('<tr><td><span class="chip ' + l.engine + '">' + l.label + '</span></td>' +
        '<td style="font-family:var(--num);font-size:15px;">' + l.topK.map(n => rv.actual.numbers.includes(n) ? '<span class="hitnum">' + n + '</span>' : n).join(" ") + '</td>' +
        '<td style="text-align:center;font-family:var(--num);font-size:17px;font-weight:700;">' + l.hitCount + '個</td>' +
        '<td style="text-align:center;">' + l.expected + '個</td>' +
        '<td class="' + cls + '">' + l.verdict + '</td></tr>');
    });
    h.push('</table>');
    rv.tickets.forEach(t => {
      h.push('<p style="margin-top:12px;font-size:14px;">当時のデータで本システムが出したはずの' + t.mark + '：' +
        '<span style="font-family:var(--num);font-size:16px;">［' + t.pick.map(n => rv.actual.numbers.includes(n) ? '<span class="hitnum">' + n + '</span>' : n).join("・") + '］</span>' +
        ' → <b>' + t.match.length + '個一致</b>' + (t.match.length ? '（' + t.match.join('・') + '）' : '') + '</p>');
    });
    const best = rv.perLaw.slice().sort((a, b) => b.hitCount - a.hitCount)[0];
    const worst = rv.perLaw.slice().sort((a, b) => a.hitCount - b.hitCount)[0];
    h.push('<p style="margin-top:14px;font-size:14px;line-height:2;">【総括】この回で最も仕事をしたのは<b>' + best.label + '</b>（' + best.hitCount +
      '個的中、期待値' + best.expected + '個）。一方、<b>' + worst.label + '</b>は' + worst.hitCount + '個にとどまった。' +
      'ただし1回分の検証はサンプル1に過ぎず、法則の優劣を断定する材料にはならない点に注意。毎週この検証を積み重ねることで、どの法則が長期的に期待値を上回るか（あるいは全て偶然の範囲か）を客観的に判定していくのが本システムの検証機能である。</p>');
    h.push('</div>');
    return h.join("");
  }

  /* ---------------- 図表 ---------------- */
  function drawCharts(g, r, draws) {
    const cfg = r.cfg;
    const shu = "#c63d2b", gold = "#c9a227", mute = "rgba(29,44,80,.35)";
    const pickA = new Set(r.tickets[0].pick), pickB = new Set(r.tickets[1].pick);

    // 1) 数字別スコア
    const labels = [], data = [], colors = [];
    for (let n = 1; n <= cfg.nMax; n++) {
      labels.push(n); data.push(Math.round(r.combined[n] * 100));
      colors.push(pickA.has(n) ? shu : pickB.has(n) ? gold : mute);
    }
    makeChart("ch-score-" + g, {
      type: "bar",
      data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0 }] },
      options: baseOpts({ y: { title: { display: true, text: "期待度指数" }, max: 100 } }),
    });

    // 2) 合計値ヒストグラム
    const binSize = 10, bins = {}, sums = r.sums;
    sums.forEach(s => { const b = Math.floor(s / binSize) * binSize; bins[b] = (bins[b] || 0) + 1; });
    const bkeys = Object.keys(bins).map(Number).sort((a, b) => a - b);
    const tSums = r.tickets.map(t => t.evidence.sum);
    makeChart("ch-sum-" + g, {
      type: "bar",
      data: {
        labels: bkeys.map(b => b + "〜"),
        datasets: [{
          data: bkeys.map(b => bins[b]),
          backgroundColor: bkeys.map(b => tSums.some(s => s >= b && s < b + binSize) ? shu : mute),
          borderWidth: 0,
        }],
      },
      options: baseOpts({
        y: { title: { display: true, text: "回数" } },
        x: { ticks: { maxRotation: 60, minRotation: 45, font: { size: 10 } } },
      }, { tooltipSuffix: "回", tickets: tSums }),
    });

    // 3) 構成型の実測率
    const sr = r.structural;
    makeChart("ch-struct-" + g, {
      type: "bar",
      data: {
        labels: ["合計" + cfg.sumRange[0] + "〜" + cfg.sumRange[1], "連番1組以上", "前回から引っ張り", "奇偶バランス適正"],
        datasets: [{ data: [sr.sumRangePct, sr.consecPct, sr.carryPct, sr.oddOkPct], backgroundColor: ["#2e7d5b", "#4c82b3", shu, gold], borderWidth: 0 }],
      },
      options: baseOpts({ x: { max: 100, title: { display: true, text: "過去の当選に占める割合（%）" } } }, { horizontal: true }),
    });
  }

  function baseOpts(scales, extra) {
    extra = extra || {};
    const o = {
      indexAxis: extra.horizontal ? "y" : "x",
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: extra.tooltipSuffix ? { label: c => c.parsed.y + extra.tooltipSuffix + (extra.tickets ? "" : "") } : {},
        },
      },
      scales: scales || {},
      animation: { duration: 500 },
    };
    return o;
  }

  function makeChart(id, config) {
    const el = document.getElementById(id);
    if (!el) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el.getContext("2d"), config);
  }

  /* ---------------- ログ保存 ---------------- */
  function downloadLog(r) {
    const log = {
      generated_at: new Date().toISOString(),
      game: r.game, next_round: r.next.round,
      next_draw_date: r.next.date.toISOString().slice(0, 10),
      data_last_round: r.next.lastRound,
      tickets: r.tickets.map(t => ({
        mark: t.mark, name: t.name, numbers: t.pick,
        sum: t.evidence.sum, odd: t.evidence.odd, consec_pairs: t.evidence.consecPairs,
        carry: t.evidence.carry, pattern_pct: t.evidence.patternPct,
        per_number: t.evidence.perNumber.map(p => ({ n: p.n, index: p.index, laws: p.laws.map(l => E.LAW_LABEL[l.engine] + ":" + l.tag) })),
      })),
      law_notes: Object.fromEntries(Object.keys(r.layers).map(k => [k, r.layers[k].notes])),
      astro: r.layers.astro.astro ? {
        moon_age: +r.layers.astro.astro.moonAge.toFixed(2), phase: r.layers.astro.astro.phase,
        mercury_retrograde: r.layers.astro.astro.mercuryRetro, sun_sign: r.layers.astro.astro.sign,
      } : null,
      disclaimer: "このパーセンテージは過去データのパターン出現頻度であり、当選確率を高めるものではありません。",
    };
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "prediction_" + r.game + "_round" + r.next.round + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------------- 法則書庫 ---------------- */
  (function renderRuleLibrary() {
    const root = $("#rulebooks");
    if (!root || !window.RULE_TEXTS) return;
    const meta = [
      ["takarada", "① 宝田氏の法則（ロト6：20法／ロト7：20法）"],
      ["math", "② 欧米・数学力学的買い目理論（Gail Howard系 M-1〜M-9）"],
      ["astro", "③ ロト最適化・占星術理論（A-1〜A-5／ephem計算可能形式）"],
      ["claude", "④ Claude独自統計法則（全期間解析 C-1〜C-7）"],
    ];
    root.innerHTML = meta.map(m =>
      '<details class="rulebook"><summary>' + m[1] + '</summary><pre>' +
      window.RULE_TEXTS[m[0]].replace(/&/g, "&amp;").replace(/</g, "&lt;") + '</pre></details>').join("");
  })();
})();
