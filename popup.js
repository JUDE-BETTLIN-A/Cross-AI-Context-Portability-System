// ============================================================
// AI Context Compressor — popup.js v2.0
//
// Features:
// 1. TELEPORT — Scrape current AI page + open another AI
// 2. AI COMPRESSION — Ollama / Chrome AI / Rule-based
// 3. PROJECT VAULT — Save compressed contexts by project
// ============================================================

// ========== CONFIG ==========
const TOKEN_LIMITS = {
    auto: 8000,
    chatgpt: 8000,
    claude: 100000,
    gemini: 32000,
    copilot: 4000
};

const OLLAMA_URL = 'http://localhost:11434';

let chunks = [];
let currentChunkIndex = 0;
let aiEnabled = false;
let ollamaAvailable = false;
let chromeAIAvailable = false;
let lastOutput = '';

// ========== UTILITY ==========
function estimateTokens(text) { return Math.ceil(text.length / 4); }

function formatSize(n) {
    if (n < 1000) return n + '';
    if (n < 1000000) return (n / 1000).toFixed(1) + 'K';
    return (n / 1000000).toFixed(2) + 'M';
}

function setStatus(msg, type = '') {
    const el = document.getElementById('statusBar');
    el.textContent = msg;
    el.className = 'status-bar ' + type;
}

function setPipelineStep(step, state = 'active') {
    document.querySelectorAll('.pip-step').forEach(el => {
        if (el.dataset.step === step) {
            el.className = 'pip-step ' + state;
        }
    });
}

function resetPipeline() {
    document.querySelectorAll('.pip-step').forEach(el => {
        el.className = 'pip-step';
    });
}


// ========== TAB SWITCHING ==========
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');

        if (tab.dataset.tab === 'vault') loadVault();
    });
});


// ========== AI TOGGLE ==========
document.getElementById('aiToggle').addEventListener('click', function () {
    aiEnabled = !aiEnabled;
    this.classList.toggle('on', aiEnabled);

    const statusEl = document.getElementById('aiStatus');
    if (aiEnabled) {
        statusEl.classList.add('visible');
        checkAIAvailability();
    } else {
        statusEl.classList.remove('visible');
    }
});


// ========== CHECK AI AVAILABILITY ==========
async function checkAIAvailability() {
    const statusEl = document.getElementById('aiStatus');
    const iconEl = document.getElementById('aiStatusIcon');
    const textEl = document.getElementById('aiStatusText');

    textEl.textContent = 'Checking AI…';
    iconEl.textContent = '⏳';

    // Check Chrome built-in AI
    try {
        if (self.ai && self.ai.languageModel) {
            const caps = await self.ai.languageModel.capabilities();
            if (caps.available === 'readily' || caps.available === 'after-download') {
                chromeAIAvailable = true;
            }
        }
    } catch (e) {
        chromeAIAvailable = false;
    }

    // Check Ollama
    try {
        const res = await fetch(OLLAMA_URL + '/api/tags', {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
            const data = await res.json();
            ollamaAvailable = true;
            const models = data.models || [];
            const modelNames = models.map(m => m.name).slice(0, 3).join(', ');

            statusEl.className = 'ai-status visible connected';
            iconEl.textContent = '🟢';
            textEl.textContent = chromeAIAvailable
                ? 'Chrome AI + Ollama ready'
                : `Ollama connected (${modelNames || 'no models'})`;
            return;
        }
    } catch (e) {
        ollamaAvailable = false;
    }

    if (chromeAIAvailable) {
        statusEl.className = 'ai-status visible connected';
        iconEl.textContent = '🟢';
        textEl.textContent = 'Chrome built-in AI ready';
    } else {
        statusEl.className = 'ai-status visible disconnected';
        iconEl.textContent = '⚪';
        textEl.textContent = 'No AI found — using rule-based compression';
    }
}


// ========== SCRAPE CURRENT PAGE ==========
document.getElementById('scrapeBtn').addEventListener('click', () => {
    setStatus('📡 Scraping current page…');

    chrome.runtime.sendMessage({ action: 'requestScrape' }, (response) => {
        if (!response || !response.success) {
            setStatus(response?.error || 'Could not scrape. Open an AI chat page first.', 'error');
            return;
        }

        const data = response.data;
        const messages = data.messages || [];

        if (messages.length === 0) {
            setStatus('No messages found on this page.', 'warning');
            return;
        }

        // Convert to text
        const text = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
        document.getElementById('inputText').value = text;
        document.getElementById('inputBadge').textContent =
            `${data.platform} · ${messages.length} msgs · ${formatSize(text.length)} chars`;

        setStatus(`✅ Scraped ${messages.length} messages from ${data.platform}`, 'success');
    });
});


// ========== FILE UPLOAD ==========
document.getElementById('fileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setStatus(`Loading ${file.name}…`);

    const reader = new FileReader();
    reader.onload = () => {
        let text = reader.result;

        if (file.name.endsWith('.json')) {
            try {
                text = extractFromJSON(JSON.parse(text));
            } catch (e) { /* use raw */ }
        }

        document.getElementById('inputText').value = text;
        document.getElementById('inputBadge').textContent = `${file.name} · ${formatSize(text.length)} chars`;
        setStatus(`Loaded ${file.name}`, 'success');
    };
    reader.readAsText(file);
});

function extractFromJSON(data) {
    const lines = [];

    if (Array.isArray(data)) {
        for (const item of data) {
            if (item.mapping) {
                for (const node of Object.values(item.mapping)) {
                    if (node.message?.content?.parts) {
                        const role = normalizeRole(node.message.author?.role || 'unknown');
                        const content = node.message.content.parts.join('\n');
                        if (content.trim()) lines.push(`${role}: ${content}`);
                    }
                }
            } else if (item.role && item.content) {
                lines.push(`${normalizeRole(item.role)}: ${typeof item.content === 'string' ? item.content : JSON.stringify(item.content)}`);
            }
        }
    } else if (data.messages) {
        for (const msg of data.messages) {
            if (msg.role && msg.content) {
                lines.push(`${normalizeRole(msg.role)}: ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`);
            }
        }
    } else if (data.mapping) {
        for (const node of Object.values(data.mapping)) {
            if (node.message?.content?.parts) {
                const role = normalizeRole(node.message.author?.role || 'unknown');
                const content = node.message.content.parts.join('\n');
                if (content.trim()) lines.push(`${role}: ${content}`);
            }
        }
    }

    return lines.length > 0 ? lines.join('\n\n') : JSON.stringify(data, null, 2);
}


// ========== CONVERSATION PARSING ==========
function parseConversation(text) {
    const messages = [];
    const pattern = /^(User|ChatGPT|Assistant|System|Human|AI|Claude|Gemini|Copilot|You|Bot|USER|ASSISTANT|SYSTEM)\s*:\s*/gim;
    const matches = [...text.matchAll(pattern)];

    if (matches.length >= 2) {
        for (let i = 0; i < matches.length; i++) {
            const start = matches[i].index;
            const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
            const chunk = text.substring(start, end).trim();
            const speakerMatch = chunk.match(/^(\S+)\s*:\s*/i);
            if (speakerMatch) {
                const role = normalizeRole(speakerMatch[1]);
                const content = chunk.substring(speakerMatch[0].length).trim();
                if (content) messages.push({ role, content });
            }
        }
    }

    if (messages.length === 0) {
        const lines = text.split('\n');
        let currentRole = 'conversation';
        let currentContent = [];

        for (const line of lines) {
            const roleMatch = line.match(/^(User|ChatGPT|Assistant|System|Human|AI|Claude|Gemini|Copilot|You|Bot|USER|ASSISTANT)\s*:\s*/i);
            if (roleMatch) {
                if (currentContent.length > 0) {
                    messages.push({ role: currentRole, content: currentContent.join('\n').trim() });
                    currentContent = [];
                }
                currentRole = normalizeRole(roleMatch[1]);
                const rest = line.substring(roleMatch[0].length).trim();
                if (rest) currentContent.push(rest);
            } else {
                currentContent.push(line);
            }
        }
        if (currentContent.length > 0) {
            messages.push({ role: currentRole, content: currentContent.join('\n').trim() });
        }
    }

    if (messages.length === 0) {
        messages.push({ role: 'conversation', content: text.trim() });
    }

    return messages;
}

function normalizeRole(role) {
    const r = role.toLowerCase().trim();
    if (['user', 'human', 'you'].includes(r)) return 'USER';
    if (['assistant', 'chatgpt', 'ai', 'claude', 'gemini', 'copilot', 'bot'].includes(r)) return 'ASSISTANT';
    if (r === 'system') return 'SYSTEM';
    return 'USER';
}


// ========== CLEANING ==========
function cleanMessage(text) {
    return text
        .replace(/Regenerate\s*response/gi, '')
        .replace(/Continue\s*generating/gi, '')
        .replace(/Copy\s*code/gi, '')
        .replace(/\[Image[^\]]*\]/gi, '[image]')
        .replace(/ChatGPT said:/gi, '')
        .replace(/You said:/gi, '')
        .replace(/👍|👎|🔄|📋|Share|Like|Dislike/g, '')
        .replace(/\b\d{1,2}:\d{2}\s*(AM|PM|am|pm)?\s*(GMT|UTC|EST|PST|IST)?[+-]?\d*\b/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\s+$/gm, '')
        .trim();
}


// ========== RULE-BASED COMPRESSION ==========
function compressRuleBased(text) {
    let result = text;

    const fillerPatterns = [
        /^(hi|hello|hey|thanks|thank you|sure|okay|ok|great|got it|understood|absolutely|certainly|of course)[!.,]?\s*/gim,
        /hope that helps[!.]?\s*/gi,
        /let me know if you (have|need) (any )?(more )?(questions|help|anything)[!.]?\s*/gi,
        /is there anything else[^?]*\?\s*/gi,
        /feel free to ask[^.]*\.\s*/gi,
        /you're welcome[!.]?\s*/gi,
        /I'd be happy to help[!.]?\s*/gi,
        /That's a great question[!.]?\s*/gi,
        /I understand your concern[^.]*\.\s*/gi,
    ];

    for (const pattern of fillerPatterns) {
        result = result.replace(pattern, '');
    }

    // Deduplicate
    const lines = result.split('\n');
    const seen = new Set();
    const deduped = [];
    for (const line of lines) {
        const norm = line.trim().toLowerCase();
        if (!norm) { deduped.push(line); continue; }
        if (!seen.has(norm)) {
            seen.add(norm);
            deduped.push(line);
        }
    }

    return deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}


// ========== AI COMPRESSION (Ollama) ==========
async function compressWithOllama(messages) {
    const conversationText = messages.map(m => `[${m.role}]: ${m.content}`).join('\n');

    // Pick the best available model
    let modelName = 'llama3.2';
    try {
        const res = await fetch(OLLAMA_URL + '/api/tags');
        const data = await res.json();
        const models = (data.models || []).map(m => m.name);

        // Prefer smaller/faster models for compression
        const preferred = ['llama3.2', 'llama3.1', 'llama3', 'mistral', 'phi3', 'gemma2', 'qwen2'];
        for (const p of preferred) {
            const found = models.find(m => m.startsWith(p));
            if (found) { modelName = found; break; }
        }
    } catch (e) { /* use default */ }

    const prompt = `You are a conversation compressor. Your job is to compress the following conversation into a compact summary that preserves ALL important context, decisions, code changes, errors, solutions, and action items.

RULES:
- Remove ALL greetings, filler, pleasantries, and redundant text
- Keep ALL technical details, file names, code snippets, decisions, and errors
- Use bullet points for clarity
- Preserve the chronological order
- Keep it under 40% of the original length
- Format so another AI can read this and continue the work seamlessly

CONVERSATION TO COMPRESS:
${conversationText}

COMPRESSED SUMMARY:`;

    try {
        const res = await fetch(OLLAMA_URL + '/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelName,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.3,
                    num_predict: 2048
                }
            }),
            signal: AbortSignal.timeout(60000) // 60s timeout
        });

        if (!res.ok) throw new Error('Ollama request failed');
        const data = await res.json();
        return data.response || null;
    } catch (e) {
        console.warn('Ollama compression failed:', e);
        return null;
    }
}


// ========== AI COMPRESSION (Chrome Built-in AI) ==========
async function compressWithChromeAI(messages) {
    try {
        if (!self.ai || !self.ai.languageModel) return null;

        const session = await self.ai.languageModel.create({
            systemPrompt: 'You are a conversation compressor. Compress conversations into compact summaries preserving all important context, decisions, code, errors, and action items. Remove filler and redundancy.'
        });

        const conversationText = messages.map(m => `[${m.role}]: ${m.content}`).join('\n');
        const prompt = `Compress this conversation to under 40% of its length. Keep ALL technical details:\n\n${conversationText}`;

        const result = await session.prompt(prompt);
        session.destroy();
        return result || null;
    } catch (e) {
        console.warn('Chrome AI compression failed:', e);
        return null;
    }
}


// ========== TOPIC EXTRACTION ==========
function extractTopics(messages) {
    const wordFreq = new Map();
    const stopWords = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
        'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
        'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
        'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or', 'nor', 'not', 'so',
        'yet', 'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
        'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
        'because', 'if', 'when', 'while', 'about', 'that', 'this', 'it', 'its', 'my', 'your',
        'his', 'her', 'our', 'their', 'what', 'which', 'who', 'whom', 'how', 'then', 'there',
        'here', 'where', 'why', 'i', 'me', 'we', 'us', 'you', 'he', 'she', 'they', 'them', 'also',
        'like', 'want', 'need', 'use', 'using', 'used', 'make', 'made', 'get', 'got', 'know',
        'think', 'see', 'look', 'go', 'going', 'come', 'take', 'give', 'say', 'said', 'tell',
        'been', 'being', 'those', 'these', 'would', 'could', 'should', 'much', 'many',
        'well', 'still', 'already', 'even', 'really', 'actually', 'right', 'back', 'going',
        'something', 'thing', 'things', 'work', 'working', 'works', 'way', 'ways', 'time',
        'first', 'last', 'next', 'new', 'good', 'best', 'long', 'great', 'little', 'just',
        'help', 'please', 'sure', 'okay', 'thanks', 'thank', 'yes', 'yeah'
    ]);

    for (const msg of messages) {
        const words = msg.content.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
        for (const word of words) {
            if (!stopWords.has(word)) {
                wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
            }
        }
    }

    return [...wordFreq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word]) => word);
}


// ========== FORMAT OUTPUT ==========
function formatForAI(messages, metadata) {
    let out = '';

    out += `=== AI CONTEXT TRANSFER ===\n`;
    out += `Source: ${metadata.source || 'Exported conversation'}\n`;
    out += `Messages: ${metadata.messageCount}\n`;
    out += `Compressed: ${metadata.reductionPercent}% smaller than original\n`;
    out += `Method: ${metadata.method}\n`;
    out += `Generated: ${new Date().toISOString()}\n`;
    out += `Tool: AI Context Compressor v2.0\n`;
    out += `===========================\n\n`;

    out += `INSTRUCTION FOR AI: This is a compressed version of a previous conversation `;
    out += `from another AI platform. Please read it carefully to understand the full context, `;
    out += `then continue helping the user from where this conversation left off. `;
    out += `Do NOT ask the user to repeat information that is already provided below.\n\n`;

    const topics = extractTopics(messages);
    if (topics.length > 0) {
        out += `KEY TOPICS: ${topics.join(', ')}\n\n`;
    }

    out += `--- CONVERSATION START ---\n\n`;

    if (metadata.aiSummary) {
        // AI-compressed: use the summary directly
        out += metadata.aiSummary + '\n\n';
    } else {
        // Rule-based: output cleaned messages
        for (const msg of messages) {
            out += `[${msg.role}]\n${msg.content}\n\n`;
        }
    }

    out += `--- CONVERSATION END ---\n\n`;
    out += `Please continue from here. The user may ask follow-up questions or request changes `;
    out += `based on the context above.\n`;

    return out;
}


// ========== CHUNKING ==========
function chunkText(text, maxChars) {
    if (text.length <= maxChars) return [text];

    const result = [];
    const lines = text.split('\n');
    let currentChunk = '';
    let chunkNum = 1;

    for (const line of lines) {
        if ((currentChunk + '\n' + line).length > maxChars - 300 && currentChunk.length > 0) {
            result.push(currentChunk);
            chunkNum++;
            currentChunk = line;
        } else {
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
    }
    if (currentChunk) result.push(currentChunk);

    // Add chunk headers
    return result.map((c, i) =>
        `[CHUNK ${i + 1} of ${result.length}] — Paste all chunks in order for full context.\n\n${c}`
    );
}

function showChunk(index) {
    if (chunks.length <= 1) return;
    currentChunkIndex = Math.max(0, Math.min(index, chunks.length - 1));
    document.getElementById('outputText').value = chunks[currentChunkIndex];
    document.getElementById('chunkLabel').textContent = `${currentChunkIndex + 1} / ${chunks.length}`;
}


// ========== MAIN PIPELINE ==========
document.getElementById('processBtn').addEventListener('click', async () => {
    const rawText = document.getElementById('inputText').value;

    if (!rawText.trim()) {
        setStatus('⚠️ Paste or upload text first.', 'warning');
        return;
    }

    const originalLength = rawText.length;
    const btn = document.getElementById('processBtn');
    btn.textContent = '⏳ Processing…';
    btn.disabled = true;

    try {
        resetPipeline();

        // Step 1: Parse
        setPipelineStep('input', 'done');
        setPipelineStep('clean', 'processing');
        setStatus('Parsing conversation…');
        const messages = parseConversation(rawText);

        // Step 2: Clean
        for (const msg of messages) {
            msg.content = cleanMessage(msg.content);
        }
        setPipelineStep('clean', 'done');

        // Step 3: Compress
        setPipelineStep('compress', 'processing');
        setStatus('Compressing…');

        let aiSummary = null;
        let compressionMethod = 'Rule-based';

        if (aiEnabled) {
            // Try AI compression
            if (ollamaAvailable) {
                setStatus('🤖 Compressing with Ollama…');
                compressionMethod = 'Ollama AI';
                aiSummary = await compressWithOllama(messages);
            }

            if (!aiSummary && chromeAIAvailable) {
                setStatus('🤖 Compressing with Chrome AI…');
                compressionMethod = 'Chrome AI';
                aiSummary = await compressWithChromeAI(messages);
            }

            if (!aiSummary) {
                compressionMethod = 'Rule-based (AI unavailable)';
            }
        }

        // Rule-based compression (always applied, even after AI)
        for (const msg of messages) {
            msg.content = compressRuleBased(msg.content);
        }

        // Remove empty messages
        const filtered = messages.filter(m => m.content.trim().length > 0);
        setPipelineStep('compress', 'done');

        // Step 4: Format
        setPipelineStep('format', 'processing');
        setStatus('Formatting for AI…');

        const compressedLength = aiSummary
            ? aiSummary.length
            : filtered.reduce((sum, m) => sum + m.content.length, 0);
        const reductionPercent = originalLength > 0
            ? Math.round((1 - compressedLength / originalLength) * 100)
            : 0;

        const formatted = formatForAI(filtered, {
            source: 'Pasted conversation',
            messageCount: filtered.length,
            reductionPercent: Math.max(0, reductionPercent),
            method: compressionMethod,
            aiSummary: aiSummary
        });

        setPipelineStep('format', 'done');

        // Chunk if needed
        const target = document.getElementById('targetAI').value;
        const maxTokens = TOKEN_LIMITS[target] || 8000;
        const maxChars = maxTokens * 4;

        chunks = chunkText(formatted, maxChars);
        currentChunkIndex = 0;
        lastOutput = formatted;

        // Show output
        document.getElementById('outputText').value = chunks[0];

        // Stats
        const statsPanel = document.getElementById('statsPanel');
        statsPanel.classList.add('visible');
        document.getElementById('statOriginal').textContent = formatSize(originalLength);
        document.getElementById('statCompressed').textContent = formatSize(formatted.length);

        const redEl = document.getElementById('statReduction');
        const redPercent = Math.max(0, reductionPercent);
        redEl.textContent = redPercent + '%';
        redEl.className = 'stat-val ' + (redPercent >= 50 ? 'green' : redPercent >= 20 ? 'yellow' : 'red');

        // Chunk nav
        const chunkNav = document.getElementById('chunkNav');
        if (chunks.length > 1) {
            chunkNav.classList.add('visible');
            document.getElementById('chunkLabel').textContent = `1 / ${chunks.length}`;
        } else {
            chunkNav.classList.remove('visible');
        }

        // Output badge
        document.getElementById('outputBadge').textContent = `~${formatSize(estimateTokens(formatted))} tokens · ${compressionMethod}`;

        // Done
        setPipelineStep('done', 'done');
        const chunkNote = chunks.length > 1 ? ` · ${chunks.length} chunks` : '';
        setStatus(`✅ Done! ${filtered.length} messages · ${redPercent}% smaller · ${compressionMethod}${chunkNote}`, 'success');

    } catch (err) {
        console.error(err);
        setStatus('❌ Error: ' + err.message, 'error');
    } finally {
        btn.textContent = '🚀 Compress & Optimize';
        btn.disabled = false;
    }
});


// ========== CHUNK NAVIGATION ==========
document.getElementById('prevChunk').addEventListener('click', () => showChunk(currentChunkIndex - 1));
document.getElementById('nextChunk').addEventListener('click', () => showChunk(currentChunkIndex + 1));


// ========== COPY ==========
document.getElementById('copyBtn').addEventListener('click', () => {
    const text = document.getElementById('outputText').value;
    if (!text) { setStatus('Nothing to copy.', 'warning'); return; }

    navigator.clipboard.writeText(text).then(() => {
        setStatus('📋 Copied to clipboard!', 'success');
    }).catch(() => {
        document.getElementById('outputText').select();
        document.execCommand('copy');
        setStatus('📋 Copied!', 'success');
    });
});


// ========== DOWNLOAD ==========
document.getElementById('downloadBtn').addEventListener('click', () => {
    const text = chunks.length > 1 ? chunks.join('\n\n---\n\n') : document.getElementById('outputText').value;
    if (!text) { setStatus('Nothing to download.', 'warning'); return; }

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ai_context_compressed.txt';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('💾 Downloaded!', 'success');
});


// ========== TELEPORT ==========
document.querySelectorAll('.btn-teleport').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        const text = lastOutput || document.getElementById('outputText').value;

        if (!text) {
            setStatus('Compress something first, then teleport.', 'warning');
            return;
        }

        // Copy to clipboard first
        navigator.clipboard.writeText(text).then(() => {
            // Send teleport command to background
            chrome.runtime.sendMessage({
                action: 'teleport',
                target: target,
                text: text
            }, (response) => {
                if (response && response.success) {
                    setStatus(`🚀 Teleporting to ${target}! Text is on your clipboard — just paste (Ctrl+V).`, 'success');
                } else {
                    setStatus('Failed to open target. Text is still copied to clipboard.', 'error');
                }
            });
        }).catch(() => {
            setStatus('Clipboard failed. Use the Copy button and switch tabs manually.', 'error');
        });
    });
});


// ========== PROJECT VAULT ==========

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Save to vault
document.getElementById('saveVaultBtn').addEventListener('click', () => {
    const text = lastOutput || document.getElementById('outputText').value;
    if (!text) { setStatus('Nothing to save. Compress first.', 'warning'); return; }

    // Switch to vault tab and prompt for name
    document.querySelector('[data-tab="vault"]').click();
    document.getElementById('vaultProjectName').focus();
    setStatus('Enter a project name and click "Save Current"', 'warning');
});

document.getElementById('vaultAddBtn').addEventListener('click', () => {
    const name = document.getElementById('vaultProjectName').value.trim();
    const text = lastOutput || document.getElementById('outputText').value;

    if (!name) { setStatus('Enter a project name.', 'warning'); return; }
    if (!text) { setStatus('Compress some text first, then save.', 'warning'); return; }

    chrome.storage.local.get('vault', (result) => {
        const vault = result.vault || [];

        // Check if project exists
        const existing = vault.find(p => p.name.toLowerCase() === name.toLowerCase());

        if (existing) {
            // Append new context to existing project
            existing.contexts.push({
                id: generateId(),
                timestamp: new Date().toISOString(),
                compressed: text,
                size: text.length
            });
            existing.updated = new Date().toISOString();
        } else {
            // Create new project
            vault.push({
                id: generateId(),
                name: name,
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                contexts: [{
                    id: generateId(),
                    timestamp: new Date().toISOString(),
                    compressed: text,
                    size: text.length
                }]
            });
        }

        chrome.storage.local.set({ vault }, () => {
            document.getElementById('vaultProjectName').value = '';
            loadVault();
            setStatus(`💼 Saved to project "${name}"!`, 'success');
        });
    });
});

// Load vault list
function loadVault() {
    chrome.storage.local.get('vault', (result) => {
        const vault = result.vault || [];
        const listEl = document.getElementById('vaultList');

        if (vault.length === 0) {
            listEl.innerHTML = `
        <div class="vault-empty">
          <div class="icon">💼</div>
          <div>No saved projects yet</div>
          <div style="margin-top: 6px; color:#555;">Compress a conversation and click "Save" to start your vault</div>
        </div>
      `;
            return;
        }

        // Sort by most recently updated
        vault.sort((a, b) => new Date(b.updated) - new Date(a.updated));

        listEl.innerHTML = vault.map(project => {
            const totalSize = project.contexts.reduce((sum, c) => sum + c.size, 0);
            const contextCount = project.contexts.length;
            const timeAgo = getTimeAgo(new Date(project.updated));

            return `
        <div class="vault-card" data-id="${project.id}">
          <div class="vault-card-name">📁 ${escapeHtml(project.name)}</div>
          <div class="vault-card-meta">
            ${contextCount} context${contextCount > 1 ? 's' : ''} · ${formatSize(totalSize)} chars · ${timeAgo}
          </div>
          <div class="vault-card-actions">
            <button onclick="loadProject('${project.id}')">📥 Load</button>
            <button onclick="loadAllContexts('${project.id}')">📚 Load All</button>
            <button class="danger" onclick="deleteProject('${project.id}')">🗑️ Delete</button>
          </div>
        </div>
      `;
        }).join('');
    });
}

// Load the latest context from a project
window.loadProject = function (projectId) {
    chrome.storage.local.get('vault', (result) => {
        const vault = result.vault || [];
        const project = vault.find(p => p.id === projectId);
        if (!project || project.contexts.length === 0) return;

        const latest = project.contexts[project.contexts.length - 1];

        // Switch to compress tab
        document.querySelector('[data-tab="compress"]').click();
        document.getElementById('outputText').value = latest.compressed;
        lastOutput = latest.compressed;
        chunks = [latest.compressed];
        currentChunkIndex = 0;

        document.getElementById('outputBadge').textContent = `from vault: ${project.name}`;
        setStatus(`📁 Loaded latest context from "${project.name}"`, 'success');
    });
};

// Load ALL contexts from a project (combined)
window.loadAllContexts = function (projectId) {
    chrome.storage.local.get('vault', (result) => {
        const vault = result.vault || [];
        const project = vault.find(p => p.id === projectId);
        if (!project || project.contexts.length === 0) return;

        const combined = project.contexts.map((c, i) => {
            return `=== Session ${i + 1} (${new Date(c.timestamp).toLocaleDateString()}) ===\n\n${c.compressed}`;
        }).join('\n\n' + '='.repeat(50) + '\n\n');

        // Switch to compress tab
        document.querySelector('[data-tab="compress"]').click();
        document.getElementById('outputText').value = combined;
        lastOutput = combined;
        chunks = [combined];
        currentChunkIndex = 0;

        document.getElementById('outputBadge').textContent = `${project.contexts.length} sessions from ${project.name}`;
        setStatus(`📁 Loaded all ${project.contexts.length} contexts from "${project.name}"`, 'success');
    });
};

// Delete a project
window.deleteProject = function (projectId) {
    if (!confirm('Delete this project and all its saved contexts?')) return;

    chrome.storage.local.get('vault', (result) => {
        const vault = (result.vault || []).filter(p => p.id !== projectId);
        chrome.storage.local.set({ vault }, () => {
            loadVault();
            setStatus('🗑️ Project deleted.', 'success');
        });
    });
};

// Utility: time ago
function getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';
    return date.toLocaleDateString();
}

// Utility: escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


// ========== INPUT LIVE COUNTER ==========
document.getElementById('inputText').addEventListener('input', (e) => {
    const len = e.target.value.length;
    document.getElementById('inputBadge').textContent = len > 0 ? `${formatSize(len)} chars` : 'paste or upload';
});


// ========== INIT ==========
// Check if there's scraped data waiting from the content script
chrome.storage.local.get('scrapedChat', (result) => {
    if (result.scrapedChat) {
        const data = result.scrapedChat;
        const text = data.messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
        document.getElementById('inputText').value = text;
        document.getElementById('inputBadge').textContent =
            `${data.platform} · ${data.messageCount} msgs · ${formatSize(text.length)} chars`;
        setStatus(`📡 Auto-loaded ${data.messageCount} messages scraped from ${data.platform}`, 'success');

        // Clear the scraped data
        chrome.storage.local.remove('scrapedChat');
    }
});
