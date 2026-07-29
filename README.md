# VOX STYLE VIDEO

Web app để xây brief, kịch bản, storyboard, keyframe và voice master cho video editorial paper-collage.

## Chạy local

Yêu cầu Node.js 20 trở lên.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Mở `http://localhost:4173`.

`npm run dev` chạy đồng thời Vite frontend ở cổng 4173 và API backend ở cổng
4174. API key chỉ được đọc từ `.env.local` trên backend.

## AI providers

- DeepSeek tạo kịch bản theo context. Có thể chuyển sang template cục bộ.
- Coachio GPT Image 2 tạo keyframe, gồm upload tối đa 5 ảnh reference, submit
  task, polling và nhận ảnh kết quả.
- Gemini Nano Banana 2 có thể chạy trực tiếp hoặc tự động fallback khi Coachio
  thất bại.
- ElevenLabs tạo voice master MP3. Voice ID tiếng Việt và tiếng Anh được chọn
  trong Settings.

Model, resolution, fallback và Voice ID được lưu cục bộ trong trình duyệt.
Secret không được gửi lại cho frontend.

## Kiểm tra trước khi push

```bash
npm test
npm run build
```

## Chạy production

```bash
npm run build
npm start
```

Backend sẽ phục vụ cả API và thư mục `dist` tại `http://localhost:4173`.

## Tính năng

- Cấu hình tỷ lệ 9:16, 1:1 hoặc 16:9.
- Độ dài 30 giây, 1 phút hoặc 3 phút.
- Chọn ngôn ngữ, audience, mục tiêu và cấu trúc kể chuyện.
- Nạp tối đa 6 ảnh reference, gán vai trò và ghi chú khóa identity.
- Tạo kịch bản nháp theo beat, chỉnh trực tiếp trước khi duyệt.
- Tạo style prompt, keyframe prompt và image-to-video prompt nhất quán.
- Copy prompt từng beat và nạp lại keyframe đã tạo.
- Hiển thị storyboard đúng tỷ lệ 9:16, 1:1 hoặc 16:9.
- Tạo hàng loạt tối đa 5 keyframe mỗi lượt, theo dõi trạng thái và thử lại riêng
  ảnh bị lỗi.
- Tạo kịch bản AI bằng DeepSeek với template dự phòng.
- Sinh keyframe bằng Coachio GPT Image 2 hoặc Gemini Nano Banana 2.
- Nghe thử voice-over bằng Web Speech và tạo MP3 bằng ElevenLabs.
- Nạp tên file voice master và xuất toàn bộ prompt pack dạng Markdown.
- Tự lưu nhiều dự án bằng localStorage, phân loại bản nháp, đang làm và đã xong.
- Xuất file `.vox.json`, nhập lại để tiếp tục dự án trên cùng hoặc máy khác.
- Hướng dẫn quy trình image-to-video, thông số khóa và checklist QA trước khi
  ghép video.
- Hỗ trợ giao diện sáng, tối và responsive.

## Lưu ý

DeepSeek được yêu cầu không thêm claim ngoài context, nhưng người dùng vẫn phải
kiểm chứng dữ kiện trước khi duyệt storyboard. Sinh ảnh và voice có thể phát
sinh chi phí từ nhà cung cấp.

Ảnh reference upload được chuyển thành data URL và lưu trong localStorage.
Trình duyệt có giới hạn dung lượng, vì vậy chỉ nên dùng ảnh ref đã nén cho dự
án thực tế. Ảnh sinh bởi Gemini được lưu trong thư mục `generated` của backend
để dự án có thể mở lại sau khi tải trang.

Nút tạo hàng loạt có thể khởi chạy tối đa 5 request sinh ảnh và phát sinh chi
phí. Kiểm tra model, resolution và fallback trong Settings trước khi bấm.

## Chuẩn bị git push phiên bản đầu

Project nằm trong folder `vox-style-video` của repository hiện tại:

```bash
git add vox-style-video
git commit -m "feat: ship VOX STYLE VIDEO v1"
git remote add origin <YOUR_REPOSITORY_URL>
git push -u origin main
```

Nếu repository đã có remote, bỏ qua lệnh `git remote add origin`.
