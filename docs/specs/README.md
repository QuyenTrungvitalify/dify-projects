# Specs

Development specifications cho `dify-projects`. Mỗi spec được **viết trước khi implement** để lộ ra
các quyết định thiết kế, đánh đổi, và câu hỏi còn mở.

## Spec đang sống

Chỉ những spec mô tả việc **chưa làm** mới nằm ở đây. Làm xong thì xóa — lịch sử nằm trong git.

| # | Title | Status |
|---|---|---|
| [008](008-meta-workflow-builder.md) | Meta Workflow Builder (Dify-builds-Dify auto-generator) | Parked — chỉ PoC Phase-1 landed (`templates/patterns/meta-workflow-builder.yml`); spec 009 thành đường đã ship. Revive hoặc supersede một cách tường minh |
| [021](021-builder-e2e-live-run-verification.md) | Builder E2E live-run verification (creds-gated) | Draft. Sở hữu suite browser-QA thủ công ở [`prompts/009/qa/`](prompts/009/qa/) |
| [042](042-foreign-residue-preflight.md) | Foreign-residue preflight | Draft |
| [063](063-e2e-naive-user-fidelity.md) | E2E test fidelity: chấm build như user ngây thơ, không như dev | Partially implemented — objective core đã ship (`userview`, `comprehension` jargon check). Còn slice nặng: port `NOTE_JA` (~30 frame), contract test `Chat.tsx`, LLM `next_step_clear` |
| [065](065-seed-provenance-cost-dimension.md) | Seed-provenance cost dimension | Draft — ngưỡng go/no-go chốt trước (≥20% thì làm, <10% thì bỏ) |
| [068](068-carryover-backlog.md) | Carryover backlog — nợ tồn đọng từ các spec đã xóa | Open |
| [069](069-chunk-tier-and-fragments-injection.md) | Chunk tier (`nodes: N`) + `{{FRAGMENTS}}` vào ③ | Draft — chờ review/go-ahead |
| [070](070-external-yaml-intake-base-and-distill.md) | Cửa nạp YAML ngoài: base + chưng cất trực tiếp, provenance thật | Implemented — chờ review (xóa sau khi duyệt diff) |

## Quy ước status

- `Draft` — đã viết, cần review + trả lời câu hỏi mở
- `Approved` — câu hỏi mở đã chốt, sẵn sàng implement
- `In progress` — đang implement
- `Partially implemented` — một số slice đã ship, phần còn lại nêu rõ trong dòng của nó
- `Parked` — đã viết nhưng ngủ đông; không có kế hoạch chạy
- `Superseded` — bị spec khác thay thế (link tới nó)

**Status chỉ sống ở một chỗ: header trong file spec.** Bảng trên chỉ tóm tắt.

> Trước reset 2026-07-17, status tồn tại ở **hai** nơi — header file và một bảng index — rồi chúng
> lệch nhau. Index từng ghi "059 S3 chờ chạy live" trong khi spec ghi baseline **đã điền**, và treo
> cảnh báo re-gate cho 061 dù spec 067 đã sửa xong. Một nguồn sự thật, không hai.

## Đánh số

- Spec mới bắt đầu từ **071**.
- **044 bỏ trống vĩnh viễn** — commit `18941c7` tự nhận là "spec 044" nhưng file spec chưa bao giờ
  được viết. Đừng tái dùng số này.
- Một số một spec. Trước reset có 8 vụ trùng số (009 có tới 5 file) vì spec chính bị lẫn với
  implementation-plan / fp-report / design-prompt. Nếu cần tài liệu phụ trợ, đặt nó **trong** spec
  hoặc cho nó số riêng.

## Đọc lại spec đã xóa

Reset 2026-07-17 xóa 71 spec đã hoàn thành khỏi cây. Không mất gì — chúng nằm trong git:

```bash
git show ca5e39e:docs/specs/026-authoring-gate-completeness-and-truth.md
git show ca5e39e:docs/specs/                 # liệt kê toàn bộ 77 file lúc đó
git log --oneline -- docs/specs/             # lịch sử đầy đủ
```

Việc còn nợ từ đám spec đó đã gom vào [068](068-carryover-backlog.md).

Ghi chú `spec NNN` rải trong code trỏ về những spec này. Chúng là **nhãn lịch sử** — dùng `git show`
ở trên để tra. Spec mới sẽ dần ghi đè chúng.
