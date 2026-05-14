document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const app = document.getElementById('app');
    const welcomeSection = document.getElementById('welcome-section');
    const chatContainer = document.getElementById('chat-container');
    const messagesContainer = document.getElementById('messages');
    const inputForm = document.getElementById('input-form');
    const inputText = document.getElementById('input-text');
    const sendBtn = document.getElementById('send-btn');
    const clearChatBtn = document.getElementById('clear-chat');
    const themeToggleBtn = document.getElementById('theme-toggle');
    const lightIcon = document.getElementById('light-icon');
    const darkIcon = document.getElementById('dark-icon');
    const suggestionCards = document.querySelectorAll('.suggestion-card');
    const imageUpload = document.getElementById('upload-image');
    const imagePreview = document.getElementById('image-preview');
    const stopBtn = document.getElementById('stop-generation');

    // --- State ---
    let isDarkMode = false;
    let currentApiKey = localStorage.getItem('LINGXI_API_KEY') || '';
    let abortController = null; // 用于中断流式请求
    let pendingImageDataUrls = []; // 当前已选待发送的图片 base64 数据
    /** 多轮对话历史（发给 API 用），每项为 { role, content } */
    let conversationHistory = [];

    // --- Markdown Parser ---
    const md = window.markdownit({
        html: true,
        linkify: true,
        typographer: true,
        highlight: function (str, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return `<pre class="hljs"><code>${hljs.highlight(lang, str, true).value}</code></pre>`;
                } catch (err) {}
            }
            return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
        }
    });

    // --- Utility Functions ---
    function scrollToBottom() {
        // 滚动条在 main#chat-container 上，不是 #messages
        if (chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }

    function enhanceCodeBlocks(container) {
        container.querySelectorAll('pre code').forEach((block) => {
            const parent = block.parentNode;
            if (parent.querySelector('.copy-btn')) return;
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.innerText = '复制';
            copyBtn.onclick = (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(block.innerText);
                copyBtn.innerText = '已复制';
                setTimeout(() => (copyBtn.innerText = '复制'), 2000);
            };
            parent.appendChild(copyBtn);
        });
    }

    function createMessageElement(content, isUser = false, isStreaming = false, imageDataUrls = []) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `flex ${isUser ? 'justify-end' : 'justify-start'} w-full`;

        const avatar = document.createElement('div');
        avatar.className = 'w-8 h-8 rounded-full flex items-center justify-center text-white mr-2 ml-2 flex-shrink-0';
        if (isUser) {
            avatar.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            avatar.innerText = 'U';
        } else {
            avatar.style.background = 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)';
            avatar.innerText = 'AI';
        }

        const contentDiv = document.createElement('div');
        // min-w-0：flex 子项可收缩，避免长代码/表格把气泡撑出屏幕
        contentDiv.className = `message-content min-w-0 max-w-3xl p-3 rounded-lg ${isUser ? 'bg-indigo-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700'}`;

        if (isStreaming) {
            contentDiv.id = 'streaming-output';
            contentDiv.innerHTML = '';
        } else {
            contentDiv.innerHTML = md.render(content || '');
            if (!isUser) {
                enhanceCodeBlocks(contentDiv);
            }
            // 用户消息且带图：在文字下方展示缩略图
            if (isUser && imageDataUrls && imageDataUrls.length > 0) {
                const wrap = document.createElement('div');
                wrap.className = 'flex flex-wrap gap-2 mt-2';
                imageDataUrls.forEach(url => {
                    const img = document.createElement('img');
                    img.src = url;
                    img.className = 'w-16 h-16 object-cover rounded border border-white/30';
                    img.alt = '上传的图片';
                    wrap.appendChild(img);
                });
                contentDiv.appendChild(wrap);
            }
        }

        if (isUser) {
            messageDiv.appendChild(contentDiv);
            messageDiv.appendChild(avatar);
        } else {
            messageDiv.appendChild(avatar);
            messageDiv.appendChild(contentDiv);
        }

        return messageDiv;
    }

    function showTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'typing-indicator';
        indicator.className = 'flex justify-start w-full';
        indicator.innerHTML = `
            <div class="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white mr-2 ml-2 flex-shrink-0">
                AI
            </div>
            <div class="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 p-3 rounded-lg flex items-center space-x-1">
                <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
                <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.4s"></div>
            </div>
        `;
        messagesContainer.appendChild(indicator);
        scrollToBottom();
    }

    function hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();
    }

    function updateSendButtonVisibility() {
        const hasText = inputText.value.trim() !== '';
        const hasImages = pendingImageDataUrls.length > 0;
        const canSend = hasText || hasImages;
        sendBtn.classList.toggle('hidden', !canSend);
        sendBtn.disabled = !canSend;
    }

    function showStopButton() {
        if (!stopBtn) return;
        stopBtn.classList.remove('hidden');
        stopBtn.disabled = false;
    }

    function hideStopButton() {
        if (!stopBtn) return;
        stopBtn.classList.add('hidden');
        stopBtn.disabled = true;
    }

    // --- Event Listeners ---

    // 1. 主题切换（作用在 html 根节点，配合 Tailwind 的 dark:）
    themeToggleBtn.addEventListener('click', () => {
        isDarkMode = !isDarkMode;
        const root = document.documentElement;
        root.classList.toggle('dark', isDarkMode);
        lightIcon.classList.toggle('hidden');
        darkIcon.classList.toggle('hidden');
        localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    });

    // 2. 恢复主题
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        isDarkMode = true;
        document.documentElement.classList.add('dark');
        lightIcon.classList.add('hidden');
        darkIcon.classList.remove('hidden');
    }

    // 3. API Key 输入提示 (仅在本地没有存储时)
    if (!currentApiKey) {
        currentApiKey = prompt('请输入你的阿里云百炼 API Key (会保存在本地浏览器的 localStorage 中，键名为 LINGXI_API_KEY)：');
        if (currentApiKey) {
            localStorage.setItem('LINGXI_API_KEY', currentApiKey);
        } else {
            alert('API Key 不能为空，请刷新页面重试。');
        }
    }

    // 4. 建议卡片点击
    suggestionCards.forEach(card => {
        card.addEventListener('click', () => {
            const text = card.querySelector('p').innerText;
            inputText.value = text;
            updateSendButtonVisibility();
            handleSendMessage();
        });
    });

    // 5. 图片上传预览，并保存 base64 供图文对话使用
    imageUpload.addEventListener('change', (e) => {
        const files = e.target.files;
        imagePreview.innerHTML = '';
        pendingImageDataUrls = [];
        if (!files || files.length === 0) {
            imagePreview.classList.add('hidden');
            return;
        }
        imagePreview.classList.remove('hidden');

        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUrl = event.target.result;
                pendingImageDataUrls.push(dataUrl);
                const img = document.createElement('img');
                img.src = dataUrl;
                img.className = 'w-16 h-16 object-cover rounded border border-gray-300 dark:border-gray-600';
                imagePreview.appendChild(img);
                updateSendButtonVisibility();
            };
            reader.readAsDataURL(file);
        });
    });

    // 6. 清除对话（如果正在生成，先中断流式，再清空 UI 并回到首页）
    clearChatBtn.addEventListener('click', () => {
        // 若有正在进行的请求，先中断
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        hideTypingIndicator();
        hideStopButton();

        // 清空所有消息并回到欢迎页
        messagesContainer.innerHTML = '';
        conversationHistory = [];
        welcomeSection.classList.remove('hidden');

        // 重置输入区与图片预览
        inputText.value = '';
        imagePreview.innerHTML = '';
        imagePreview.classList.add('hidden');
        imageUpload.value = '';
        pendingImageDataUrls = [];
        updateSendButtonVisibility();
    });

    // 7. 表单提交 (发送消息)
    inputForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSendMessage();
    });

    // 8. 输入框自动增高 + 发送按钮显示逻辑
    inputText.addEventListener('input', () => {
        inputText.style.height = 'auto';
        inputText.style.height = inputText.scrollHeight + 'px';
        updateSendButtonVisibility();
    });
    updateSendButtonVisibility();

    // 9. 快捷键支持
    inputText.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // 10. 停止生成
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            if (abortController) {
                abortController.abort();
            }
            hideStopButton();
        });
    }

    async function handleSendMessage() {
        const text = inputText.value.trim();
        const imageUrls = pendingImageDataUrls.slice();
        if (!text && imageUrls.length === 0) return;

        // 隐藏欢迎页
        welcomeSection.classList.add('hidden');

        // 1. 显示用户消息（文字 + 若有图则展示缩略图）
        const userContent = text || (imageUrls.length > 0 ? '[图片]' : '');
        const userMsg = createMessageElement(userContent, true, false, imageUrls);
        messagesContainer.appendChild(userMsg);
        scrollToBottom();

        // 2. 清空输入框和待发送图片
        inputText.value = '';
        imagePreview.classList.add('hidden');
        imagePreview.innerHTML = '';
        imageUpload.value = '';
        pendingImageDataUrls = [];
        updateSendButtonVisibility();

        // 3. 显示 AI 正在输入...
        showTypingIndicator();

        // 4. 调用 AI API（支持图文）
        try {
            await fetchAIResponse(text, imageUrls);
        } catch (error) {
            console.error('API Error:', error);
            const errorMsg = createMessageElement('哎呀，网络好像有点问题，请稍后再试。', false);
            messagesContainer.appendChild(errorMsg);
        } finally {
            hideTypingIndicator();
            hideStopButton();
            abortController = null;
            inputText.focus();
        }
    }

    /** 流式结束后必须移除 id，否则下一轮会错误地更新旧的 AI 气泡 */
    function finalizeStreamingBubble() {
        const el = document.getElementById('streaming-output');
        if (el) el.removeAttribute('id');
    }

    const MAX_HISTORY_TURNS = 12; // 最多保留约 12 轮问答，避免 token 过长

    function trimConversationHistory() {
        while (conversationHistory.length > MAX_HISTORY_TURNS * 2) {
            conversationHistory.shift();
            conversationHistory.shift();
        }
    }

    async function fetchAIResponse(message, imageDataUrls = []) {
        const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

        abortController = new AbortController();
        showStopButton();

        const hasImages = imageDataUrls && imageDataUrls.length > 0;
        const userContent = hasImages
            ? [
                ...imageDataUrls.map(url => ({ type: 'image_url', image_url: { url } })),
                { type: 'text', text: message || '请描述或分析这张图片。' }
            ]
            : message;

        // 若历史里曾有多模态消息，需继续用视觉模型
        const historyHasVision = conversationHistory.some(
            m => m.role === 'user' && Array.isArray(m.content)
        );
        const model = hasImages || historyHasVision ? 'qwen-vl-plus' : 'qwen-plus';

        const systemPrompt =
            '你是一个耐心、专业的中文 AI 助手，会尽量使用 Markdown 排版答案。支持图文理解，请根据用户提供的图片和文字回答问题。请结合完整对话上下文回答，不要忽略用户之前说过的话。';

        const body = {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                ...conversationHistory,
                { role: 'user', content: userContent }
            ],
            stream: true
        };

        let accumulatedContent = '';

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${currentApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                signal: abortController.signal
            });

            if (!response.ok) {
                throw new Error('网络响应错误');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (!value) continue;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const dataStr = line.replace(/^data:\s*/, '').trim();
                    if (dataStr === '[DONE]') {
                        done = true;
                        break;
                    }
                    try {
                        const data = JSON.parse(dataStr);
                        const delta = data.choices?.[0]?.delta?.content;
                        if (delta) {
                            accumulatedContent += delta;
                            updateStreamingOutput(accumulatedContent);
                        }
                    } catch (e) {
                        console.warn('解析流数据失败：', e);
                    }
                }
            }

            // 本轮成功结束：写入多轮历史，并解除 streaming id 防止下一轮错位
            conversationHistory.push({ role: 'user', content: userContent });
            conversationHistory.push({ role: 'assistant', content: accumulatedContent });
            trimConversationHistory();
            finalizeStreamingBubble();
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('Stream aborted');
                // 中断时仍解除 id，避免 DOM 错位；是否写入历史可选，这里写入部分回复便于连贯
                if (accumulatedContent) {
                    conversationHistory.push({ role: 'user', content: userContent });
                    conversationHistory.push({ role: 'assistant', content: accumulatedContent });
                    trimConversationHistory();
                }
                finalizeStreamingBubble();
            } else {
                finalizeStreamingBubble();
                throw err;
            }
        }
    }

    function updateStreamingOutput(content) {
        let contentDiv = document.getElementById('streaming-output');
        if (!contentDiv) {
            const messageEl = createMessageElement('', false, true);
            messagesContainer.appendChild(messageEl);
            contentDiv = document.getElementById('streaming-output');
        }
        contentDiv.innerHTML = md.render(content || '');
        enhanceCodeBlocks(contentDiv);
        scrollToBottom();
    }
});

