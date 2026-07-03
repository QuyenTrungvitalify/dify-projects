# Builder corpus-test — 12 prompt (copy từng cái)

Dán từng khối vào ô input của Builder, chạy hết 3 phase, rồi gọi `/report #N`.
Chi tiết ground-truth + tiêu chí chấm: [manifest.json](manifest.json).

---

### #1 — Chinese2English · single-LLM baseline
```
中国語を英語に翻訳してくれるワークフローを作って
```

### #2 — translation_workflow · agentic dịch→review→sửa
```
翻訳の質を上げたい。一度翻訳した後、その訳を自分で見直して直す翻訳ワークフローが欲しい
```

### #3 — TitleCreator · LLM + code (nhiều title)
```
記事内容を入れたら、クリックされやすいタイトル案をいくつか出すワークフローを作りたい
```

### #4 — Jina Reader · web-fetch tool + summarize
```
URLを渡したら、そのWebページの中身を読み取って要約するワークフローが欲しい
```

### #5 — ArticleRewrite · scrape + rewrite + ảnh (STRESS)
```
あるWebページのURLを入れたら、その記事を真似て書き直して、合う画像も自動で付けるワークフローを作って
```

### #6 — Document_chat · RAG + classifier
```
アップした資料の内容について質問できるチャットボットを作りたい
```

### #7 — llm2o1 · CoT reasoning (advanced-chat)
```
普通のLLMでも、じっくり考えてから答えるように推論力を高めたチャットボットを作りたい
```

### #8 — matplotlib · code-exec chart (bẫy sandbox)
```
数値データを渡したら、Pythonでグラフを描いて画像で返すチャットを作って
```

### #9 — BookTranslate · iteration (chia nhỏ text dài)
```
長い文章や本を丸ごと翻訳できるワークフローが欲しい。長くても分割してちゃんと訳して
```

### #10 — dify_course_demo · iterative content gen
```
チュートリアルのテーマ名を入れたら、章立てから本文まで丸ごと自動生成するワークフローを作りたい
```

### #11 — memorytest · conversation memory (advanced-chat)
```
会話の内容を覚えてくれるチャットボットを作りたい。前に話したことを踏まえて返事して
```

### #12 — All-in-One Ops · orchestration lớn (MAX STRESS)
```
SNS運用をまるごと支援するワークフローが欲しい。リサーチから記事生成まで一通りやってくれる感じで
```
