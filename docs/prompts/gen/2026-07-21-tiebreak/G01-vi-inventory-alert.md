# G01 — Cảnh báo hàng sắp hết trong kho, nhắc đặt thêm (VI)

```
Kho bên mình quản lý bằng file Excel, mỗi dòng là một mặt hàng: tên hàng, số lượng còn,
mức tồn tối thiểu, nhà cung cấp.
Sáng nào mình cũng phải mở ra dò xem cái nào sắp hết, mệt lắm.
Mình muốn đưa file vào là nó chỉ ra giúp mặt hàng nào số lượng còn đã xuống dưới mức tối thiểu,
gom theo từng nhà cung cấp luôn, để mình gửi đơn đặt hàng cho gọn.
Cái nào còn đúng bằng mức tối thiểu thì cũng tính là cần đặt nhé, cho chắc.
Viết giúp mình luôn cái nội dung email đặt hàng cho từng nhà cung cấp, giọng lịch sự,
nhưng đừng gửi đi, mình xem lại đã.
```

## Bối cảnh giả định
Quản lý kho công ty VN, làm tay mỗi sáng. Ràng buộc "bằng mức tối thiểu cũng tính" và "đừng gửi đi"
là quy trình thật.

## Trục năng lực được thử
**Phá hòa finding I (mất dấu VI)** — đề VI đậm nội dung, build phải sinh prompt LLM + nhãn tiếng Việt
nhiều. Kèm: biên `<=` (bằng ngưỡng cũng tính) · group-by nhà cung cấp trong code · cấm auto-send.

## Hình dạng build tốt
start (file Excel) → document-extractor/code parse → code lọc `qty <= min` + group-by supplier →
LLM soạn email từng NCC (giọng lịch sự) → end (nháp, KHÔNG node gửi).

## Bẫy đã biết
Biên `<` vs `<=` (user dặn rõ) · cấm gửi — có node gửi mail là fail · nội dung VI trong YAML phải
CÓ DẤU · group-by rỗng khi không thiếu hàng.

## MANUAL dự kiến
File Excel thật, có ca đúng-bằng-ngưỡng · đọc email xem giọng · xác nhận 0 node gửi.
