document.getElementById('startBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || (!tab.url.includes('scribd.com/document/') && !tab.url.includes('/embeds/'))) {
        alert('Vui lòng mở một trang tài liệu Scribd cụ thể!');
        return;
    }

    document.getElementById('startBtn').disabled = true;
    document.getElementById('cancelBtn').disabled = false;
    document.getElementById('status').innerText = 'Đang khởi tạo...';
    document.getElementById('progressBar').value = 0;

    chrome.runtime.sendMessage({ action: "startCapture", tabId: tab.id, tabUrl: tab.url, tabTitle: tab.title });
});

document.getElementById('cancelBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "cancelCapture" });
    resetUI("Đã hủy bởi người dùng");
});

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "updateProgress") {
        const percent = Math.round((request.current / request.total) * 100);
        document.getElementById('progressBar').value = percent;
        document.getElementById('status').innerText = request.message || `Đang xử lý trang ${request.current}/${request.total}`;
    } else if (request.action === "finishCapture") {
        resetUI("Hoàn tất! Đã tải file PDF.");
    } else if (request.action === "errorCapture") {
        resetUI(`Lỗi: ${request.message}`);
    }
});

function resetUI(msg) {
    document.getElementById('startBtn').disabled = false;
    document.getElementById('cancelBtn').disabled = true;
    document.getElementById('status').innerText = msg;
}