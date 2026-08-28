# Builder — hướng dẫn dùng


## 0. Bắt đầu sử dụng thử ngay
> 　

1. Mở app, chọn một trong hai cách:
   - Hoặc mở Terminal ở thư mục dự án rồi gõ: `bash scripts/update-and-run.command`
   - Vào Finder, thư mục `dify-projects/scripts/`, **double-click** `update-and-run.command`
     (Windows: `update-and-run.bat`).
2. Một cửa sổ Terminal hiện ra và chạy vài chục giây và luôn run dưới local. **Đừng đóng nó** — đóng là tắt app.
3. Trình duyệt tự mở **http://127.0.0.1:4123**. Nếu không tự mở, bạn gõ địa chỉ đó vào trình duyệt.
4. Ở ô nhập giữa màn hình, gõ điều bạn muốn tạo workflow ví dụ:
   *"Nhận một đoạn văn, trả về bản tóm tắt 3 câu."*
5. Bấm `送信` (gửi). Máy bắt đầu làm và dừng lại ở từng chặng để hỏi ý bạn.
6. Bấm nút xanh ở mỗi chặng để đi tiếp — tên nút đổi theo chặng:

   | Chặng | Bấm nút |
   |---|---|
   | ① Đọc yêu cầu xong | `仕様へ進む` |
   | ② Viết xong bản mô tả | `この仕様で実装` |
   | ③ Dựng xong file | `テストへ進む` |
   | ④ Kiểm xong | `Dify にインポート` nếu đã config key của môi trường dify — hoặc `インポートせず完了` nếu chưa muốn gửi sang Dify |

7. Xong xem báo cáo và các file ở panel bên phải từ menu 成果物.

---

## 1. Tổng quan màn hình

> 【画像】Toàn màn hình: sidebar trái, vùng hội thoại giữa, panel `成果物` bên phải

Màn hình có ba phần: **danh sách bên trái**, **vùng hội thoại ở giữa** (bạn gõ ở đây), và
**panel `成果物`** (thành phẩm) bên phải — mở ra khi đã có file để xem.

Mọi lần dựng đều đi qua **4 chặng**, và dừng lại chờ bạn ở cuối mỗi chặng:

| | Chặng | Máy làm gì |
|---|---|---|
| ① | `分析` | Đọc yêu cầu, tìm mẫu tương tự |
| ② | `仕様` | Viết ra bản mô tả: cái này sẽ làm gì |
| ③ | `実装` | Dựng file thật |
| ④ | `テスト` | Kiểm file có chạy được không |

Chỗ dừng đó gọi là *cổng*. Ở cổng, không có gì chạy tiếp cho tới khi bạn bấm.

---

## 2. Cột bên trái

> 【画像】Sidebar mở đủ 5 khối, con trỏ trên nút `+` của khối `ビルド`

| Khối | Chứa gì | Nút `+` |
|---|---|---|
| `進行中` | Những lần dựng đang chạy hoặc đang chờ bạn bấm | — |
| `チャット` | Các cuộc hỏi đáp thường, không dựng gì cả | `新規チャット` — mở cuộc hỏi mới |
| `パターン` | Kho khuôn mẫu dùng lại cho lần sau | `外部YAMLを追加` — nạp file từ ngoài vào |
| `ビルド` | Các workflow bạn đã dựng, kèm lịch sử từng lần | `新規タスク` — bắt đầu dựng mới |
| `プロジェクト` | Các thư mục bạn tự tạo để xếp việc | `新規プロジェクト` — tạo thư mục mới |

Rê chuột lên một dòng trong `ビルド` sẽ hiện nút bút chì `新しい会話で編集` và nút xoá.

---

## 3. Dựng một cái mới

> 【画像】Ô nhập với đủ 5 chip bên dưới và nút `送信` bên phải

Dưới ô nhập có 5 ô nhỏ; để nguyên vẫn chạy được. Ba ô `ワークフロー` `作成先` `高速ビルド` chỉ chọn được trước khi gửi, `モデル` và `確認` đổi được giữa chừng.

| Chip | Để làm gì |
|---|---|
| `モデル` | Chọn máy nào làm việc. Cứ để mặc định. |
| `ワークフロー` | Sửa cái đã có, hay dựng mới. `なし（新規）` = dựng mới. |
| `作成先` | Thư mục sẽ chứa cái sắp dựng. `Drafts` = vùng nháp, chưa xếp vào đâu. |
| `確認` | `各ステップ` dừng ở cả 4 chặng · `仕様のみ` chỉ dừng ở ② · `自動` chạy một mạch không dừng |
| `高速ビルド` | `オン` thì gộp ① và ② làm một, nhanh và rẻ hơn, hợp với việc nhỏ |

Nút kẹp giấy để đính kèm file. Dưới ô nhập là `ベースにする` — các app sẵn có trong Dify của bạn.
Khi máy dừng lại chờ bạn, ngoài nút đi tiếp còn có ba nút:

| Nút | Bấm khi |
|---|---|
| `修正を依頼` | Muốn máy **sửa lại** — lượt này file sẽ đổi. Mũi tên `⌄` cạnh nút cho chọn cách: `すぐ直す` (sửa luôn rồi cho xem) hoặc `先に計画を見せて` (nói trước sẽ đổi gì, bạn duyệt rồi mới sửa — tốn thêm **1 lượt chạy**) |
| `質問を送信` | Chỉ muốn **hỏi cho rõ** — máy trả lời, **không sửa gì**. Đây là nút mặc định. |
| `仕様を修正` | (chặng ②) Muốn tự tay sửa bản mô tả ở panel bên phải |

---

## 4. Sửa cái đã có

> 【画像】Chip `ワークフロー` đang mở, danh sách các workflow đã có

Ba cách, kết quả như nhau:

| Cách | Ở đâu |
|---|---|
| Chọn ở chip `ワークフロー` | Màn hình bắt đầu |
| Bấm nút bút chì `新しい会話で編集` | Rê chuột lên một dòng trong khối `ビルド` |
| Bấm `編集（新規）` | Ở cuối một cuộc đã xong |

Chọn xong thì gõ điều muốn sửa rồi gửi như thường. Nếu cái đó đã có sẵn bản mô tả và file,
màn hình sẽ báo `③ 実装から開始` — nghĩa là bỏ qua ① và ②, vào thẳng dựng, đỡ tốn thời gian.

Nếu workflow đó còn một cuộc đang dở, màn hình hiện một dòng nhắc kèm nút `開く` để bạn quay
lại cuộc cũ thay vì mở cuộc mới.

---

## 5. Đưa vào kho dùng lại

> 【画像】Modal `外部ワークフローYAMLを追加` với hai lựa chọn ở mục `用途`

YAML — file mô tả workflow, giống bản thiết kế mà Dify đọc được.

Kho `パターン` chứa các khuôn mẫu để những lần dựng sau tham khảo. Có hai đường vào:

| Đường | Từ đâu | Làm gì |
|---|---|---|
| `パターンに昇格` | Nút ở đầu một cuộc đã xong | Đưa **một** workflow — chính cái của cuộc đó — thành khuôn mẫu |
| `外部YAMLを追加` | Nút `+` của khối `パターン` | Nạp một file YAML từ bên ngoài |

Ở cửa `外部YAMLを追加`, mục `用途` bắt bạn chọn trước:

| Chọn | Kết quả |
|---|---|
| `パターン棚に蒸留` | Rút thành khuôn mẫu cho kho |
| `取り込んで編集` | Cất file vào thư mục của bạn (mặc định `Drafts`) rồi mở ra sửa luôn |

**Dễ nhầm:** `パターン棚に蒸留` **không** đưa file vào thư mục của bạn — nó chỉ tạo khuôn mẫu,
và chỉ lưu khi bạn bấm duyệt ở cổng. Muốn sửa chính file đó thì chọn `取り込んで編集`.

---

## 6. Những thứ còn lại

> 【画像】Panel `成果物` mở tab `main.yml`, thấy rõ ba tab và nút `エクスポート`

| Thứ | Ở đâu | Để làm gì |
|---|---|---|
| `相談` | Khối `チャット` | Hỏi đáp thường, không dựng gì, không tốn một lần dựng |
| Tab `仕様` | Panel `成果物` | Bản mô tả: cái này sẽ làm gì. Sửa tay được. |
| Tab `main.yml` | Panel `成果物` | File thật. Xem được cả bản so sánh với lần trước. |
| Tab `レポート` | Panel `成果物` | Kết quả kiểm ở chặng ④ |
| `エクスポート` | Header | Tải về hoặc share hồ sơ quá trình dựng: diễn biến từng chặng, dòng thời gian. |
| `停止` / `ビルドを破棄` | Header | Kết thúc lần dựng. Cùng **một nút**, đổi mặt theo tình trạng — xem bên dưới |
| `Dify にインポート` | Cổng chặng ④ | Gửi sang Dify của bạn |
| `フェーズ完了通知` | Nút chuông trên đầu | Báo khi xong một chặng — **chỉ khi bạn đang ở tab khác**. Bật rồi không thấy thì trình duyệt đang chặn, cho phép trong cài đặt trang. |
| Nút cập nhật | Trên đầu sidebar | Tải bản mới của Builder rồi tự khởi động lại |

**Nút kết thúc có hai mặt, hậu quả khác nhau** (hộp thoại nói rõ trước khi xác nhận): bấm lúc **đang chạy** → `停止`, **tiến độ chặng đó bị bỏ**;
bấm lúc **đang dừng chờ bạn** → `ビルドを破棄`, bản mô tả và file **vẫn còn**, mở lại lần dựng đó được.

**Dễ nhầm:** `Dify にインポート` **tạo một app mới** trong Dify đã được config các key của dify. Bấm lại lần nữa **từ cùng lần
dựng đó** thì app vừa tạo được cập nhật, không sinh thêm. Nhưng nó không bao giờ ghi đè lên
một app khác mà bạn đã có sẵn.

---

## 7. Từ ngữ hay gặp

| Từ | Nghĩa |
|---|---|
| `ワークフロー` | Một quy trình đã dựng xong — thứ bạn sẽ chạy trong Dify |
| YAML | File mô tả workflow, giống bản thiết kế mà Dify đọc được |
| `ベース` | Cái có sẵn dùng làm điểm xuất phát, thay vì dựng từ số không |
| `パターン` | Khuôn mẫu trong kho, để những lần dựng sau tham khảo |
| `蒸留` | Rút một file thật thành khuôn mẫu |
| `プロジェクト` | Thư mục bạn tự tạo để xếp các workflow |
| `Drafts` | Vùng nháp — nơi mọi thứ rơi vào khi bạn chưa chọn thư mục nào |
| Cổng | Chỗ máy dừng lại chờ bạn bấm, ở cuối mỗi chặng |
