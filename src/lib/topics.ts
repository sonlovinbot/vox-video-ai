/**
 * Thư viện chủ đề gợi ý cho VOX style.
 *
 * Danh sách tĩnh chứ không gọi AI mỗi lần mở bảng: mở ra là thấy ngay, không
 * tốn tiền và không phụ thuộc mạng. Nút "Làm mới bằng AI" ở trong bảng dành cho
 * khi user muốn hướng khác hẳn.
 *
 * Tiêu chí chọn: chủ đề có CHUỖI VẬN HÀNH nhìn thấy được — thứ paper-collage
 * dựng tốt vì mỗi công đoạn thành một lớp giấy. Chủ đề thuần cảm xúc hoặc thuần
 * số liệu không hợp phong cách này.
 */

export interface TopicCategory {
  id: string;
  label: string;
  blurb: string;
  titles: string[];
}

export const TOPIC_CATEGORIES: TopicCategory[] = [
  {
    id: "ecommerce",
    label: "Thương mại điện tử",
    blurb: "Chuỗi vận hành từ lúc bấm mua tới lúc nhận hàng.",
    titles: [
      "Hành trình đơn hàng 39k",
      "Vì sao freeship lại không miễn phí",
      "Một cú hoàn hàng đi qua bao nhiêu khâu",
      "Kho phân loại xử lý triệu đơn thế nào",
      "Đánh giá 5 sao được tạo ra từ đâu",
      "Flash sale rẻ được nhờ điều gì",
      "Vì sao hàng từ nước ngoài về nhanh hơn tưởng",
      "Cách sàn quyết định hiện sản phẩm nào cho bạn",
      "Tiền của bạn nằm ở đâu trước khi người bán nhận",
      "Một mã giảm giá tốn của ai bao nhiêu",
    ],
  },
  {
    id: "logistics",
    label: "Vận tải và chuỗi cung ứng",
    blurb: "Đường đi của hàng hoá, container và con người.",
    titles: [
      "Một container đi vòng quanh thế giới",
      "Vì sao tắc kênh đào làm tăng giá đồ ăn",
      "Shipper chạy một ngày ra sao",
      "Cảng biển hoạt động lúc nửa đêm",
      "Hàng lạnh giữ nhiệt suốt hành trình bằng cách nào",
      "Vì sao xăng tăng thì mọi thứ tăng",
      "Bưu kiện thất lạc đi đâu",
      "Kho tự động vận hành không cần đèn",
      "Chuyến bay chở hàng khác gì chở khách",
      "Đường sắt hàng hoá quay lại vì lý do gì",
    ],
  },
  {
    id: "money",
    label: "Tiền và tài chính cá nhân",
    blurb: "Dòng tiền chảy qua các định chế, giải thích bằng lớp giấy.",
    titles: [
      "Tiền trong tài khoản bạn thực ra nằm ở đâu",
      "Một lần quẹt thẻ đi qua bao nhiêu bên",
      "Lạm phát ăn mòn lương thế nào",
      "Vì sao ngân hàng trả lãi cho bạn",
      "Bảo hiểm kiếm tiền bằng cách nào",
      "Lãi kép nhìn bằng hình ra sao",
      "Vay mua nhà 20 năm thực sự trả bao nhiêu",
      "Tỷ giá thay đổi thì ai được lợi",
      "Thuế của bạn đi những đâu",
      "Vì sao giá vàng và lãi suất đi ngược nhau",
    ],
  },
  {
    id: "tech",
    label: "Công nghệ hằng ngày",
    blurb: "Thứ ai cũng dùng nhưng ít ai biết bên trong.",
    titles: [
      "Tin nhắn của bạn đi qua những đâu",
      "Wifi yếu vì lý do gì",
      "Một bức ảnh lên mây trong bao lâu",
      "Pin điện thoại chai theo cách nào",
      "Video tải nhanh nhờ thứ gì",
      "Mật khẩu được lưu ra sao",
      "Bản đồ biết đường tắc bằng cách nào",
      "Cuộc gọi video nén hình thế nào",
      "Vì sao app cập nhật liên tục",
      "Trung tâm dữ liệu làm mát ra sao",
    ],
  },
  {
    id: "food",
    label: "Thực phẩm và nông nghiệp",
    blurb: "Từ ruộng tới bàn ăn, mỗi khâu một lớp giấy.",
    titles: [
      "Ly cà phê sáng đi từ đâu tới",
      "Vì sao rau sạch đắt hơn",
      "Một quả trứng qua bao nhiêu khâu",
      "Sữa tươi giữ được bao lâu và nhờ gì",
      "Gạo Việt đi ra thế giới thế nào",
      "Đồ ăn nhanh nấu nhanh nhờ điều gì",
      "Vì sao trái cây trái mùa vẫn có",
      "Nước mắm truyền thống làm ra sao",
      "Thực phẩm thừa của thành phố đi đâu",
      "Vì sao giá thịt lợn lên xuống thất thường",
    ],
  },
  {
    id: "city",
    label: "Đô thị và hạ tầng",
    blurb: "Thành phố vận hành nhờ những hệ thống không ai thấy.",
    titles: [
      "Nước sạch tới vòi nhà bạn bằng đường nào",
      "Rác của thành phố đi đâu",
      "Đèn giao thông quyết định nhịp thế nào",
      "Vì sao thành phố ngập dù cống lớn",
      "Điện đi từ nhà máy tới ổ cắm",
      "Metro chạy đúng giờ nhờ điều gì",
      "Toà nhà cao tầng đứng vững ra sao",
      "Vì sao đường vừa làm đã đào lại",
      "Không khí thành phố bẩn từ đâu",
      "Một khu chợ vận hành lúc 3 giờ sáng",
    ],
  },
  {
    id: "health",
    label: "Sức khoẻ và cơ thể",
    blurb: "Cơ chế sinh học kể được bằng lớp cắt giấy.",
    titles: [
      "Giấc ngủ sửa chữa cơ thể thế nào",
      "Vì sao stress làm đau dạ dày",
      "Một viên thuốc đi tới chỗ đau bằng cách nào",
      "Vaccine dạy cơ thể ra sao",
      "Cơ bắp lớn lên lúc nào",
      "Đường ảnh hưởng cơ thể theo đường nào",
      "Vì sao ngồi lâu hại hơn tưởng",
      "Mắt cận đi theo cơ chế gì",
      "Vi khuẩn đường ruột làm việc gì",
      "Cơ thể phản ứng thế nào khi nhịn ăn",
    ],
  },
  {
    id: "energy",
    label: "Năng lượng và môi trường",
    blurb: "Dòng năng lượng và hệ quả, dựng thành sơ đồ giấy.",
    titles: [
      "Điện mặt trời hoạt động ra sao",
      "Pin xe điện tái chế thế nào",
      "Vì sao gió lại làm ra điện",
      "Một chai nhựa mất bao lâu để biến mất",
      "Nhiệt điện than để lại những gì",
      "Nước thải được xử lý qua mấy bước",
      "Vì sao nắng nóng đô thị gay gắt hơn",
      "Rừng giữ carbon bằng cách nào",
      "Xe điện thực sự sạch hơn ở điểm nào",
      "Lưới điện cân bằng cung cầu ra sao",
    ],
  },
  {
    id: "media",
    label: "Truyền thông và mạng xã hội",
    blurb: "Cơ chế phân phối nội dung, thứ ai cũng chịu tác động.",
    titles: [
      "Thuật toán quyết định bạn thấy gì",
      "Một video viral lan theo đường nào",
      "Quảng cáo tìm đúng bạn bằng cách nào",
      "Tin giả lan nhanh hơn tin thật vì sao",
      "Nhà sáng tạo kiếm tiền từ đâu",
      "Vì sao lướt mãi không dứt ra được",
      "Một xu hướng ra đời thế nào",
      "Dữ liệu của bạn bị bán ra sao",
      "Vì sao ai cũng làm video ngắn",
      "Nút thích thay đổi hành vi thế nào",
    ],
  },
  {
    id: "work",
    label: "Nghề nghiệp và cách làm việc",
    blurb: "Quy trình nghề nghiệp, phù hợp kể theo từng công đoạn.",
    titles: [
      "Một CV đi qua những vòng nào",
      "Lương được quyết định bởi ai",
      "Vì sao họp nhiều mà ít việc xong",
      "Một sản phẩm đi từ ý tưởng tới cửa hàng",
      "Làm việc từ xa đổi thứ gì trong công ty",
      "Vì sao nghề này biến mất còn nghề kia sinh ra",
      "Một ngày của người vận hành kho",
      "Startup tiêu tiền nhà đầu tư ra sao",
      "Vì sao deadline luôn trễ",
      "Kỹ năng nào máy chưa thay được",
    ],
  },
];

/** Nhãn cover hay dùng nhất cho video giải thích. */
export const COVER_LABELS = [
  "GIẢI THÍCH",
  "HÀNH TRÌNH",
  "CƠ CHẾ",
  "SỰ THẬT",
  "PHÂN TÍCH",
  "BÊN TRONG",
  "VÌ SAO",
];
