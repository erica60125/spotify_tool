// ==========================================================================
// 🌐 1. 全域變數與全域函數（智慧型半小時節流與防禦版）
// ==========================================================================
let currentDeviceId = null;
let playerInstance = null;

// 💡 核心全域函數：負責在背景默默刷新 Token，並內建半小時節流判斷
async function refreshAccessToken() {
    const client_id = localStorage.getItem('saved_client_id');
    const refresh_token = localStorage.getItem('spotify_refresh_token');
    const tokenExists = sessionStorage.getItem('spotify_access_token');
    
    // 取得上一次「真正向官方申請連線刷新」的時間戳記
    const lastRefreshTime = sessionStorage.getItem('spotify_last_refresh_time');

    // ─── 🛡️ 節流關卡：半小時內不重複重複戳 API ───
    if (tokenExists && lastRefreshTime) {
        const currentTime = Date.now();
        const thirtyMinutes = 30 * 60 * 1000; // 30 分鐘（微秒換算）
        
        // 如果距離上一次成功的網路連線還沒超過 30 分鐘，直接沿用舊 Token
        if (currentTime - parseInt(lastRefreshTime) < thirtyMinutes) {
            console.log(`[智慧節流] 🛑 距離上一次刷新未滿 30 分鐘。攔截請求，直接通行使用現有 Token。`);
            return true; 
        }
    }

    // ─── 超過半小時或首次開啟，執行真正的網路刷新 ───
    if (!client_id || !refresh_token) {
        console.log("[Auto-Refresh] 缺少 Client ID 或 Refresh Token，無法自動刷新。");
        return false;
    }

    try {
        console.log("[Auto-Refresh] ⏳ 已滿半小時冷卻期，正在背景向 Spotify 申請全新 Access Token...");
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refresh_token,
                client_id: client_id
            })
        });

        if (!response.ok) throw new Error('Spotify 拒絕刷新 Token');

        const data = await response.json();
        if (data.access_token) {
            // 儲存新 Token
            sessionStorage.setItem('spotify_access_token', data.access_token);
            
            // 核心：刷新成功，立刻重置這一次成功的時間戳記
            sessionStorage.setItem('spotify_last_refresh_time', Date.now().toString());

            if (data.refresh_token) {
                localStorage.setItem('spotify_refresh_token', data.refresh_token);
            }
            
            console.log("[Auto-Refresh] ✨ 順利突破半小時防線，全新 Token 刷新成功！");
            const authStatus = document.getElementById('authStatus');
            if (authStatus) authStatus.innerText = '🟢 憑證已自動更新';
            return true;
        }
    } catch (error) {
        console.error('[Auto-Refresh 發生嚴重錯誤]:', error);
        return false;
    }
    return false;
}

// 💡 官方 SDK 專用全域監聽器：當遠端 SDK 載入完畢時會自動觸發
window.onSpotifyWebPlaybackSDKReady = () => {
    const token = sessionStorage.getItem('spotify_access_token');
    if (!token) {
        console.log("[SDK] 記憶體中暫無 Token，等候登入流程觸發。");
        return;
    }

    // 防禦機制：如果之前已經有播放器實例，先將其斷線，避免重複堆疊榨乾記憶體
    if (playerInstance) {
        try { playerInstance.disconnect(); } catch(e){}
    }

    const player = new Spotify.Player({
        name: '磨砂玻璃 Podcast 播放小工具',
        getOAuthToken: cb => { cb(token); },
        volume: 0.5
    });

    // 播放器就緒：成功將網頁綁定為一個播放終端裝置
    player.addListener('ready', ({ device_id }) => {
        console.log('[SDK] 播放裝置已就緒！裝置 ID:', device_id);
        currentDeviceId = device_id;
        playerInstance = player;
        const statusEl = document.getElementById('authStatus');
        if (statusEl) statusEl.innerText = '🟢 播放裝置就緒，隨時可開播！';
    });

    // 💡 核心修正：當 SDK 遇到過期報錯時，在背景默默去換 Token 就好，不呼叫重新啟動，斬斷無限迴圈！
    player.addListener('authentication_error', async ({ message }) => { 
        console.warn('[SDK 驗證過期] 偵測到憑證異常，觸發背景智慧維護。錯誤訊息:', message); 
        await refreshAccessToken();
    });

    player.addListener('initialization_error', ({ message }) => { console.error('[SDK 初始化錯誤]', message); });
    player.addListener('account_error', ({ message }) => { 
        alert('官方限制：Web Playback SDK 僅支援 Spotify Premium 付費會員帳號！'); 
    });

    player.connect();
};

// ==========================================================================
// 🏠 2. DOM 介面互動與事件監聽（當網頁畫面 HTML 元件渲染完畢後才進場）
// ==========================================================================
document.addEventListener('DOMContentLoaded', function() {
    
    // 抓取畫面上所有的 UI 元件
    const currentSelectionEl = document.getElementById('currentSelection');
    const podcastUrlInput = document.getElementById('podcastUrl');
    const repeatSwitchInput = document.getElementById('repeatSwitch');
    const clientIdInput = document.getElementById('clientIdInput');
    
    const authBtn = document.getElementById('authBtn');
    const saveBtn = document.getElementById('saveBtn');
    const startBtn = document.getElementById('startBtn');
    const authStatus = document.getElementById('authStatus');

    // 回復上一次記憶的歷史紀錄 (滿足規格需求：記憶當前選擇與最後一次變更)
    const savedUrl = localStorage.getItem('saved_podcast_url');
    const savedRepeat = localStorage.getItem('saved_repeat_status');
    const savedID = localStorage.getItem('saved_client_id');
    
    if (currentSelectionEl && savedUrl) currentSelectionEl.innerText = savedUrl;
    if (podcastUrlInput && savedUrl) podcastUrlInput.value = savedUrl;
    if (clientIdInput && savedID) clientIdInput.value = savedID;
    if (repeatSwitchInput && savedRepeat) repeatSwitchInput.checked = JSON.parse(savedRepeat);

    // PKCE 加密工具函數群
    function generateRandomString(length) {
        let text = '';
        let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < length; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    async function generateCodeChallenge(codeVerifier) {
        function base64encode(string) {
            return btoa(String.fromCharCode.apply(null, new Uint8Array(string)))
                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        return base64encode(digest);
    }

    // 檢查網址列參數有沒有 Spotify 丟回來的登入代碼 (?code=xxxx)
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
        // 第一時間解析，拿 code 去後台換取正式通行證
        exchangeCodeForToken(code);
    } else {
        const token = sessionStorage.getItem('spotify_access_token');
        if (token) {
            authStatus.innerText = '🟢 驗證成功（已連結）';
            loadSpotifySDK();
        } else if (localStorage.getItem('spotify_refresh_token')) {
            // 如果開網頁發現沒 token 但有長效刷新令牌，自動執行半小時防線檢測並登入
            refreshAccessToken().then(success => {
                if (success) loadSpotifySDK();
            });
        }
    }

    // 異步注入官方 SDK 腳本
    function loadSpotifySDK() {
        if (window.Spotify) {
            window.onSpotifyWebPlaybackSDKReady();
            return;
        }
        const script = document.createElement('script');
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        document.head.appendChild(script);
    }

    // 【事件】點擊登入連結 Spotify
    authBtn.addEventListener('click', async function() {
        const client_id = clientIdInput.value.trim();
        if(!client_id) { alert('請填寫有效的 Client ID！'); return; }
        localStorage.setItem('saved_client_id', client_id);

        const redirect_uri ="https://erica60125-spotifytool.vercel.app/index.html"; 
        const codeVerifier = generateRandomString(128);
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        
        localStorage.setItem('code_verifier', codeVerifier);

        const scopes = 'streaming user-read-playback-state user-modify-playback-state';
        const authUrl = new URL("https://accounts.spotify.com/authorize");
        
        authUrl.search = new URLSearchParams({
            response_type: 'code', 
            client_id: client_id,
            scope: scopes,
            redirect_uri: redirect_uri,
            code_challenge_method: 'S256',
            code_challenge: codeChallenge
        }).toString();

        window.location.href = authUrl.toString(); 
    });

    // 【事件後台】拿 Code 換正式的 Access 與 Refresh Token
    async function exchangeCodeForToken(code) {
        const client_id = localStorage.getItem('saved_client_id');
        const codeVerifier = localStorage.getItem('code_verifier');
        const redirect_uri = window.location.href.split('?')[0].split('#')[0];

        try {
            const response = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: client_id,
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: redirect_uri,
                    code_verifier: codeVerifier
                })
            });

            if (!response.ok) throw new Error('兌換通行證失敗');

            const data = await response.json();
            if (data.access_token) {
                sessionStorage.setItem('spotify_access_token', data.access_token);
                
                // 初始化這把新 Token 的半小時冷卻計時器點
                sessionStorage.setItem('spotify_last_refresh_time', Date.now().toString());

                if (data.refresh_token) {
                    localStorage.setItem('spotify_refresh_token', data.refresh_token);
                }
                authStatus.innerText = '🟢 Spotify 連線成功！';
                window.history.replaceState({}, document.title, redirect_uri);
                loadSpotifySDK();
            }
        } catch (error) {
            console.error(error);
            authStatus.innerText = '🔴 驗證換取失敗';
        }
    }

    // 【事件】儲存指定 Podcast 節目設定 (需求 1)
    saveBtn.addEventListener('click', function() {
        const url = podcastUrlInput.value.trim();
        if (url === '' || !url.includes('show/')) { alert('請貼上包含 "show/" 的有效 Spotify 節目網址！'); return; }
        localStorage.setItem('saved_podcast_url', url);
        currentSelectionEl.innerText = url;
        alert('節目設定已儲存！');
    });

    // 【事件】切換循環播放開關 (需求 4)
    if (repeatSwitchInput) {
        repeatSwitchInput.addEventListener('change', function() {
            localStorage.setItem('saved_repeat_status', JSON.stringify(this.checked));
            if(sessionStorage.getItem('spotify_access_token')) setRepeatMode(this.checked);
        });
    }

    // 【核心事件】點擊 START：自動連線、後台自動尋找最新一集、網頁直接開播 (需求 3)
    startBtn.addEventListener('click', handlePlay);

    async function handlePlay() {
        let token = sessionStorage.getItem('spotify_access_token');
        const currentUrl = localStorage.getItem('saved_podcast_url');

        if (!currentUrl) { alert('請先儲存指定節目網址！'); return; }

        let showId = '';
        try { showId = currentUrl.split('show/')[1].split('?')[0]; } catch(e) { alert('網址格式錯誤。'); return; }

        // 如果點擊時發現沒有 Token 但有 Refresh Token，主動跑一次半小時預檢刷新
        if (!token && localStorage.getItem('spotify_refresh_token')) {
            const success = await refreshAccessToken();
            if (success) {
                token = sessionStorage.getItem('spotify_access_token');
            } else {
                alert('登入憑證失效，請重新點擊連結 Spotify 帳號。');
                return;
            }
        }

        try {
            authStatus.innerText = '🔍 正在後台為您尋找最新一集...';

            // 呼叫 Web API 獲取最新的單集
            let podcastResponse = await fetch(`https://api.spotify.com/v1/shows/${showId}/episodes?limit=1`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            
            // 原地抓捕防禦：如果拿列表踢到 401 鐵板，原地進行背景刷新重試一次
            if (podcastResponse.status === 401) {
                console.log("[API 防禦] Token 效期異常，原地啟動背景刷新...");
                const success = await refreshAccessToken();
                if (success) {
                    token = sessionStorage.getItem('spotify_access_token');
                    podcastResponse = await fetch(`https://api.spotify.com/v1/shows/${showId}/episodes?limit=1`, {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                } else {
                    throw new Error('自動刷新 Token 失敗，請手動重新登入。');
                }
            }

            if (!podcastResponse.ok) throw new Error('讀取 Podcast 列表失敗。');
            const podcastData = await podcastResponse.json();

            if (podcastData.items && podcastData.items.length > 0) {
                const latestEpisodeUri = podcastData.items[0].uri;
                const latestEpisodeName = podcastData.items[0].name;
                
                authStatus.innerText = `🎵 正在開播：${latestEpisodeName}`;

                // 指揮網頁播放器 (device_id) 直接開播這一集！
                await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${currentDeviceId}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ uris: [latestEpisodeUri] })
                });

                // 帶入開關狀態設定循環
                const isRepeat = repeatSwitchInput ? repeatSwitchInput.checked : false;
                setRepeatMode(isRepeat);

            } else {
                alert('該節目中沒有找到任何單集內容。');
                authStatus.innerText = '🟢 播放裝置就緒';
            }
        } catch (error) {
            console.error(error);
            alert(error.message || '開播失敗，請重新嘗試登入。');
            authStatus.innerText = '🔴 播放錯誤';
        }
    }

    // 控制循環播放 API 呼叫
    async function setRepeatMode(isRepeat) {
        const token = sessionStorage.getItem('spotify_access_token');
        const state = isRepeat ? 'track' : 'off';
        if (!token) return;
        
        try {
            await fetch(`https://api.spotify.com/v1/me/player/repeat?state=${state}`, {
                method: 'PUT',
                headers: { 'Authorization': 'Bearer ' + token }
            });
            console.log('[循環控制] 模式已成功切換為:', state);
        } catch (e) {
            console.log('[循環控制] 切換失敗（網頁設備與伺服器同步中）', e);
        }
    }
});