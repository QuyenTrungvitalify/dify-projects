---
name: campaign
description: Run a versioned auto-test campaign against the Builder — analyze what to test, generate user-realistic prompts per docs/prompts/CHARTER.md, gate them with the human, run sequentially in the background, grade on three tiers, and emit the full paper trail (per-run reports, SUMMARY, CAMPAIGNS row). Use for "/campaign plan|run|report|recheck" or when the user asks for an automated test sweep of the Builder. The human fixes findings; this skill only tests before/after.
---

# campaign — đợt test tự sinh prompt, có version (spec 073)

Orchestrator gọi máy móc sẵn có, không thay chúng: `campaign.py` (manifest/lint/record) ·
`campaign-run.sh` (runner nền) · `e2e-run.sh` + `e2e_check.py` (oracle) · `/report` (judge).
Tiêu chí sinh đề: [docs/prompts/CHARTER.md](../../../docs/prompts/CHARTER.md). Vòng đời:

```
plan "<yêu cầu>" [--n N] → [GATE người duyệt] → chốt → run → report → (người fix) → recheck
```

Luật xuyên suốt (bài học v0.1.0, KHÔNG thương lượng):
- oracle thrash = **denied-calls**, không phải turn;
- chỉ so **cùng model** — khác model ghi N/A, không kết luận cost;
- finding **n=1** chỉ được ghi "cần thêm mẫu", cấm chữ "fix ngay";
- **fail hạ tầng** (mạng/quota) tách khỏi fail chất lượng, không tính vào tỉ lệ đạt;
- **người fix, máy test** — skill không bao giờ tự sửa code Builder theo finding.

## `plan "<yêu cầu đợt test>" [--n N]`

1. Đọc 3 nguồn, GIAO với yêu cầu nhập (yêu cầu là chính, 3 nguồn là gợi ý):
   `apps/builder/CHANGELOG.md` (hành vi đổi từ đợt trước = trục nhắm) ·
   `docs/prompts/runs/CAMPAIGNS.md` mục để-ngỏ (nghi vấn cần thêm mẫu — nêu rõ n hiện tại) ·
   bản đồ phủ `docs/prompts/README.md` (trục chưa test).
2. Chọn N: user cho `--n` thì theo; không thì đề xuất từ số trục tìm được (ghi rõ cách ra số, user
   chỉnh ở gate). Cảnh báo ngân sách: mỗi đề 2–4 turn thật, ~8–13 phút.
3. Tạo `docs/prompts/gen/<YYYY-MM-DD-slug>/`:
   - `campaign.yml` — theo schema dưới, `status: draft`, `builder_version` từ
     `apps/builder/package.json`, `git_sha` = `git rev-parse --short HEAD`;
   - từng đề `G##-<slug>.md` đúng giải phẫu 5 mục CHARTER. Đề edit-existing phải khai
     `project`/`workflow` trong manifest (harness cần `fire --workflow`).
4. `campaign.py lint <dir>` — đề trượt thì viết lại đến sạch (ghi lại đề nào bị thay, vì sao).
5. Trình: bảng {đề × trục × vì sao} + TOÀN VĂN từng đề + ước lượng turn → **DỪNG**. Nói rõ:
   "sửa/xóa file trực tiếp trong `gen/<id>/` rồi ra lệnh chốt".

```yaml
# campaign.yml
id: 2026-07-25-ketoan-cs
request: |            # nguyên văn yêu cầu đợt test của user
builder_version: "0.2.0"
git_sha: 9dabc51
status: draft         # draft → approved (campaign.py approve) — run từ chối draft
prompts:
  - file: G01-congno.md
    axis: 2-file + code-not-LLM
    why: biến thể mới của trục P05
    mode: auto
    project: null     # chỉ đề edit-existing mới có
    workflow: null
    status: pending   # pending → done|error (campaign.py record)
    task_ids: []      # giữ MỌI attempt, kể cả lần lỗi
```

## Chốt (gate — chỉ chạy khi user ra lệnh)

1. `campaign.py approve <dir>` (tự re-lint bản user đã sửa; bẩn thì báo, không lật status).
2. Commit `gen/<id>/` — MỘT commit, message `test(campaign): freeze <id> (N đề, Builder vX)`.
   Thời điểm commit này là lúc đề bị đóng băng — sau đó KHÔNG sửa đề nữa (sửa = mất recheck).

## `run <id>`

1. Backend phải đang chạy (`cd apps/builder && npm start`). `campaign.py verify` sẽ chặn version
   lệch — lệch thì HỎI user (retarget hay hủy), không tự quyết.
2. Chạy nền: `apps/builder/scripts/campaign-run.sh docs/prompts/gen/<id>/` với
   `run_in_background: true` — TUYỆT ĐỐI không lặp fire/wait bằng tool call trực tiếp (một build
   8–13 phút, vượt timeout tool; runner tự fire → wait → record → đề kế tiếp).
3. Khi được đánh thức (script xong) đọc kết cục: `campaign.py status <dir>`.
   - `🏁 settled` → sang report.
   - `🛑 dừng vì lỗi kép` → báo user nguyên nhân (TRIAGE trong task.json), phần còn lại `pending`;
     resume = chạy lại chính script khi nguyên nhân đã xử lý (quota reset, backend sống lại…).

## `report <id>` — chấm ba tầng, độ tin giảm dần, không tầng nào bị bỏ im lặng

Với TỪNG đề đã settle (đọc `task_ids`/`results` trong manifest):

1. **Cơ học** (tất định — từ manifest + run dir), với 3 bước BẮT BUỘC không được bỏ:
   - 4 linter · comprehension — nhưng comprehension ghi **"PASS (EN-only scan)"**, không PASS trần
     (gate chỉ quét bản EN; đợt quiz-gen PASS 3/3 *chính vì* notes sai ngôn ngữ);
   - `failed_split` từng phase (record đã tách deny≈/errored≈): **so `denied` với mốc** — 0–2 sạch,
     ≥7 nghi thrash phải mổ transcript; `errored` là self-correct, đọc riêng, không cộng vào thrash;
   - `workflow_files`/`extra_workflow_files_unlinted` trong results: có extra → report PHẢI nêu
     "file X chưa qua linter, notes không nhắc" (lớp finding A, đợt quiz-gen).
   Cùng tầng: lang-sync (digest đúng ngôn ngữ đề — đọc analyze.json) · model+turn.
2. **Judge trong SUBAGENT context sạch** (spec 073 §2.6): spawn Agent với prompt CHỈ chứa
   (a) nguyên văn đề, (b) taskId + đường artifact, (c) chỉ thị chạy đúng thủ tục `/report` — chấm
   theo requirement. KHÔNG đưa mục Bẫy/Hình-dạng-tốt của file đề cho judge (judge phải chấm như
   người thật đọc kết quả, không biết đề gài gì); các mục đó dùng ở bước 4.
3. **MANUAL**: gom mục "MANUAL dự kiến" của đề + mọi thứ 2 tầng trên không phủ — liệt kê tường
   minh trong report.
4. **Đối chiếu bẫy** (chính phiên này làm, sau khi judge trả): soi build với mục *Bẫy đã biết* /
   *Hình dạng tốt* — bẫy dính hay tránh, ghi thành finding-ứng-viên.

**0. HÀNH TRÌNH NGƯỜI DÙNG (spec 075 S2 — kể TRƯỚC phần chấm).** Chạy
`campaign.py journey <taskId>` → JSON từng phase. Report của run PHẢI mở đầu bằng khối hành trình,
vì đây là thứ user thật trải qua, không phải cấu trúc YAML:

```
① Analyze — chờ <working_ms/1000>s · <model> <turns>t · denied≈/errored≈
   User ĐỌC (nguyên văn digest): "<user_read>"
   → hiểu đúng ý user không? nêu điểm mơ hồ không?
② Spec — chờ …s · … · Build tự cam kết <N> tiêu chí nghiệm thu (liệt kê nguyên văn acceptance_criteria)
③ Implement — chờ …s · … · <change> (workflow mới / +A/-B dòng)
④ Test — 4 linter · criteria_check (mỗi tiêu chí: auto_pass/auto_fail/manual) · notes user ĐỌC nguyên văn
Tổng: <total_ms/1000>s
```

Luật: **trích nguyên văn** digest/criteria/notes (diễn giải lại = mất cái đang đo). `criteria_check`
rỗng ⇒ run từ backend trước-075 (nêu rõ, đừng lặng lẽ bỏ). Thời gian chờ là số user cảm nhận nhất.

Rồi mới tới 3 tầng chấm ở trên, và sinh sổ sách (format hiện hành — xem file mẫu trong `docs/prompts/runs/`):
- report từng run `docs/prompts/runs/<ngày>-G##-<taskId>.md` — **mở đầu bằng khối hành trình §0**, rồi
  bảng phase model/turn/denied, verdict 3 tầng, lỗi gặp, MANUAL còn nợ;
- `<ngày>-SUMMARY.md` cho đợt + **một dòng** vào bảng CAMPAIGNS.md — cột **Pass (cơ học)** lấy
  nguyên văn từ `campaign.py summary <dir>` (spec 086: thuần manifest, không LLM; đây là số so
  được máy-với-máy giữa các đợt, KHÔNG thay tầng judge);
- danh sách finding: mỗi cái mang nhãn số mẫu (`n=1` → "cần thêm mẫu"), loại (chất lượng / hạ tầng
  / propensity — lần lỗi đầu của đề retry-pass là propensity, tiền lệ P05), và bằng chứng
  (taskId + số đo);
- đề xuất bump version NẾU có finding→fix — chỉ là đề xuất, user quyết.

## `recheck <id>` — sau khi USER đã fix (máy chỉ test trước/sau)

1. Input: các đề có finding (mặc định) hoặc user chỉ định. Đọc version hiện tại — thường ĐÃ khác
   version ghim (đó là lẽ tồn tại của recheck): cập nhật `builder_version` trong manifest theo
   xác nhận của user rồi chạy lại các đề đó **nguyên văn** qua runner (đề khác giữ nguyên status).
2. Bảng trước/sau cùng-đề: {oracle cơ học cũ ↔ mới, verdict cũ ↔ mới}, mỗi cột ghi rõ
   version + model — khác model thì ô cost ghi N/A.
3. Ghi vào SUMMARY đợt gốc, mục "## Recheck sau fix" — KHÔNG mở campaign mới; cập nhật dòng
   CAMPAIGNS nếu kết cục đổi.

## Chống lỗi đã biết

- Đừng tin turn count cho bất kỳ so sánh nào — denied-calls đã nằm sẵn trong `results`.
- Đừng chấm bằng chính phiên đã sinh đề mà không qua subagent — judge biết bẫy sẽ chấm lệch.
- Đừng sửa đề sau khi chốt (kể cả sửa lỗi chính tả) — recheck mất nghĩa.
- Runner dừng vì lỗi kép ≠ campaign hỏng: phần lớn là quota; đợi rồi chạy lại script là xong.
- Report cho đề error-cả-2-lần: ghi "không hoàn thành (hạ tầng/propensity)", KHÔNG đưa vào mẫu số
  tỉ lệ đạt chất lượng.
