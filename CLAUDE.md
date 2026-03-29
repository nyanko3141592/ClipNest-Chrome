# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

ClipNest Chrome — クリップボード履歴 + スニペット管理の Chrome 拡張機能。macOS アプリ ClipNest の Chrome 版。

- **Manifest V3**
- **UI**: Content Script + Shadow DOM でページ内にインラインポップアップ表示
- **外部依存なし** (vanilla JS のみ)

## ファイル構成

```
manifest.json     Manifest V3 定義 (permissions, commands, content_scripts)
background.js     Service Worker (ショートカット転送, content script inject, 初期データ)
content.js        全UI・ロジック (Shadow DOM, キーボード操作, CRUD, 設定)
images/           拡張アイコン (16/48/128px)
```

## アーキテクチャ

- **content.js が全て**: Shadow DOM 内にパネル UI を構築。スニペット CRUD、クリップボード履歴、設定、キーボードナビゲーションを単一ファイルで管理
- **データ永続化**: `chrome.storage.local` に `snippets`, `history`, `settings` を保存
- **ホットキー**: document レベルの keydown リスナーで独自実装 (設定で変更可能、デフォルト Cmd+Shift+V)
- **background.js**: ツールバーアイコンクリック時のフォールバックと、content script 未注入時の動的 inject のみ

## キーボード操作 (パネル表示中)

| キー | 動作 |
|------|------|
| ↑↓ | アイテム選択 |
| Enter | ペースト |
| 1-9 | クイック選択 |
| Tab | Snippets ↔ History |
| →← | フォルダ展開/折りたたみ |
| e | 選択アイテム編集 |
| s | 履歴→スニペット保存 |
| / | 検索トグル |
| Esc | 閉じる (検索→設定→パネル) |
| Cmd+Enter | エディタで保存 |

## コーディング規約

- vanilla JS のみ、フレームワーク不使用
- Shadow DOM (`mode: 'closed'`) でページのスタイルから隔離
- CSS は style.textContent に直書き (content.js 内)
- キーボードファーストの UX。マウス操作なしで全機能使える設計
