// ============================================================
// AI Context Compressor — content.js
// Injected into AI chat platforms to scrape & teleport
// ============================================================

(function () {
    'use strict';

    // ========== PLATFORM DETECTION ==========
    const hostname = window.location.hostname;
    let platform = 'unknown';

    if (hostname.includes('chat.openai.com') || hostname.includes('chatgpt.com')) {
        platform = 'chatgpt';
    } else if (hostname.includes('claude.ai')) {
        platform = 'claude';
    } else if (hostname.includes('gemini.google.com')) {
        platform = 'gemini';
    } else if (hostname.includes('copilot.microsoft.com')) {
        platform = 'copilot';
    }

    // ========== PLATFORM-SPECIFIC SCRAPERS ==========
    const scrapers = {

        chatgpt: () => {
            const messages = [];

            // Strategy 1: data-message-author-role attribute
            const roleEls = document.querySelectorAll('[data-message-author-role]');
            if (roleEls.length > 0) {
                roleEls.forEach(el => {
                    const role = el.getAttribute('data-message-author-role');
                    const textEl = el.querySelector('.markdown, .whitespace-pre-wrap') || el;
                    const text = textEl.innerText.trim();
                    if (text) {
                        messages.push({
                            role: role === 'user' ? 'USER' : 'ASSISTANT',
                            content: text
                        });
                    }
                });
                return messages;
            }

            // Strategy 2: article elements (conversation turns)
            const articles = document.querySelectorAll('article[data-testid]');
            if (articles.length > 0) {
                articles.forEach((article, i) => {
                    const text = article.innerText.trim();
                    if (text) {
                        messages.push({
                            role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
                            content: text
                        });
                    }
                });
                return messages;
            }

            // Strategy 3: generic turn containers
            const turns = document.querySelectorAll('[class*="ConversationItem"], [class*="turn"]');
            if (turns.length > 0) {
                turns.forEach((turn, i) => {
                    const text = turn.innerText.trim();
                    if (text) {
                        messages.push({
                            role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
                            content: text
                        });
                    }
                });
                return messages;
            }

            return messages;
        },

        claude: () => {
            const messages = [];

            // Strategy 1: Look for human/assistant message containers
            const humanMsgs = document.querySelectorAll('[class*="human"], [class*="Human"], [data-is-human]');
            const assistantMsgs = document.querySelectorAll('[class*="assistant"], [class*="Assistant"], [data-is-assistant]');

            if (humanMsgs.length > 0 || assistantMsgs.length > 0) {
                // Collect all messages with their positions
                const allMsgs = [];
                humanMsgs.forEach(el => {
                    allMsgs.push({ role: 'USER', content: el.innerText.trim(), top: el.getBoundingClientRect().top });
                });
                assistantMsgs.forEach(el => {
                    allMsgs.push({ role: 'ASSISTANT', content: el.innerText.trim(), top: el.getBoundingClientRect().top });
                });

                // Sort by vertical position
                allMsgs.sort((a, b) => a.top - b.top);
                return allMsgs.filter(m => m.content.length > 0).map(({ role, content }) => ({ role, content }));
            }

            // Strategy 2: Look for message groups in main content
            const messageGroups = document.querySelectorAll('[class*="Message"], [class*="message-"]');
            if (messageGroups.length > 0) {
                messageGroups.forEach((group, i) => {
                    const text = group.innerText.trim();
                    if (text && text.length > 5) {
                        messages.push({
                            role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
                            content: text
                        });
                    }
                });
                return messages;
            }

            return messages;
        },

        gemini: () => {
            const messages = [];

            // Strategy 1: query/response chips
            const queries = document.querySelectorAll('[class*="query"], [class*="user-query"]');
            const responses = document.querySelectorAll('[class*="response"], [class*="model-response"]');

            if (queries.length > 0 || responses.length > 0) {
                const allMsgs = [];
                queries.forEach(el => {
                    allMsgs.push({ role: 'USER', content: el.innerText.trim(), top: el.getBoundingClientRect().top });
                });
                responses.forEach(el => {
                    allMsgs.push({ role: 'ASSISTANT', content: el.innerText.trim(), top: el.getBoundingClientRect().top });
                });
                allMsgs.sort((a, b) => a.top - b.top);
                return allMsgs.filter(m => m.content.length > 0).map(({ role, content }) => ({ role, content }));
            }

            // Strategy 2: message-content containers
            const turns = document.querySelectorAll('[class*="turn"], [class*="conversation"]');
            if (turns.length > 0) {
                turns.forEach((turn, i) => {
                    const text = turn.innerText.trim();
                    if (text && text.length > 5) {
                        messages.push({
                            role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
                            content: text
                        });
                    }
                });
                return messages;
            }

            return messages;
        },

        copilot: () => {
            const messages = [];
            const turns = document.querySelectorAll('[class*="message"], [class*="turn"]');
            turns.forEach((turn, i) => {
                const text = turn.innerText.trim();
                if (text && text.length > 5) {
                    messages.push({
                        role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
                        content: text
                    });
                }
            });
            return messages;
        }
    };

    // ========== GENERIC FALLBACK SCRAPER ==========
    function genericScrape() {
        const main = document.querySelector('main') ||
            document.querySelector('[role="main"]') ||
            document.querySelector('#__next') ||
            document.body;

        const text = main.innerText.trim();
        if (!text) return [];

        return [{ role: 'conversation', content: text }];
    }

    // ========== SCRAPE FUNCTION ==========
    function scrapeChat() {
        let messages = [];

        const scraper = scrapers[platform];
        if (scraper) {
            messages = scraper();
        }

        // If platform-specific scraper got nothing, try generic
        if (messages.length === 0) {
            messages = genericScrape();
        }

        return {
            platform: platform,
            messages: messages,
            url: window.location.href,
            title: document.title,
            timestamp: new Date().toISOString(),
            messageCount: messages.length
        };
    }

    // ========== INJECT TELEPORT BUTTON ==========
    function injectTeleportButton() {
        // Don't inject if already present
        if (document.getElementById('acc-teleport-btn')) return;

        const btn = document.createElement('div');
        btn.id = 'acc-teleport-btn';
        btn.innerHTML = '🧠';
        btn.title = 'AI Context Compressor — Scrape & Teleport';
        document.body.appendChild(btn);

        // Create the dropdown menu
        const menu = document.createElement('div');
        menu.id = 'acc-teleport-menu';
        menu.innerHTML = `
      <div class="acc-menu-header">AI Context Compressor</div>
      <div class="acc-menu-item" data-action="scrape">📡 Scrape This Chat</div>
      <div class="acc-menu-divider"></div>
      <div class="acc-menu-label">Teleport to:</div>
      <div class="acc-menu-item" data-target="chatgpt">💬 ChatGPT</div>
      <div class="acc-menu-item" data-target="claude">🟣 Claude</div>
      <div class="acc-menu-item" data-target="gemini">✨ Gemini</div>
      <div class="acc-menu-item" data-target="copilot">🔷 Copilot</div>
    `;
        document.body.appendChild(menu);

        // Toggle menu
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('acc-visible');
        });

        // Close menu on outside click
        document.addEventListener('click', () => {
            menu.classList.remove('acc-visible');
        });

        // Handle menu item clicks
        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.acc-menu-item');
            if (!item) return;

            e.stopPropagation();
            menu.classList.remove('acc-visible');

            if (item.dataset.action === 'scrape') {
                // Scrape and store
                const data = scrapeChat();
                chrome.storage.local.set({ scrapedChat: data }, () => {
                    showNotification(`✅ Scraped ${data.messageCount} messages! Open the extension to process.`);
                });
            } else if (item.dataset.target) {
                // Scrape, compress quickly, and teleport
                const data = scrapeChat();
                const text = data.messages.map(m => `[${m.role}]\n${m.content}`).join('\n\n');

                chrome.runtime.sendMessage({
                    action: 'teleport',
                    target: item.dataset.target,
                    text: text
                }, (response) => {
                    if (response && response.success) {
                        showNotification('🚀 Teleporting! Text copied — paste in the new tab.');
                    }
                });
            }
        });
    }

    // ========== NOTIFICATION TOAST ==========
    function showNotification(message) {
        // Remove existing
        const existing = document.getElementById('acc-notification');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'acc-notification';
        toast.textContent = message;
        document.body.appendChild(toast);

        // Auto-remove after 4 seconds
        setTimeout(() => {
            toast.classList.add('acc-fade-out');
            setTimeout(() => toast.remove(), 500);
        }, 4000);
    }

    // ========== CHECK FOR PENDING TELEPORT ==========
    function checkPendingTeleport() {
        chrome.storage.local.get('pendingTeleport', (result) => {
            if (!result.pendingTeleport) return;

            const { text, timestamp } = result.pendingTeleport;

            // Only use if less than 5 minutes old
            if (Date.now() - timestamp > 300000) {
                chrome.storage.local.remove('pendingTeleport');
                return;
            }

            // Copy to clipboard
            navigator.clipboard.writeText(text).then(() => {
                showNotification('📋 Context is on your clipboard! Press Ctrl+V to paste it here.');
            }).catch(() => {
                // Fallback: show the text in a floating panel
                showTeleportPanel(text);
            });

            // Clean up
            chrome.storage.local.remove('pendingTeleport');
        });
    }

    // ========== TELEPORT PANEL (Fallback if clipboard fails) ==========
    function showTeleportPanel(text) {
        const panel = document.createElement('div');
        panel.id = 'acc-teleport-panel';
        panel.innerHTML = `
      <div class="acc-panel-header">
        <span>🧠 AI Context Compressor</span>
        <button class="acc-panel-close">&times;</button>
      </div>
      <p class="acc-panel-desc">Your compressed context is ready. Copy it below and paste into the chat:</p>
      <textarea class="acc-panel-textarea" readonly>${text}</textarea>
      <button class="acc-panel-copy">📋 Copy to Clipboard</button>
    `;
        document.body.appendChild(panel);

        panel.querySelector('.acc-panel-close').addEventListener('click', () => panel.remove());
        panel.querySelector('.acc-panel-copy').addEventListener('click', () => {
            const textarea = panel.querySelector('.acc-panel-textarea');
            textarea.select();
            document.execCommand('copy');
            showNotification('📋 Copied! Now paste it into the chat.');
            panel.remove();
        });
    }

    // ========== LISTEN FOR MESSAGES FROM POPUP ==========
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'scrape') {
            const data = scrapeChat();
            sendResponse(data);
        }
        return true;
    });

    // ========== INITIALIZE ==========
    // Wait for page to fully load
    if (document.readyState === 'complete') {
        injectTeleportButton();
        checkPendingTeleport();
    } else {
        window.addEventListener('load', () => {
            // Delay slightly to let SPAs render
            setTimeout(() => {
                injectTeleportButton();
                checkPendingTeleport();
            }, 2000);
        });
    }

})();
