# -*- coding: utf-8 -*-
"""
ロト6/ロト7 予測・仮説検証システム バックエンド骨組み
=====================================================
4つの法則テキスト（宝田法則／数学理論／占星術理論／Claude統計法則）を
読み込み、CSV履歴と照合して各数字の「出現期待度スコア（％）」を算出し、
2口の買い目と根拠レポート(JSON)を生成する。

注意：本スコアは「過去データ上のパターン出現頻度」であり、
      実際の当選確率を高めるものではない（全組み合わせは等確率）。

実行例:
    python predictor.py --game loto6 --csv ../data/loto6_history.csv --out ../logs/
"""

import argparse
import csv
import json
import math
from collections import Counter
from datetime import datetime
from pathlib import Path

# ───────────────────────────────────────────
# ゲーム定義
# ───────────────────────────────────────────
GAME_CONFIG = {
    "loto6": {
        "n_pick": 6, "n_max": 43,
        "sum_range": (100, 160), "sum_center": 132,
        "low_high_split": 22,
        "zones": [(1, 14), (15, 28), (29, 43)],
        "num_cols": ["第1数字", "第2数字", "第3数字", "第4数字", "第5数字", "第6数字"],
        "mirror": lambda n: 44 - n,
    },
    "loto7": {
        "n_pick": 7, "n_max": 37,
        "sum_range": (105, 165), "sum_center": 133,
        "low_high_split": 19,
        "zones": [(1, 10), (11, 20), (21, 30), (31, 37)],
        "num_cols": ["第1数字", "第2数字", "第3数字", "第4数字",
                     "第5数字", "第6数字", "第7数字"],
        "mirror": lambda n: 38 - n,
    },
}

RULES_DIR = Path(__file__).parent.parent / "rules"


# ───────────────────────────────────────────
# 1. データ読み込み（Shift-JIS / UTF-8 両対応）
# ───────────────────────────────────────────
def load_history(csv_path: str, game: str) -> list[dict]:
    """CSVを読み込み、[{回号, 日付, numbers: [...]}] のリストを返す"""
    cfg = GAME_CONFIG[game]
    for enc in ("utf-8-sig", "shift_jis", "cp932"):
        try:
            with open(csv_path, encoding=enc) as f:
                rows = list(csv.DictReader(f))
            if rows and cfg["num_cols"][0] in rows[0]:
                break
        except (UnicodeDecodeError, KeyError):
            continue
    else:
        raise ValueError("CSVの読み込みに失敗しました（エンコーディング不明）")

    history = []
    for r in rows:
        nums = sorted(int(r[c]) for c in cfg["num_cols"])
        history.append({
            "round": int(r["開催回"]),
            "date": _parse_date(r["日付"]),
            "numbers": nums,
        })
    return sorted(history, key=lambda x: x["round"])


def _parse_date(s: str) -> datetime:
    for fmt in ("%Y/%m/%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip(), fmt)
        except ValueError:
            continue
    raise ValueError(f"日付形式が不明: {s}")


# ───────────────────────────────────────────
# 2. 法則エンジン（各法則 → 数字ごとのスコア 0.0〜1.0）
#    ※ 各関数は {数字: スコア} と 根拠メモのリスト を返す
# ───────────────────────────────────────────
def score_takarada(history, game) -> tuple[dict, list]:
    """① 宝田法則：takarada_rules.txt の各法を実装
    - 引っ張り一点軸法（前回数字の再出現傾向）
    - コールド復活法（直近30回未出現数字）
    - ホット数字法（ロト7：直近10回で複数回出現）
    - スライドギャップ法（前回の差分パターン適用）  など
    TODO: 各法をスコア関数として実装し合成する
    """
    cfg = GAME_CONFIG[game]
    scores = {n: 0.0 for n in range(1, cfg["n_max"] + 1)}
    notes = []
    # --- 例：引っ張り一点軸法 ---
    last = history[-1]["numbers"]
    for n in last:
        scores[n] += 0.3
    notes.append(f"引っ張り軸候補（前回数字）: {last}")
    # --- 例：コールド復活法 ---
    recent30 = {n for h in history[-30:] for n in h["numbers"]}
    cold = [n for n in scores if n not in recent30]
    for n in cold:
        scores[n] += 0.25
    notes.append(f"コールドナンバー（直近30回未出現）: {cold}")
    # TODO: スライドギャップ／三角ゾーン／合計値レンジ 等を追加
    return _normalize(scores), notes


def score_math_theory(history, game) -> tuple[dict, list]:
    """② 数学理論：math_theory_rules.txt（M-1〜M-8）を実装
    - M-6 出現間隔則：スキップ0〜5の数字に加点
    - M-5 引っ張り則：理論値60.4%との整合チェック  など
    """
    cfg = GAME_CONFIG[game]
    scores = {n: 0.0 for n in range(1, cfg["n_max"] + 1)}
    notes = []
    # --- M-6 スキップ分析 ---
    skip = _skip_counts(history, cfg["n_max"])
    for n, s in skip.items():
        if s <= 5:
            scores[n] += 0.4 * (1 - s / 6)
    notes.append("M-6: スキップ0〜5回の数字を中核候補に採用")
    # TODO: 頻度統計・グループ欠落・末尾分散スコアを追加
    return _normalize(scores), notes


def score_astrology(history, game, draw_date: datetime) -> tuple[dict, list]:
    """③ 占星術理論：astrology_rules.txt（A-1〜A-4）を実装
    ephem で月齢・水星逆行・太陽黄経を計算し、ゾーン加点する。
    さらに過去抽選日で同条件の一致率をバックテストして％を実測する。
    """
    cfg = GAME_CONFIG[game]
    scores = {n: 0.0 for n in range(1, cfg["n_max"] + 1)}
    notes = []
    try:
        import ephem  # pip install ephem
        moon_age = _moon_age(draw_date)
        phase = ["新月期", "上弦期", "満月期", "下弦期"][int(moon_age // 7.38) % 4]
        zone_idx = {"新月期": 0, "上弦期": 1, "満月期": 1, "下弦期": 2}
        lo, hi = _third_zone(cfg["n_max"], zone_idx.get(phase, 1))
        for n in range(lo, hi + 1):
            scores[n] += 0.3
        notes.append(f"A-1: 月齢{moon_age:.1f}（{phase}）→ {lo}〜{hi}帯を強調")
        # TODO: A-2 水星逆行判定 / A-3 支配星末尾 / A-4 エレメント
        # TODO: 過去データでのバックテスト一致率（％）算出
    except ImportError:
        notes.append("ephem未導入のため占星術スコアは均等値（要 pip install ephem）")
    return _normalize(scores), notes


def score_claude_statistics(history, game) -> tuple[dict, list]:
    """④ Claude独自統計法則：CSV全期間解析から発見した偏りを実装
    候補（実データ解析後にテキスト化・確定する）:
    - 出現間隔の反発性（長期未出現後の回帰速度）
    - 回号周期性（開催回 mod k と出現数字の相関）
    - 末尾同調性（前回末尾と今回末尾の遷移行列）
    - ペア共起の残差分析（期待共起数との乖離）
    TODO: 解析スクリプト analyze.py の結果を claude_rules.txt に固定し、
          ここで読み込んで適用する
    """
    cfg = GAME_CONFIG[game]
    freq = Counter(n for h in history for n in h["numbers"])
    total = sum(freq.values())
    scores = {n: freq.get(n, 0) / total * cfg["n_max"] for n in range(1, cfg["n_max"] + 1)}
    notes = ["全期間出現頻度の偏差を基礎スコアとして採用（暫定）"]
    return _normalize(scores), notes


# ───────────────────────────────────────────
# 3. 統合スコア → 買い目2口の生成
# ───────────────────────────────────────────
WEIGHTS = {"takarada": 0.30, "math": 0.30, "astro": 0.15, "claude": 0.25}


def predict(history, game, draw_date):
    layers = {
        "takarada": score_takarada(history, game),
        "math": score_math_theory(history, game),
        "astro": score_astrology(history, game, draw_date),
        "claude": score_claude_statistics(history, game),
    }
    cfg = GAME_CONFIG[game]
    combined = {n: sum(WEIGHTS[k] * layers[k][0][n] for k in layers)
                for n in range(1, cfg["n_max"] + 1)}

    # 口A：スコア上位から数学フィルタ(M-1〜M-8)を満たす組を貪欲選択
    ticket_a = _build_ticket(combined, history, game, strategy="score_top")
    # 口B：宝田法則の構成テンプレート（三角ゾーン等）を優先した別解
    ticket_b = _build_ticket(combined, history, game, strategy="takarada_zone",
                             exclude=set(ticket_a))

    return {
        "game": game,
        "draw_date": draw_date.strftime("%Y-%m-%d"),
        "tickets": [ticket_a, ticket_b],
        "number_scores_pct": {n: round(v * 100, 1) for n, v in combined.items()},
        "evidence": {k: layers[k][1] for k in layers},
    }


def _build_ticket(scores, history, game, strategy, exclude=frozenset()):
    """数学フィルタ（合計値・奇偶・連番・ゾーン）を全通過する組を構築。
    TODO: strategy別の選択ロジックとフィルタ検証ループを実装"""
    cfg = GAME_CONFIG[game]
    ranked = sorted((n for n in scores if n not in exclude),
                    key=scores.get, reverse=True)
    pick = sorted(ranked[:cfg["n_pick"]])  # 暫定：上位N（要フィルタ通過検証）
    return pick


# ───────────────────────────────────────────
# 4. 前回抽選の答え合わせレポート
# ───────────────────────────────────────────
def review_last_draw(history, game, prev_prediction_path=None):
    """logs/ に保存した前回予測JSONと最新CSV行を照合し、
    法則別の的中数・的中率を集計する。TODO: 実装"""
    return {"status": "TODO", "last_result": history[-1]}


# ───────────────────────────────────────────
# ユーティリティ
# ───────────────────────────────────────────
def _normalize(scores: dict) -> dict:
    mx = max(scores.values()) or 1
    return {n: v / mx for n, v in scores.items()}


def _skip_counts(history, n_max) -> dict:
    skip = {}
    for n in range(1, n_max + 1):
        s = 0
        for h in reversed(history):
            if n in h["numbers"]:
                break
            s += 1
        skip[n] = s
    return skip


def _moon_age(date) -> float:
    import ephem
    prev_new = ephem.previous_new_moon(date.strftime("%Y/%m/%d"))
    return date.toordinal() + 0.5 - prev_new.datetime().toordinal()


def _third_zone(n_max, idx):
    step = n_max // 3
    return (idx * step + 1, n_max if idx == 2 else (idx + 1) * step)


# ───────────────────────────────────────────
# エントリポイント
# ───────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", choices=["loto6", "loto7"], required=True)
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", default="../logs/")
    args = ap.parse_args()

    history = load_history(args.csv, args.game)
    result = predict(history, args.game, datetime.now())
    result["review"] = review_last_draw(history, args.game)

    out = Path(args.out) / f"prediction_{args.game}_{datetime.now():%Y%m%d}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"予測を出力しました: {out}")


if __name__ == "__main__":
    main()
