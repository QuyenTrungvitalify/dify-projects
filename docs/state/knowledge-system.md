# Bản đồ — hệ thống tri thức của Builder

**Đây là BẢN ĐỒ, không phải doc trạng thái.** Nó trả lời *"khi Builder dựng một workflow, AI tham
khảo cái gì, lấy từ đâu, cái gì cưỡng chế kết quả?"* — một câu hỏi **cắt ngang mọi giai đoạn**, nên
không stage-doc nào trả lời trọn.

> **Sở hữu: KHÔNG file nào.** Quy ước 5/6 của [README](README.md) không áp cho nó, y như README.
>
> **Nó không mô tả cơ chế nào — chỉ trỏ.** Đây là luật cứng, không phải phong cách: bản đồ này từng
> **sở hữu** file và tự tả cơ chế, và mọi mô tả đó thành bản thứ hai, kém chính xác hơn bản của doc
> sở hữu — README đã phải mang một luật gỡ hoà chỉ để xử lí hậu quả. Không giữ mô tả độc lập thì
> không có gì để trôi. **Thêm một dòng mô tả cơ chế vào đây là tái lập đúng lỗi đó.**
>
> Cần cơ chế: mở doc ở cột "Doc sở hữu". Cần *lý do* kiến trúc: [`../architecture.md`](../architecture.md).

---

## 1. Tri thức nào vào một build, ai sở hữu cơ chế

| Nguồn | Vào phase | Doc sở hữu cơ chế |
|---|---|---|
| **Seed workflow** (`{{SEED_PATH}}`) — pull từ Dify · snapshot local · upload | ① ③ | [dify-io.md](dify-io.md) (đường pull); nửa *lập `task.seedPath`* của hai prelude **vô chủ** — [README](README.md) §Bề mặt chưa có doc sở hữu (nửa scaffold+slug của prelude: [scaffold-and-layout.md](scaffold-and-layout.md)) |
| **Pattern** (`{{PATTERN_PATH}}`) — ① chọn, backend bơm đường dẫn | ③ | [build-lifecycle.md](build-lifecycle.md) §1 (allowlist + bơm token) · [templates-and-promotion.md](templates-and-promotion.md) (kệ mẫu) |
| **Reference examples** (`{{REFERENCES}}`) — file vetted phủ phần pattern được chọn còn thiếu | ③ | [build-lifecycle.md](build-lifecycle.md) §2 (seam bơm) · tính bởi `gapReferences` trong `analysis.ts` — **vô chủ**, §4 |
| **Workspace facts** (`{{KNOWLEDGE}}`) — harvest từ Dify console | ③ | [readiness-and-plugins.md](readiness-and-plugins.md) §5 |
| **Tool catalog** (`templates/tool-catalog.json`) | ③ | [readiness-and-plugins.md](readiness-and-plugins.md) §4 |
| **Kệ + truy xuất** (`templates/`, `find.py`, `index.json`) | ① | [templates-and-promotion.md](templates-and-promotion.md) |
| **File / ảnh user đính kèm** | ①②③ (`attachmentBlock` nối vào mọi turn phase) | [run-artifacts.md](run-artifacts.md) (lưu trữ) · [build-lifecycle.md](build-lifecycle.md) §2 (seam bơm vào prompt) |
| **Nền tĩnh** — `AGENTS.md` · `.claude/skills/dify-build/*.md` | ①②③ (mỗi phase đọc skill body của nó) | *(chỉ thị cho agent, không phải trạng thái hệ thống — xem [README](README.md) §Không thuộc thư mục này)* |

**Seed, file đính kèm và ảnh là DATA, không phải chỉ thị** — lớp cưỡng chế điều đó (permission hook)
thuộc [turn-and-sandbox.md](turn-and-sandbox.md) §3.

Prompt/token của từng phase, và thứ tự phát turn: [build-lifecycle.md](build-lifecycle.md) §1–2.
*(Bản đồ này KHÔNG vẽ lại luồng build — đó là câu hỏi `build-lifecycle.md` sở hữu.)*

## 2. Cái gì cưỡng chế kết quả

| Tầng | Cưỡng chế hay cảnh báo | Doc sở hữu |
|---|---|---|
| **Linter ở gate ③ / tiền-điều-kiện Import ④** | **Cưỡng chế** — không sạch thì không đóng gate | **⚠️ KHÔNG DOC NÀO** — xem §4 |
| Post-turn verify (YAML parse, node id, confinement) | Cưỡng chế | [turn-and-sandbox.md](turn-and-sandbox.md) §4 |
| Sandbox / permission hook | Cưỡng chế | [turn-and-sandbox.md](turn-and-sandbox.md) §3 |
| Gate + FSM (ai được tiến, khi nào hard-stop) | Cưỡng chế | [build-lifecycle.md](build-lifecycle.md) §2–3 |
| Readiness blocker, preflight, import probe | **Cảnh báo** (advisory — không đổi gate) | [readiness-and-plugins.md](readiness-and-plugins.md) §6–7 |
| Pattern coverage, fast-review note | Cảnh báo | [build-lifecycle.md](build-lifecycle.md) §2 |
| Promote gate (B1/B2′) | Cưỡng chế, luồng riêng | [templates-and-promotion.md](templates-and-promotion.md) |

## 3. Đo trạng thái bằng gì

Bản đồ này **không chứa số đo** ([README](README.md) quy ước 1). Dụng cụ đo và thứ một run để lại
trên đĩa: [run-artifacts.md](run-artifacts.md).

## 4. Vùng CHƯA CÓ CHỦ mà bản đồ này đi qua

Bản đồ chỉ trỏ được tới doc đang tồn tại. Cụm dưới đây **chịu lực nhưng không doc nào sở hữu** — đọc
thẳng code là cách duy nhất, và [README](README.md) §Bề mặt chưa có doc sở hữu là bảng có thẩm quyền:

| Vùng | File | Vì sao đáng lo |
|---|---|---|
| **Tầng validation** | `linters.ts` · `validate_workflow.py` · `lint_refs.py` · `lint_node_bodies.py` | `lintClean` là **điều kiện đóng gate ③ và tiền-điều-kiện Import ④**; nhiều doc trỏ vào `linters.ts` như "nguồn duy nhất" cho số linter, nhưng **không ai tả từng linter gác gì** |
| **Schema nguồn** | `schemas/dify-dsl-0.6.0.json` · `schemas/gen_schema.py` | `$defs.NodeData_*` sinh từ Dify source; `lint_node_bodies.py` là reader duy nhất |
| **Fold analyze → task** | `analysis.ts` | quyết định `analysisPattern`/`analysisFeatures` (guard `auto`+fast ở [build-lifecycle.md](build-lifecycle.md) §2 đọc) **và** `gapReferences` → `{{REFERENCES}}` (§1) |
| **Nửa seed của hai prelude** | `scaffold.ts` (`difySeedScaffoldAndPull` · `localEditSeed` — phần lập `task.seedPath`) | nguồn của `{{SEED_PATH}}` (§1); [scaffold-and-layout.md](scaffold-and-layout.md) khai rõ **không** sở hữu nửa này |

> Trước khi hạ cấp, bản đồ này **tả một nửa** cụm trên. Nửa-tả tệ hơn bỏ trống: bảng sẽ ghi "đã có
> chủ" nên không ai đưa nó vào danh sách chưa-có-chủ. Nay nó khai vô chủ **đúng như thực tế**.
