# HD-2D Dungeon Rendering Notes

このメモは、現在作成中のダンジョンゲーム表現 POC で得た知見を、後から再現しやすいようにまとめたものです。

対象プロジェクトは Vite + React + TypeScript + Three.js 構成です。2D生成素材を Three.js の疑似3D空間に配置し、背景、床、キャラクター、影、光、攻撃エフェクト、ポストエフェクトを合成して HD-2D 風の戦闘画面を作っています。

## 目的

HD-2D 風のダンジョン/フィールド戦闘画面を、1枚絵ではなく複数の視覚レイヤーとして再現します。

重要なのは、背景画像をそのまま表示することではなく、以下の要素に分解して再合成することです。

- 背景の奥行きレイヤー
- 床テクスチャ
- キャラクタースプライト
- 接地影
- 光の板
- 霧、粒子、空気感
- 攻撃エフェクト
- Bloom、Bokeh、色調整

## 技術スタック

- Vite
- React
- TypeScript
- Three.js
- Three.js postprocessing
  - `EffectComposer`
  - `RenderPass`
  - `UnrealBloomPass`
  - `BokehPass`
  - `ShaderPass`

主な実装は `src/main.tsx` に集約されています。

## 基本構成

描画要素は以下の組み合わせです。

- `PlaneGeometry` の床
- `PlaneGeometry` の背景/パララックスレイヤー
- `Sprite` のキャラクター
- `MeshBasicMaterial` と `MeshStandardMaterial` の使い分け
- `CanvasTexture` による光、煙、斬撃、突き、衝撃波
- `Points` による火花や粒子
- `LineSegments` による衝撃線や風の流れ
- `EffectComposer` によるポストエフェクト

ステージごとの設定は `STAGES` に集約します。ステージ定義に視覚パラメータをまとめることで、ステージ追加や比較調整がしやすくなります。

## ステージ定義

ステージは以下の情報を持ちます。

- `world`: 背景色、霧色、霧密度
- `floor`: 床画像、繰り返し回数、発光、roughness、unlit 指定
- `backdrop`: 背景板の位置、高さ、透明度
- `parallax`: sky/far/mid の板、位置、サイズ、drift
- `lights`: 環境光、キーライト、ポイントライト
- `camera`: PC/SP 別のカメラ設定
- `layout`: PC/SP 別のキャラクター配置
- `post`: PC/SP 別の Bloom/Bokeh/色調整

ステージ追加時は、コード内に散らばった値を増やすのではなく、まず `StageDefinition` に集めるのがよいです。

## 素材生成の考え方

背景素材は、最初に完成イメージの参照画像を作り、その後で用途別に分解する流れが有効でした。

現在の highland/forest 系素材では以下の構成です。

- `highland-reference.png`: 全体の完成イメージ
- `highland-sky.png`: 空、樹冠、光
- `highland-far.png`: 遠景、遺跡、山、霞
- `highland-mid.png`: 中景の木、葉、根、岩
- `highland-floor-tile.png`: シームレス床テクスチャ

生成プロンプトでは、用途を明確に書き分けます。

- `16:9 wide image`
- `HD-2D hand-painted game background asset`
- `no characters`
- `no UI`
- `no text`
- `parallax layer`
- `transparent background`
- `floor only`
- `seamless square battle floor texture`

特に床は、完成背景から切り出すよりも、最初からシームレスな正方形テクスチャとして生成した方が Three.js の `RepeatWrapping` に向きます。

## 背景レイヤー

HD-2D らしさは背景の分解精度で大きく変わります。

背景は以下のように分けると調整しやすいです。

- sky: 最奥。空、樹冠、光、雲など
- far: 遠景。山、遺跡、遠い森、霞など
- mid: 中景。木、岩、根、葉などの画面フレーミング
- floor: 3D床に貼るシームレステクスチャ

各レイヤーは `PlaneGeometry` と `MeshBasicMaterial` で配置します。透明 PNG を使う場合は `transparent: true` と `depthWrite: false` を指定します。

パララックスレイヤーにはわずかな `drift` を持たせ、時間経過で横方向にゆっくり揺らすと、静止画でも空気が動いているように見えます。

## 床

床は大きな `PlaneGeometry` を寝かせ、床テクスチャを `RepeatWrapping` で繰り返します。

現在の POC では、床のワールドサイズは大きく取りつつ、カメラで見える面積を制御しています。床を見せすぎると「ただの3D床」に見えやすいため、画面下 1/3 程度に抑えるのが安定します。

ダンジョン系では `MeshStandardMaterial` が使いやすいです。ライト、roughness、emissive によって暗所の雰囲気を作れます。

昼の屋外や明るい森では、物理ライトで床を照らすと暗く沈むことがあります。その場合は `MeshBasicMaterial` を使い、画像本来の明るさを保つ方が見た目が安定します。

## カメラ

HD-2D 風の画作りではカメラ角度が重要です。

現在は低めの斜め見下ろしカメラを使っています。

- PC: FOV は 30から40度前後
- SP: FOV は 59から72度前後
- `position.y` は高め
- `position.z` は奥へ引く
- `target` はキャラクターの少し奥、少し上
- `idleSway` で常時ごく小さく揺らす
- 攻撃ヒット時は短く camera shake を入れる

床面積が広すぎると背景の密度が死にます。カメラは「床を見せる」よりも「背景とキャラを同じ画面に立たせる」ことを優先します。

## レスポンシブ対応

単に CSS で縮小するのではなく、PC/SP で別のカメラ、配置、ポスト設定を持たせます。

現在は以下の条件で SP プロファイルを使います。

- 幅が 760px 以下
- または aspect が 0.86 未満

SP では以下を調整します。

- FOV を広げる
- カメラを少し引く
- キャラクター間隔を狭める
- キャラクタースケールを 0.88 程度に下げる
- 粒子サイズを小さくする
- Bloom/Bokeh を抑える

これにより、スマホ表示でもキャラが画面外へ出にくくなり、エフェクトが過剰に見えにくくなります。

## キャラクター

キャラクターは `Sprite` として配置します。

HD-2D/ピクセル寄りの見え方を維持するため、キャラクター画像には `NearestFilter` を使います。一方、背景パララックス画像は `LinearFilter` や mipmap 系のフィルタでやわらかく見せます。

キャラクターは床に接地しているように見せる必要があります。そのため、影を2種類重ねます。

- 楕円の blob shadow
- キャラ画像のアルファから作る silhouette shadow

silhouette shadow は、元画像を Canvas に読み込み、透明部分やクロマキー背景を除去して黒い半透明影に変換します。これにより、Sprite でも床との接地感が出ます。

## ライティング

ライトは物理的な正しさより、絵作りを優先します。

現在使っている主なライトは以下です。

- `HemisphereLight`: 全体の色温度
- `DirectionalLight`: 主光源、影方向
- `PointLight`: キャラクター周辺、敵周辺、リムライト

ただし、実ライトだけで光の表現を作るのは難しいため、光そのものを半透明の板として配置します。

例:

- 光芒
- 床の明るい斑点
- キャラクター周辺の薄い glow
- 魔法的な発光

これらは `CanvasTexture` でグラデーションを作り、`AdditiveBlending` で重ねます。

## ポストエフェクト

現在は以下の順でポストエフェクトを合成しています。

1. `RenderPass`
2. `UnrealBloomPass`
3. `BokehPass`
4. 独自 `colorGradeShader`

独自 shader では以下を調整します。

- exposure
- contrast
- saturation
- warmth
- vignette

Bloom は強くしすぎるとキャラや床が白飛びします。ダンジョンや聖域ではやや強め、昼の森では控えめにするのが良いです。

Bokeh も強すぎると生成素材の情報量が潰れるため、昼ステージではかなり弱くします。

## 攻撃エフェクト

斬撃と突きは、単一画像ではなく複数レイヤーの時間制御で作ります。

共通の考え方:

- Canvas で光跡テクスチャを生成する
- `ShaderMaterial` で `revealHead` / `revealTail` を制御する
- 0から1の `combatCycle` を作る
- `windowProgress(start, end)` で時間窓を切る
- `easeOutCubic` や `pulseWindow` で伸び、発生、消滅を調整する
- Sparks、Lines、Rings、Smoke を少しずつ遅延させて重ねる

斬撃では Bezier 曲線上に火花を配置します。斬撃本体の曲線と火花のサンプリング座標を一致させることで、エフェクトが手元から外れにくくなります。

突きでは、hero から enemy までの線分を `sampleThrustLine()` でサンプリングします。軌跡、衝撃波、風の渦、火花を同じ座標系に乗せることで、攻撃方向が読みやすくなります。

攻撃エフェクトは、専用の座標サンプリング関数を持たせると再現性が高くなります。

## 時間制御

エフェクト制御では、絶対時間ではなく 0から1 の正規化された進行度を使うと調整しやすいです。

主な補助関数:

- `windowProgress(progress, start, end)`
- `easeOutCubic(value)`
- `easeInOutCubic(value)`
- `pulseWindow(progress, start, end)`

例えば、斬撃なら以下のように役割ごとに時間窓を分けます。

- 0.18から0.40: キャラの踏み込み
- 0.32から0.42: 斬撃の描画開始
- 0.47から0.62: 斬撃の尾を消す
- 0.47から0.77: ヒット火花
- 0.56から0.66: 斬撃のフェードアウト

このようにタイミングを小さく分けると、派手にしても破綻しにくくなります。

## 粒子と空気感

粒子はステージによって意味を変えます。

ダンジョンでは、下方向に落ちる埃や火の粉のように扱います。  
昼の森では、横方向に漂う花粉、光粒、薄い霞のように扱います。

同じ `PointsMaterial` でも、ステージごとに以下を変えます。

- particle count
- size
- opacity
- blending
- 移動方向
- reset 条件

空気感は背景画像だけで作ろうとせず、薄い霧板、粒子、光芒、色調整を重ねて作る方が安定します。

## デバッグと検証

視覚 POC ではビルド成功だけでは不十分です。スクリーンショットで確認します。

確認項目:

- 背景が黒抜けしていない
- canvas が viewport 全体に広がっている
- PC/SP でキャラが画面外に出ない
- 床が広すぎない
- Bloom/Bokeh が素材を潰していない
- 攻撃エフェクトの発生位置が武器/敵に合っている
- 透明 PNG に不透明背景が混入していない
- パララックスレイヤーの horizon が大きくずれていない

URL パラメータで状態を固定できるようにしておくと検証しやすいです。

例:

```text
?stage=highland
?battle=slash
?battle=thrust
?phase=0.5
?debug
```

`?phase=` で攻撃中の特定フレームを固定できると、スクリーンショット比較がかなり楽になります。

## 再現手順

1. 完成背景の参照画像を作る。
2. 参照画像を元に sky/far/mid/floor へ分解して生成する。
3. 床はシームレスな正方形テクスチャとして作る。
4. `STAGES` に新ステージ定義を追加する。
5. 床、背景、パララックスの world size と z 位置を調整する。
6. カメラで床の見え方を決める。
7. ライトより先に、素材そのものの明るさを整える。
8. 接地影、光の板、霞、粒子を足す。
9. Bloom/Bokeh/色調整を最後に薄くかける。
10. PC/SP/攻撃フェーズ固定でスクリーンショット検証する。

## 今後の改善案

現在の `src/main.tsx` は POC としては機能しますが、1ファイルに多くの責務が集まっています。拡張する場合は以下のように分けると再利用しやすくなります。

- `src/stages.ts`: ステージ定義
- `src/materials.ts`: CanvasTexture / ShaderMaterial
- `src/effects/slash.ts`: 斬撃エフェクト
- `src/effects/thrust.ts`: 突きエフェクト
- `src/scene/createStage.ts`: 背景、床、パララックス生成
- `src/scene/createCharacters.ts`: キャラ、影、接地処理
- `src/scene/postprocess.ts`: Bloom/Bokeh/色調整

また、素材生成プロンプトは今後も `public/assets/*.prompt.txt` として残すのがよいです。画像だけでは再現できませんが、プロンプトが残っていれば、同じ意図で作り直すことができます。

## まとめ

今回の POC で得た一番大きな知見は、HD-2D 風の表現は「2D素材の品質」だけで決まるのではなく、素材をどの奥行きに置くか、床をどれだけ見せるか、影と光をどう重ねるか、ポストエフェクトをどれだけ控えめにするかで決まるということです。

特に重要な再現ポイントは以下です。

- 背景を sky/far/mid/floor に分ける
- 床はシームレス正方形テクスチャにする
- カメラで床を見せすぎない
- Sprite には接地影を必ず重ねる
- ライトだけでなく光の板を置く
- 攻撃エフェクトは座標サンプリング関数を持つ
- PC/SP でカメラとポストを別にする
- スクリーンショットで視覚検証する

この流れを守ると、別ステージや別ダンジョンでも同じ考え方で再現しやすくなります。
