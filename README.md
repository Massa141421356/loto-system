# 数字選択式 攻略研究所 ─ ロト6・ロト7 予測＆仮説検証システム

宝田法則・欧米数学理論・占星術・Claude統計則の「4つの法則テキスト」を絶対ルールとして
過去当選CSVと照合し、毎週2口の予想と詳細な根拠レポート（図表付き）、
前回抽選の答え合わせを自動生成する、完全ブラウザ完結型システムです。

## 使い方（毎週の運用）

1. `index.html` をブラウザで開く（またはGitHub PagesのURLにアクセス）
2. 最新の抽選結果を追記した `loto6_history.csv` / `loto7_history.csv` を
   画面の投入口にドラッグ＆ドロップ
3. それだけ。予想2口・おっちゃん解説・図表・前回の答え合わせが自動表示されます
4. 必要なら「JSONログとして保存」ボタンで予測ログを `logs/` に貯めてください

- CSVはみずほ銀行形式（開催回, 日付, 第1数字〜, …）。Shift-JIS / UTF-8 を自動判別
- 第7数字列の有無でロト6／ロト7を自動判定（間違ったタブに入れても自動で切替）
- 計算はすべてブラウザ内で完結し、CSVはどこにも送信されません

## GitHub Pages での公開手順

1. このフォルダ一式をリポジトリのルートに置いて push
2. リポジトリの Settings → Pages → Branch を `main` / `(root)` に設定
3. 発行されたURL（`https://<ユーザー名>.github.io/<リポジトリ名>/`）を開く

サーバーサイド処理は不要です（GitHub Actionsも不要）。

## ディレクトリ構成

```
├── index.html              # Web画面（タブ切替・CSV投入・レポート表示）
├── assets/
│   ├── style.css           # デザイン
│   ├── engine.js           # 予測エンジン（4法則スコアリング＋買い目構築＋検証）
│   ├── app.js              # UI層（描画・グラフ・ログ保存）
│   └── rules.js            # 法則テキストのJS埋め込み（書庫タブ表示用）
├── rules/                  # 4つの法則テキスト原本（システムの絶対ルール）
│   ├── takarada_rules.txt  # ① 宝田氏の法則
│   ├── math_theory_rules.txt # ② 欧米数学力学的買い目理論（M-1〜M-9）
│   ├── astrology_rules.txt # ③ ロト最適化占星術理論（A-1〜A-5）
│   └── claude_rules.txt    # ④ Claude独自統計法則（C-1〜C-7）
├── backend/predictor.py    # Python版エンジン骨組み（オフライン検証用・任意）
├── data/                   # CSV置き場（任意。投入はWeb画面からでOK）
└── logs/                   # 予測ログJSONの保存先（手動コミット）
```

## 法則テキストを更新したい場合

`rules/*.txt` を編集後、以下で `assets/rules.js` を再生成してください：

```bash
python3 - << 'EOF'
import json
texts = {k: open(f'rules/{f}', encoding='utf-8').read() for k, f in [
    ('takarada','takarada_rules.txt'),('math','math_theory_rules.txt'),
    ('astro','astrology_rules.txt'),('claude','claude_rules.txt')]}
open('assets/rules.js','w',encoding='utf-8').write(
    'window.RULE_TEXTS = ' + json.dumps(texts, ensure_ascii=False, indent=1) + ';\n')
EOF
```

（表示用テキストのみの更新。スコアリングの重みやロジックは `assets/engine.js` 内）

## 大切なお断り

本システムの表示する％は「過去データにおけるパターンの出現頻度」であり、
**当選確率を高めるものではありません**。ロトの抽選は毎回独立で、
どの組み合わせも1等当選確率は同一です（ロト6：1/6,096,454、ロト7：1/10,295,472）。
全期間データのカイ二乗検定でも個別数字の偏りは検出されていません。
娯楽として、無理のない範囲でお楽しみください。
