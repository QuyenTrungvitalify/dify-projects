# Spec 073 — `/campaign`: đợt test tự sinh prompt theo yêu cầu, có version

**Status**: Draft (2026-07-20 — từ tổng kết campaign v0.1.0 chạy tay + 3 góp ý định hướng của user)
**Effort**: S1 = M · S2 = S–M · S3 = M · S4 = S — tổng ≈ M–L, chia lát độc lập
**Đóng spec**: qua `/spec-close` (docs/specs/README.md) như mọi spec.

---

## 1. Bối cảnh

Campaign v0.1.0 (12 prompt, 2026-07-18) chạy hoàn toàn bằng tay: người viết 12 đề, người bắn từng
`e2e-run.sh fire`, người đọc oracle, người viết 12 report + SUMMARY + CAMPAIGNS row. Kết quả tốt
(5 finding → v0.2.0) nhưng tốn ~2 ngày và mọi bước đều dựa trí nhớ người vận hành — các bài học đo
lường (turn ≠ oracle, model không pin, n=1 không kết luận) chỉ nằm trong doc, không được máy cưỡng chế.

Mục tiêu: tự động hóa vòng **phân tích yêu cầu test → sinh prompt → NGƯỜI xác nhận → chạy theo plan
→ chấm đa tầng → report**, sao cho kết quả đánh giá đúng và so được giữa các đợt.

## 2. Nguyên tắc (chốt từ góp ý user — giữ khi implement)

1. **Prompt thuộc về đợt, không ép so-cùng-đề giữa version.** Mỗi campaign sinh bộ prompt riêng theo
   yêu cầu nhập vào. So sánh giữa version diễn ra ở tầng **chỉ số tổng hợp** (bảng CAMPAIGNS). Vòng
   hồi quy duy nhất bắt buộc: sau khi fix finding của đợt N → `recheck` chạy lại **nguyên văn** các
   prompt đã lộ lỗi của đợt N (S4). P01–P12 là kho tái sử dụng khi thấy hợp, không phải tầng bắt buộc.
2. **Charter hiện thực, không khóa văn phong.** Dự án phục vụ mọi loại bài toán Dify; tiêu chí sinh đề
   là **bài toán cụ thể có thật, đáng để một người thật cần giải** — không phải "test cho có".
   Persona/domain/ngôn ngữ đa dạng và đi theo yêu cầu nhập của đợt (văn phòng JP, kế toán VN, CS,
   HR, kho vận…). Bất biến duy nhất: giọng user không-biết-Dify (kể việc, không kể giải pháp;
   có ràng buộc nghiệp vụ thật; có chỗ mơ hồ tự nhiên) + **linter chống lộ nghề** với blocklist
   RIÊNG của charter — blocklist comprehension hiện có chặn jargon *đầu ra Builder* (`plugin hash`,
   `preflight`…), không phủ từ-giải-pháp mà user thật không gõ; charter cần danh sách của mình:
   `webhook / node / workflow / trigger / API / DSL / dataset / LLM / prompt / フロー / ノード /
   トリガー`… (chốt đủ khi viết CHARTER.md; mượn được phần giao với comprehension).
3. **Số lượng và trục là INPUT, khung là cố định.** `/campaign plan "<yêu cầu đợt test>" [--n N]` —
   N nhập tay hoặc suy từ nội dung yêu cầu (đề xuất trong plan, user chỉnh ở gate). Khung 5 bước
   không đổi; tham số (số đề, trục, retry, ngân sách turn) linh hoạt theo từng đợt.
4. **Gate người trước khi chạy.** Plan + toàn văn prompt trình user duyệt/sửa; duyệt xong mới commit
   và mới được fire. Không đường auto nào vượt gate này.
5. **Bài học đo lường thành luật máy**, không phải trí nhớ: oracle thrash = denied-calls (không phải
   turn) · chỉ so cùng model, khác model ghi N/A · finding 1 mẫu bị dán nhãn `n=1` và không được sinh
   đề xuất "fix ngay" · fail hạ tầng (mạng/quota) tách khỏi fail chất lượng, không tính vào tỉ lệ đạt.
6. **Tách vai đến mức khả thi**: build luôn là subprocess riêng (sẵn có). Sinh đề và điều phối cùng
   một phiên là chấp nhận được vì có gate người ở giữa; nhưng **chấm (S3 tầng 2) chạy trong subagent
   context sạch** — chỉ nhận requirement + artifact, không mang ngữ cảnh sinh đề/run, để judge không
   biết "đề này sinh ra nhằm bẫy gì" mà chấm theo đúng những gì user sẽ thấy.
7. **Version ghim hai lần**: `plan` ghi `builder_version` (+ `git_sha`) vào manifest; `run` đối chiếu
   lại — lệch thì DỪNG hỏi người (test tiếp trên version mới, hay hủy plan) chứ không chạy im lặng.
   `recheck` (S4) ghi version MỚI của lần chạy lại — bảng trước/sau luôn mang cặp version tường minh.

## 3. Luồng chuẩn

```
/campaign plan "yêu cầu"  →  [GATE user duyệt/sửa]  →  /campaign run <id>  →  /campaign report <id>
                                                              ↓ (sau khi fix finding)
                                                       /campaign recheck <id>
```

## 4. Slices

### S1 — Charter + `plan` (sinh đề, dừng ở gate) (M)

- `docs/prompts/CHARTER.md`: tiêu chí hiện-thực (§2.2) + giải phẫu file prompt (khối đề fenced +
  4 mục người-chấm: Bối cảnh giả định / Trục năng lực / Hình dạng tốt / Bẫy đã biết / MANUAL) +
  danh sách linter tự kiểm (jargon-check, có-ràng-buộc-thật, có-mơ-hồ).
- `/campaign plan "<yêu cầu>" [--n N]`:
  1. Phân tích 3 nguồn: CHANGELOG diff từ đợt trước (hành vi mới đổi = trục nhắm) · CAMPAIGNS mục
     để-ngỏ (nghi vấn cần thêm mẫu) · bản đồ phủ docs/prompts/README (trục chưa test) — GIAO với
     yêu cầu nhập vào (yêu cầu là chính, 3 nguồn là gợi ý bổ sung).
  2. Sinh `docs/prompts/gen/<campaign-id>/campaign.yml` (version test, trục, prompt list, retry
     policy, ngân sách turn) + các file `P##-*.md` đủ giải phẫu.
  3. Tự chạy linter charter trên từng đề; đề trượt bị thay, ghi lý do.
  4. In ma trận {đề × trục × lý do} và toàn văn đề → **DỪNG chờ user**. `<campaign-id>` =
     `YYYY-MM-DD-<slug-yêu-cầu>`.

- **Cơ chế duyệt**: manifest có trường `status: draft`. User sửa/xóa đề bằng edit file trực tiếp,
  rồi ra lệnh chốt → linter chạy lại trên bản đã sửa, `status` lật thành `approved`, commit
  `gen/<id>/` (đề + manifest) trong một commit — thời điểm commit ĐÓ là lúc đề bị đóng băng.

AC-S1: chạy `plan` với một yêu cầu mẫu → ra N đề đúng giải phẫu, 0 đề dính charter-blocklist,
`status: draft`, chưa fire, chưa commit; sau lệnh chốt → linter re-run, `approved`, một commit chứa
trọn bộ đề; `run` trên manifest còn `draft` phải bị từ chối.

### S2 — `run` (tuần tự, quota-aware) (S–M)

- **Vòng chạy là SCRIPT nền** (`campaign-run.sh`), không phải vòng lặp hội thoại: một build 8–13
  phút vượt timeout một lệnh tool, nên phiên điều phối chỉ khởi động script (background) + theo dõi;
  script tự fire → wait → ghi kết quả → đề kế tiếp.
- Đọc `campaign.yml` đã duyệt (`status: approved` — còn `draft` thì từ chối chạy) + đối chiếu
  version (§2.7).
- Fire tuần tự qua `e2e-run.sh` (turn lock buộc tuần tự), mỗi run ghi {taskId, model từng phase,
  denied-calls, lint, thời gian} về `campaign.yml` qua `campaign.py record`.
- Lỗi (bất kể loại — phân loại hạ-tầng/propensity là việc của `report`, script không đoán): retry
  đúng 1 lần, **giữ cả hai taskId**; retry vẫn lỗi → **DỪNG CẢ ĐỢT** (không đốt các đề còn lại vào
  quota có thể đã cạn — không có API nào cho biết giờ reset, nên không "chờ tự động"), phần còn lại
  nằm `pending`. Verdict của đề = kết quả lần retry; lần 1 thành finding mang nhãn số mẫu ở report
  (tiền lệ P05 đợt v0.1.0).
- **Resume = chạy lại chính script** — nó tự bỏ qua đề đã settle, không cần cờ riêng.

AC-S2: một campaign 2 đề chạy trọn không cần người; kill giữa chừng rồi chạy lại script không
fire lại đề đã xong; task.json mỗi run có đủ model từng phase; run trên manifest `draft` bị từ chối.

### S3 — `report` (chấm ba tầng + tự sinh sổ sách) (M)

- Tầng 1 cơ học (tất định): 4 linter · comprehension · denied-calls · lang-sync · deliveredFeature.
- Tầng 2 `/report <taskId>`: chấm theo requirement (ground truth chỉ tham chiếu phụ).
- Tầng 3 MANUAL: gom mục "MANUAL dự kiến" của từng đề + những gì hai tầng trên không phủ —
  **liệt kê tường minh, không lặng lẽ bỏ** (hợp đồng gốc /e2e).
- Sinh: report từng run (`docs/prompts/runs/<ngày>-P##-<taskId>.md`, format hiện hành) + SUMMARY đợt
  + **một dòng CAMPAIGNS.md** + danh sách finding (mỗi finding gắn nhãn số mẫu; n=1 → "cần thêm mẫu").
- Đề xuất bump version CHỈ là đề xuất — người quyết.

AC-S3: chạy trên kết quả S2 → đủ bộ sổ sách trên; finding n=1 không có chữ "fix"; fail hạ tầng
không nằm trong tỉ lệ đạt; ô so sánh khác-model ghi N/A.

### S4 — `recheck` (vòng hồi quy sau fix) (S)

- Input: campaign-id + (mặc định) các đề có finding; chạy lại **nguyên văn** đề đó trên code mới,
  đối chiếu same-prompt: {oracle cũ ↔ mới, verdict cũ ↔ mới} thành bảng trước/sau.
- Ghi kết quả vào SUMMARY đợt gốc (mục "Recheck sau fix") — không mở campaign mới.

AC-S4: với một finding đã fix, `recheck` cho ra bảng trước/sau cùng-đề cùng-model; nếu model khác
thì bảng ghi rõ và không kết luận hơn/kém về cost.

### S5 — Cải thiện sau đợt nghiệm thu `2026-07-20-quiz-gen` (chưa làm)

Đợt thật đầu tiên (3/3 xong, happy-path ổn) lộ 5 việc, xếp theo giá trị:

1. **`record`/`report` bỏ giả định 1-file** — gặt mọi `workflows/*.yml` của build (cùng gốc
   finding A của đợt; phần Builder-side là fix riêng của người dùng).
2. **Phân loại `✗` + ngưỡng tự động**: `✗` hiện trộn gate-deny với lệnh-chạy-fail (G01 ③: 11✗ =
   ~7 săn + 4 vòng self-correct linter). `record` nên đếm tách hai loại (transcript có chữ lý do
   deny để phân biệt), và `report` PHẢI so denied với mốc (0–2 sạch / ≥7 thrash) thay vì chỉ ghi số
   — đợt này 19✗ của G01 nằm trong sổ mà không ai truy cho tới vòng đánh giá quy trình.
3. **Nhãn trung thực cho comprehension**: gate chỉ quét bản EN → report ghi "PASS (EN-only scan)",
   không ghi PASS trần — đợt này PASS 3/3 *chính vì* notes sai ngôn ngữ (finding B).
4. **`campaign.py init`** sinh khung manifest (safe-dump ngay từ đầu) — manifest viết tay đã dính
   lớp lỗi `#N`-thành-comment một lần.
5. **Diễn tập nhánh lỗi rẻ**: retry/double-error-stop/resume/busy-lock **chưa từng chạy thật**
   (đợt nghiệm thu 0 lỗi). Một lần drill backend-tắt (không đốt turn) trước khi tin đợt lớn.

Ghi chú chi phí: judge context sạch ~40k token/đề — đợt 12 đề ≈ nửa triệu token riêng tầng judge;
guide cần dòng cân nhắc.

## 5. Non-goals

- Không chạy song song nhiều build (turn lock của Builder là ràng buộc kiến trúc).
- Không auto-fix finding, không auto-bump version, không auto-commit prompt khi chưa qua gate.
- Không thêm đường network mới cho turn (mọi phân tích/sinh đề chạy ở phiên điều phối, không phải
  trong sandbox build).
- Không thay `/e2e` hay `/report` — `/campaign` là orchestrator gọi chúng, không nuốt chúng.

## 6. Open questions

- OQ1 — `docs/prompts/gen/<id>/` giữ vĩnh viễn hay dọn sau khi đợt đóng? Đề xuất: giữ (đề đã chạy
  là bằng chứng đối chiếu, xóa là mất khả năng recheck); dung lượng text không đáng kể.
- OQ2 — ngân sách turn mặc định trong manifest: cứng (vd 40 turn/đợt) hay chỉ cảnh báo? Đề xuất:
  cảnh báo ở plan + dừng-chờ ở run, không hard-fail.
- OQ3 — `plan` có nên tự đề xuất subset P01–P12 kèm theo khi yêu cầu đợt trùng trục cũ? Đề xuất: có,
  như gợi ý ở gate (user gạch đi được) — tái dùng đề cũ rẻ hơn sinh mới và so được với đợt trước.
