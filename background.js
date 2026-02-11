// ============================================================
// AI Context Compressor — background.js (Service Worker)
// Handles message passing and teleport coordination
// ============================================================

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // Teleport: copy text + open target AI platform
    if (request.action === 'teleport') {
        const urls = {
            chatgpt: 'https://chatgpt.com/',
            claude: 'https://claude.ai/new',
            gemini: 'https://gemini.google.com/app',
            copilot: 'https://copilot.microsoft.com/'
        };

        const targetUrl = urls[request.target];
        if (!targetUrl) {
            sendResponse({ success: false, error: 'Unknown target' });
            return;
        }

        // Store the compressed text for the content script to pick up
        chrome.storage.local.set({
            pendingTeleport: {
                text: request.text,
                target: request.target,
                timestamp: Date.now()
            }
        }, () => {
            // Open the target AI in a new tab
            chrome.tabs.create({ url: targetUrl }, (tab) => {
                sendResponse({ success: true, tabId: tab.id });
            });
        });

        return true; // async response
    }

    // Scrape: ask the content script on the active tab to scrape
    if (request.action === 'requestScrape') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) {
                sendResponse({ success: false, error: 'No active tab' });
                return;
            }

            chrome.tabs.sendMessage(tabs[0].id, { action: 'scrape' }, (response) => {
                if (chrome.runtime.lastError) {
                    sendResponse({
                        success: false,
                        error: 'Cannot scrape this page. Navigate to ChatGPT, Claude, or Gemini first.'
                    });
                } else {
                    sendResponse({ success: true, data: response });
                }
            });
        });

        return true; // async response
    }
});

// Clean up expired teleport data (older than 5 minutes)
chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.get('pendingTeleport', (result) => {
        if (result.pendingTeleport && Date.now() - result.pendingTeleport.timestamp > 300000) {
            chrome.storage.local.remove('pendingTeleport');
        }
    });
});
