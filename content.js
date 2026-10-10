(async function() {
    'use strict';
    console.log("Scribd Full Page to PDF: Bắt đầu cuộn trang...");

    // 1. Cuộn tự động liên tục xuống đáy để kích hoạt lazy-load
    let lastScrollHeight = 0;
    let attempts = 0;
    
    while (attempts < 60) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        let currentScrollHeight = document.body.scrollHeight;
        if (currentScrollHeight === lastScrollHeight) {
            console.log("Đã cuộn đến cuối tài liệu.");
            break;
        }
        lastScrollHeight = currentScrollHeight;
        attempts++;
    }

    console.log("Đã cuộn xong. Giao diện đã sẵn sàng để chụp.");
    
    // Gửi thông báo cho người dùng (tùy chọn, có thể thay bằng log)
    // alert('Cuộn hoàn tất! Bắt đầu tạo PDF...');
})();