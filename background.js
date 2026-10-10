try {
    importScripts('./jspdf.umd.min.js');
} catch (e) {
    console.error("Không thể load jsPDF:", e);
}

let isCancelled = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startCapture") {
        isCancelled = false;
        handleCaptureProcess(request.tabId, request.tabUrl, request.tabTitle);
    } else if (request.action === "cancelCapture") {
        isCancelled = true;
    }
});

async function notifyPopup(action, data = {}) {
    try {
        await chrome.runtime.sendMessage({ action, ...data });
    } catch (e) {
        // Bỏ qua nếu Popup bị đóng
    }
}

async function handleCaptureProcess(tabId, tabUrl, tabTitle) {
    let targetTabId = tabId;
    const match = tabUrl.match(/https:\/\/www\.scribd\.com\/document\/(\d+)\//);

    if (match) {
        const docId = match[1];
        const embedUrl = `https://www.scribd.com/embeds/${docId}/content`;
        await chrome.tabs.update(targetTabId, { url: embedUrl });
        
        await new Promise((resolve) => {
            function listener(tId, changeInfo) {
                if (tId === targetTabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            }
            chrome.tabs.onUpdated.addListener(listener);
        });
    }

    const debuggee = { tabId: targetTabId };
    try {
        await chrome.debugger.attach(debuggee, "1.3");
        await chrome.debugger.sendCommand(debuggee, "Page.enable");

        const viewportWidth = 900;
        const viewportHeight = 1200;

        await chrome.debugger.sendCommand(debuggee, "Emulation.setDeviceMetricsOverride", {
            width: viewportWidth,
            height: viewportHeight,
            deviceScaleFactor: 2,
            mobile: false
        });

        notifyPopup("updateProgress", { current: 0, total: 100, message: "Đang tải tài liệu vào DOM..." });

        // Tự động cuộn xuống đáy để ép tải đầy đủ tất cả các trang
        await chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            func: async () => {
                const toolbarTop = document.querySelector('.toolbar_top');
                if (toolbarTop) toolbarTop.remove();
                const toolbarBottom = document.querySelector('.toolbar_bottom');
                if (toolbarBottom) toolbarBottom.remove();

                const style = document.createElement('style');
                style.innerHTML = `
                    body { background-color: #ffffff !important; }
                    .outer_page {
                        margin: 10px auto !important;
                        display: block !important;
                        float: none !important;
                    }
                `;
                document.head.appendChild(style);

                let previousCount = 0;
                let attempts = 0;
                while (attempts < 60) {
                    window.scrollTo(0, document.body.scrollHeight);
                    await new Promise(r => setTimeout(r, 800));
                    const currentCount = document.querySelectorAll('.outer_page').length;
                    if (currentCount === previousCount && currentCount > 0) break;
                    previousCount = currentCount;
                    attempts++;
                }
                window.scrollTo(0, 0);
                await new Promise(r => setTimeout(r, 1000));
            }
        });

        if (isCancelled) { await chrome.debugger.detach(debuggee); return; }

        const setupResult = await chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            func: () => document.querySelectorAll('.outer_page').length
        });

        const totalPages = setupResult[0].result;
        if (!totalPages || totalPages === 0) {
            notifyPopup("errorCapture", { message: "Không tìm thấy trang nào!" });
            await chrome.debugger.detach(debuggee);
            return;
        }

        const pageImages = [];

        // Vòng lặp chụp tuần tự có áp dụng Dynamic Wait và Retry tối đa 3 lần
        for (let i = 0; i < totalPages; i++) {
            if (isCancelled) {
                await chrome.debugger.detach(debuggee);
                return;
            }

            notifyPopup("updateProgress", { current: i + 1, total: totalPages, message: `Đang chụp trang ${i + 1} / ${totalPages}` });

            let success = false;
            let screenshotData = null;
            let attempts = 0;

            while (!success && attempts < 3) {
                try {
                    attempts++;
                    // Cuộn đến trang cần chụp
                    await chrome.scripting.executeScript({
                        target: { tabId: targetTabId },
                        func: (index) => {
                            const pageElements = document.querySelectorAll('.outer_page');
                            if (pageElements[index]) {
                                pageElements[index].scrollIntoView({ behavior: 'auto', block: 'start' });
                            }
                        },
                        args: [i]
                    });

                    // Dynamic Wait: Kiểm tra thông minh xem ảnh bên trong trang đã load xong nét chưa (tối đa 3 giây)
                    await chrome.scripting.executeScript({
                        target: { tabId: targetTabId },
                        func: async (index) => {
                            const pageElements = document.querySelectorAll('.outer_page');
                            if (!pageElements[index]) return;
                            const imgs = pageElements[index].querySelectorAll('img');
                            const startTime = Date.now();
                            while (Date.now() - startTime < 3000) {
                                let allLoaded = true;
                                for (let img of imgs) {
                                    if (!img.complete || img.naturalHeight === 0) {
                                        allLoaded = false;
                                        break;
                                    }
                                }
                                if (allLoaded && imgs.length > 0) break;
                                await new Promise(r => setTimeout(r, 100));
                            }
                        },
                        args: [i]
                    });

                    // Chụp ảnh màn hình khung nhìn
                    const screenshotResult = await chrome.debugger.sendCommand(debuggee, "Page.captureScreenshot", {
                        format: "jpeg",
                        quality: 92
                    });

                    if (screenshotResult && screenshotResult.data) {
                        screenshotData = screenshotResult.data;
                        success = true;
                    }
                } catch (err) {
                    console.warn(`Lỗi ở trang ${i + 1}, đang thử lại lần ${attempts}...`, err);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            if (success && screenshotData) {
                // Đã xóa bỏ chrome.storage.local.set ở đây để tránh tràn bộ nhớ
                pageImages.push(screenshotData);
            } else {
                throw new Error(`Không thể chụp trang ${i + 1} sau 3 lần thử.`);
            }
        }

        await chrome.debugger.detach(debuggee);

        if (pageImages.length > 0) {
            notifyPopup("updateProgress", { current: totalPages, total: totalPages, message: "Đang tổng hợp file PDF..." });
            await generateSinglePDF(pageImages, tabTitle);
            notifyPopup("finishCapture");
        } else {
            notifyPopup("errorCapture", { message: "Không chụp được trang nào." });
        }

    } catch (err) {
        console.error("Lỗi tiến trình:", err);
        notifyPopup("errorCapture", { message: err.message || "Lỗi không xác định" });
        try { await chrome.debugger.detach(debuggee); } catch(e) {}
    }
}

async function generateSinglePDF(base64Images, docTitle) {
    if (!self.jspdf) {
        console.error("Thư viện jsPDF chưa sẵn sàng!");
        return;
    }

    const { jsPDF } = self.jspdf;
    const pdf = new jsPDF('p', 'mm', 'A4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < base64Images.length; i++) {
        if (i > 0) pdf.addPage();
        const imgDataUrl = `data:image/jpeg;base64,${base64Images[i]}`;
        pdf.addImage(imgDataUrl, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    }

    const pdfOutput = pdf.output('datauristring');
    const safeTitle = (docTitle || "scribd_document").replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `${safeTitle}.pdf`;
    
    chrome.downloads.download({
        url: pdfOutput,
        filename: fileName,
        saveAs: true
    });
}