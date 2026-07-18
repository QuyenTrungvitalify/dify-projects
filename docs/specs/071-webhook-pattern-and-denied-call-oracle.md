# Spec 071 — Webhook pattern + denied-call oracle: hoàn tất tầng tri thức node và cổng đo đúng trục

**Status**: Draft (2026-07-17 — tổng hợp từ điều tra run 44-turn; phần nền `--dump-schema` đã ship)
**Effort**: S1 = S · S2 = S · S3 = XS–S · S4 = XS (optional) — tổng ≈ S–M
**Depends on**: `a124695` (`--dump-schema`, đã ship) · `a1f7ca3` (`{{REFERENCES}}`, đã ship) ·
spec 050/052 (luồng promote, đã ship — nhãn lịch sử: `git show ca5e39e:docs/specs/050-*.md`)

---

## 1. Bối cảnh — sự cố và những gì ĐÃ sửa

Một build `trigger-webhook` (run manual `1784278684526`, bundle người dùng export) tốn **44 turn ở ③**,
trong đó 13 lần `grep`/`rg` bị sandbox chặn, file schema 182KB bị `Read` 3 lần, và cuối cùng agent
suy ngược schema từ source của `lint_node_bodies.py`. Build ra **đúng** (4 linter sạch, Dify nhận
file) — đây là bài toán **chi phí**, không phải chất lượng.

**Nguyên nhân gốc (chẩn đoán thứ 4, đã kiểm chứng — 3 cái đầu sai, xem §5)**: agent biết đáp án nằm
trong `schemas/dify-dsl-0.6.0.json` (7.704 dòng, def ở ~dòng 6.687) nhưng **không có đường được phép
nào để trích một `$def`** — `grep`/`rg` bị chặn, `python -c` bị chặn, probe script bị chặn. Nó còn
đoán đúng tên công cụ cần có: gọi `--dump-schema` và `--help` khi cả hai chưa tồn tại.

**Đã ship** (không thuộc spec này, liệt kê để spec tự chứa):

| Commit | Nội dung | Kết quả đo |
|---|---|---|
| `a124695` | `lint_node_bodies.py --dump-schema <node-type>` — in `NodeData_*` def, 1 lệnh được phép; type sai → exit 2 **kèm danh sách type hợp lệ** | bị chặn 13→1 · đọc 182KB 9→0 · wall-clock 765.9s→520.7s |
| `3cd44d9`/`504cd8a` | suite entry `trigger-per-row-chatwork` (Pull) + `webhook-per-row-chatwork` (Push, repro tất định) | baseline lưu ở `e2e-baselines.json` |
| `a1f7ca3` | `{{REFERENCES}}` — backend tiêm pattern phủ gap vào prompt ③ | grep bị chặn 25→0 trên nhánh schedule |

**Còn hụt — spec này**: (a) tầng *ví dụ sống* cho webhook chưa có → ③ vẫn tốn 23–27 turn thay vì ~15
như nhánh schedule có pattern; (b) cổng cost của suite **đo sai trục** — baseline 22-call-lỗi vẫn lọt
`implement_turns_max: 30` (23 turn) vì nhiều call lỗi nén vào một turn; oracle thật là **số call bị
từ chối**, chưa có predicate nào đếm.

**Bằng chứng bổ sung — đợt test 7 prompt 2026-07-18** (`docs/prompts/runs/`): xác nhận nguyên nhân
bằng oracle đúng (grep-denied, **cùng model Haiku**), 5 mẫu sạch vs 2 thrash:

| entry | pattern? | ③ grep-denied |
|---|---|---|
| schedule/chatflow/workflow (P01·P03·P06·P10) | ✅ có | **0–2** |
| webhook (P04) | ❌ không | **7** |
| webhook (P11, chạy Opus[1m] — chứng phụ) | ❌ không | 17 |

Hai nhiễu bộ đo phát hiện trong đợt (chi tiết `docs/prompts/runs/METERING-RELIABILITY.md`): (1) **turn
đo SAI TRỤC** — cùng-Haiku P04 vs P01 turn 16 vs 22 (ngược!) trong khi grep-denied 7 vs 2 (đúng) →
predicate S2 PHẢI đếm denied-call, không phải turn; (2) **model không pin** — thrash mạnh → CLI nhảy
`opus-4-8[1m]`, nên chỉ so cùng model.

## 2. Nguyên tắc thiết kế (giữ khi implement)

- **Schema và pattern là hai tầng tri thức khác nhau, không thay nhau.** Schema = hợp đồng field
  (cái gì qua linter); pattern = ví dụ sống (giá trị thật, nối dây, GOTCHA sự cố như `Asia/Tokyo`,
  `X-ChatWorkToken`+`no-auth`). Run sau-fix vẫn đọc 2 pattern *dù đã có* `--dump-schema`.
- **Pattern sinh từ build đã chứng minh, không viết tay từ trí nhớ** — pattern viết tay sẽ thành
  `node_types.md` thứ hai (doc đó dạy `trigger-webhook` có field `variables:` không tồn tại; vì
  `NodeData_*` không đặt `additionalProperties:false`, shape sai import sạch rồi **chết lúc runtime**).
- **Không nới ranh giới sandbox.** Mọi slice dưới đây thuần dữ liệu/harness/doc.

## 3. Slices

### S1 — Promote build webhook đã chứng minh thành `templates/patterns/webhook-per-row-notify.yml` (S)

Nguồn: `projects/_drafts/gas_dify_webhook_post_2/workflows/main.yml` (run `1784284165018` — 4 linter
sạch, qua suite entry) — đối chiếu chéo với build manual `d_t_llm_chatwork_7` (run `1784278684526`,
Dify đã nhận file thật). **Lưu ý `_drafts/` gitignored** — nếu đã bị dọn, bắn lại
`e2e-run.sh fire --entry webhook-per-row-chatwork` để tái sinh, hoặc lấy từ bundle zip người dùng giữ.

Đi qua đúng luồng gate promote của repo (spec 050/052 — `promote_gate.py` / nút promote trên task
done / `/template-promote` cho corpus). Yêu cầu nội dung:

- Generalize: bỏ nội dung ChatWork-cụ-thể thành `# TODO:` marker theo phong cách pattern hiện có;
  giữ shape: `trigger-webhook` (`method: post` · `content_type: application/json` ·
  `status_code: 200` · body params `rows_json`/`id_map_json`/`today`) → code parse phòng thủ →
  if-else/lọc trong code → iteration(`error_handle_mode: continue-on-error`) { llm → http POST } →
  aggregator → end.
- `# GOTCHA:` header (tiền lệ `per-row-notify.yml`): (1) webhook nhận **string JSON** — parse trong
  code node, phòng `None`/rỗng; (2) custom auth header cần `authorization: {type: no-auth}` + token
  trong `headers:` qua env secret; (3) trigger phải ENABLE trong Quick Settings mới tự chạy;
  (4) `today` nhận từ caller, fallback JST trong code — không bao giờ naive `now()`.

**Đồng bộ đếm — `test_docs_drift.py` sẽ ĐỎ nếu quên** (đây là feature, không phải phiền toái):
README.md + AGENTS.md + `docs/architecture.md`: "10 patterns" → **11** (cả ba phải khớp) ·
rebuild INDEX (43 → **44**) · README `~43 template` → `~44`.

AC-S1: `find.py --has trigger` liệt kê pattern mới · pre-commit 13/13 · pytest xanh (kể cả
`test_docs_drift`, `test_pattern_consistency`).

### S2 — Predicate `denied_calls_max` trong `e2e_check.py` (S)

Cổng đo đúng trục. Đếm số tool-call **bị từ chối/lỗi** của một phase từ transcript
(`apps/builder/.runs/<id>/transcripts/<phase>.md` — dòng `^- <Tool>  <arg>  ✗`; parser mẫu có sẵn:
`run-transcript.ts` re-parse chính format này, và `test_e2e_check.py` đã có fixture sanitized).

- Vocabulary: `cost.denied_calls_max: {implement: N}` hoặc phẳng `implement_denied_max: N` — chọn
  theo phong cách vocabulary hiện có ("kept tiny on purpose").
- Không có transcript (run cũ / capture tắt) → **MANUAL, không bao giờ false-PASS** (tiền lệ pre-059).
- Gắn vào 2 entry: `webhook-per-row-chatwork` và `trigger-per-row-chatwork`, ngưỡng đề xuất
  `implement ≤ 5` (đo thực: run lành 0–3 ✗ lặt vặt; run bệnh 13–25).
- Unit test trong `tests/test_e2e_check.py` với fixture transcript có N dấu ✗ — một ca PASS, một ca
  FAIL, một ca thiếu transcript → MANUAL.

AC-S2: chấm lại run `1784283101507` (baseline bệnh, 13 denied) bằng entry đã thêm predicate →
**AUTO-FAIL** đúng dòng mới; run `1784284165018` (sau fix, 1 denied) → PASS. Cả hai run còn
transcript trên đĩa — nếu mất, §6 tái hiện lại được.

### S3 — Khoá feature theo biến thể trigger trong `build_index.py` (XS–S)

Run 44-turn đã gõ **đúng truy vấn** `find.py --has trigger-webhook` và nhận "No matching templates".
Thêm khoá **cộng thêm** (giữ nguyên `has_trigger` họ): `has_trigger_webhook` / `has_trigger_schedule`
/ `has_trigger_plugin`, computed như `has_trigger` (không đụng `INTERESTING_NODE_TYPES`). Sau S1,
truy vấn đó trả về pattern webhook.

Lưu ý phạm vi: **không** kỳ vọng cải thiện `{{REFERENCES}}`/gap — ① khai khoá họ `trigger` (5/5 run)
và quyết định Pull-vs-Push nằm ở ②. Slice này phục vụ đường **③ tự tra** (`find.py`) là chính.

AC-S3: `find.py --has trigger-webhook` trả pattern mới · `--list-features` liệt kê khoá mới ·
`test_sources_registry`/`test_pattern_consistency` xanh.

### S4 (optional) — `find.py` phân biệt "feature không tồn tại" với "0 kết quả" (XS)

Bài học từ `--dump-schema`: type sai → exit 2 + danh sách hợp lệ. `find.py --has <key-không-có>`
hiện im lặng "No matching templates" — không phân biệt được gõ sai với thật sự không có mẫu (chính
điều này đẩy run 44-turn sang grep). Feature key không nằm trong tập `has_*` của index → thông báo
riêng + danh sách key hợp lệ (exit code giữ tương thích script nếu có consumer).

AC-S4: `--has trigger-webook` (typo) chỉ ra lỗi + gợi ý; unit test.

### S5 (mới — từ đợt test 2026-07-18) — tra plugin theo NĂNG LỰC (S)

Hai build độc lập grep tìm plugin theo *việc cần làm* và không có đường tra được phép: P11 grep 10
lần tìm STT (`whisper|speech2text|transcribe|audio`), P01 tìm Sheets/Search tool. `find.py` tra
*workflow pattern*, không tra *plugin/tool theo năng lực*. Cần một đường được-phép trả lời "workspace
/marketplace có tool làm việc X không" — vd `marketplace.py --capability <kw>` hoặc mở rộng
`find.py --tool <kw>` đọc `templates/tool-catalog.json`. Cùng họ nguyên nhân với S3/S4 (đường tra bị
im lặng → agent rơi sang grep bị chặn).

AC-S5: một lệnh được-phép trả về tool khớp năng lực (hoặc "không có" rõ ràng, không im lặng); unit test.

## 4. Tái hiện (repro) — chạy được bởi bất kỳ phiên nào

**Repro tất định** (không phụ thuộc may rủi Pull-vs-Push — prompt ép Push):

```bash
# backend đang chạy (cd apps/builder && npm start), claude đăng nhập, jq có sẵn
apps/builder/scripts/e2e-run.sh fire --entry webhook-per-row-chatwork   # → {taskId}
apps/builder/scripts/e2e-run.sh wait <taskId>
apps/builder/scripts/e2e-run.sh check <taskId> --expect webhook-per-row-chatwork
apps/builder/scripts/e2e-run.sh time <taskId>
```

**Đọc oracle** (quan trọng: turn KHÔNG phải oracle — nhiều call lỗi nén vào 1 turn):

```bash
T=apps/builder/.runs/<taskId>/transcripts/implement.md
sed -n '/^### Tool calls/,/^### Result/p' $T | grep -c '✗'                       # tổng call lỗi
sed -n '/^### Tool calls/,/^### Result/p' $T | grep -E '^- Bash +(grep|rg|find)' | grep -c '✗'  # săn bị chặn
grep -c 'dump-schema' $T                                                          # có dùng đường đúng?
sed -n '/^### Tool calls/,/^### Result/p' $T | grep -E '^- Read.*dify-dsl' | grep -c '✓'        # nuốt 182KB?
```

**Chữ ký đo được** (mốc so):

| Run | Điều kiện | ③ turn | call lỗi | săn bị chặn | đọc 182KB | tổng |
|---|---|---|---|---|---|---|
| `1784278684526` (manual) | trước mọi fix | 44 | 24/68 | 13 | 3×Read | — |
| `1784283101507` (baseline suite) | trước `--dump-schema` | 23 | 22/48 | 13 | 9 refs | 765.9s |
| `1784284165018` (sau fix) | có `--dump-schema` | 27 | 7/26 | 1 | 0 | 520.7s |
| kỳ vọng sau S1 | + pattern webhook | ~15 | ≤5 | 0–1 | 0 | ~500s |

Giả lập bệnh **không tốn build** (kiểm S2 nhanh): transcript của `1784283101507` còn ở
`apps/builder/.runs/1784283101507/` — chấm offline bằng `check ... --expect` sau khi thêm predicate.

**Mốc lịch sử**: mọi spec đã retire đọc bằng `git show ca5e39e:docs/specs/<file>`; điều tra đầy đủ
nằm trong message các commit `a01f8f1` (node_types.md sai) và `a124695` (nguyên nhân gốc).

## 5. Ba chẩn đoán SAI đã loại (đừng đi lại)

1. *"Thiếu pattern webhook nên phải thêm ngay"* — sai vai: agent đọc `per-row-notify` rồi vẫn kẹt vì
   thiếu **hợp đồng field**, không phải thiếu ví dụ iteration. (Pattern đúng vai ở S1 = tầng tăng
   tốc, sau khi sàn `--dump-schema` đã có.)
2. *"Tách khoá feature trigger sẽ giúp gap/REFERENCES"* — ① luôn khai khoá họ `trigger`, và
   Pull-vs-Push quyết ở ②. (S3 giữ lại chỉ cho đường `find.py` của ③.)
3. *"Agent không biết schema ở đâu"* — nó đọc file schema 18 lần. Vấn đề là **trích**, không phải **tìm**.

## 6. Non-goals

- Không nới sandbox (không thêm `grep` vào allow-set — `--dump-schema` + pattern đã triệt nhu cầu).
- Không sửa `skills/mango-svip/references/node_types.md` — clone ngoài, `setup.sh` ghi đè; cảnh báo
  trong SKILL.md + `tests/test_node_schema_source.py` đã canh (test này **tự đỏ** nếu upstream sửa,
  để gỡ cảnh báo thay vì thành truyền thuyết).
- Không auto-promote — promote luôn human-gated (spec 050 B5, blank-model…).

## 7. Open questions

- OQ1 — Tên pattern: `webhook-per-row-notify.yml` (đề xuất, đối xứng `per-row-notify`) hay
  `webhook-fetchless-notify`? Người promote chốt.
- OQ2 — Ngưỡng `denied_calls_max` cho entry khác ngoài 2 entry trigger: áp toàn suite hay chỉ nơi
  đã đo? Đề xuất: chỉ 2 entry đã có mốc đo, mở rộng khi có số.
- OQ3 — S4 có đáng đổi exit code của `find.py` không (consumer script hiện coi exit 0 = chạy được)?
  Đề xuất: thông báo stderr + giữ exit 0 cho "0 kết quả", exit 2 chỉ khi key không tồn tại.
