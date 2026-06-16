// ==========================================================================
// 💡 官方指南核心要求：必須在網頁全域環境（window）下定義 Web Playback SDK 初始化監聽器
// ==========================================================================
let currentDeviceId = null;
let playerInstance = null;

window.onSpotifyWebPlaybackSDKReady = () => {
    const token = sessionStorage.getItem('spotify_access_token');
    if (!token) {
        console.log("[SDK] 尚未取得 Access Token，暫緩初始化播放器。");
        return;
    }

    // 實例化官方播放裝置
    const player = new Spotify.Player({
        name: '磨砂玻璃 Podcast 播放小工具',
        getOAuthToken: cb => { cb(token); },
        volume: 0.5
    });

    // 監聽官方狀態：就緒時取得虛擬裝置 ID (Device ID)
    player.addListener('ready', ({ device_id }) => {
        console.log('[SDK] 播放裝置已就緒！裝置 ID:', device_id);
        currentDeviceId = device_id;
        playerInstance = player;
        const statusEl = document.getElementById('authStatus');
        if (statusEl) statusEl.innerText = '🟢 播放裝置就緒，隨時可開播！';
    });

    // 錯誤捕獲與安全防禦
    player.addListener('initialization_error', ({ message }) => { console.error('[SDK 初始化錯誤]', message); });
    player.addListener('authentication_error', ({ message }) => { 
        console.error('[SDK 驗證過期]', message); 
        document.getElementById('authStatus').innerText = '🔴 驗證已過期，請重新連結';
    });
    player.addListener('account_error', ({ message }) => { 
        alert('官方限制：Web Playback SDK 僅支援 Spotify Premium 付費會員帳號！'); 
    });

    player.connect();
};

// ==========================================================================
// DOM 介面互動與 PKCE 安全流程處理
// ==========================================================================
document.addEventListener('DOMContentLoaded', function() {
    
    const currentSelectionEl = document.getElementById('currentSelection');
    const podcastUrlInput = document.getElementById('podcastUrl');
    const repeatSwitchInput = document.getElementById('repeatSwitch');
    const clientIdInput = document.getElementById('clientIdInput');
    
    const authBtn = document.getElementById('authBtn');
    const saveBtn = document.getElementById('saveBtn');
    const startBtn = document.getElementById('startBtn');
    const authStatus = document.getElementById('authStatus');

    // 1. 載入並回復歷史記憶狀態 (滿足需求 2 & 4)
    const savedUrl = localStorage.getItem('saved_podcast_url');
    const savedRepeat = localStorage.getItem('saved_repeat_status');
    const savedID = localStorage.getItem('saved_client_id');
    
    if (currentSelectionEl && savedUrl) currentSelectionEl.innerText = savedUrl;
    if (podcastUrlInput && savedUrl) podcastUrlInput.value = savedUrl;
    if (clientIdInput && savedID) clientIdInput.value = savedID;
    if (repeatSwitchInput && savedRepeat) repeatSwitchInput.checked = JSON.parse(savedRepeat);

    // 2. PKCE 驗證所需的隨機字串與編碼加密演算法
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

    // 3. 解析自 Spotify 導回來的網址參數，檢查是否有授權代碼 (code)
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
        exchangeCodeForToken(code);
    } else {
        const token = sessionStorage.getItem('spotify_access_token');
        if (token) {
            authStatus.innerText = '🟢 驗證成功（已連結）';
            // 💡 官方規範：如果刷新網頁時已經有 token，需手動非同步載入 SDK 腳本來觸發初始化
            loadSpotifySDK();
        }
    }

    // 4. 動態載入 SDK 腳本的標準寫法
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

    // 5. 點擊登入：實作符合官方最新安全規範的 PKCE 導向
    authBtn.addEventListener('click', async function() {
        const client_id = clientIdInput.value.trim();
        if(!client_id) { alert('請填寫有效的 Client ID！'); return; }
        localStorage.setItem('saved_client_id', client_id);

        const redirect_uri = window.location.href.split('?')[0].split('#')[0]; 
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

    // 6. 核心後台連線：利用 Code 兌換 Access Token
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

            if (!response.ok) throw new Error('兌換通行證失敗，請檢查 Client ID 是否正確。');

            const data = await response.json();
            if (data.access_token) {
                // 安全防禦改動：將憑證存放於 sessionStorage，避免 XSS 攻擊導致永久憑證外洩
                sessionStorage.setItem('spotify_access_token', data.access_token);
                authStatus.innerText = '🟢 Spotify 連線成功！';
                
                // 清洗網址列，將使用者帶回乾淨的 index.html
                window.history.replaceState({}, document.title, redirect_uri);
                
                // 通行證就緒，立刻通知並初始化播放器
                loadSpotifySDK();
            }
        } catch (error) {
            console.error(error);
            authStatus.innerText = '🔴 驗證換取失敗';
        }
    }

    // 7. 儲存 Podcast 設定與記憶變更
    saveBtn.addEventListener('click', function() {
        const url = podcastUrlInput.value.trim();
        if (url === '' || !url.includes('show/')) { alert('請貼上包含 "show/" 的有效 Spotify 節目網址！'); return; }
        localStorage.setItem('saved_podcast_url', url);
        currentSelectionEl.innerText = url;
        alert('節目設定已儲存！');
    });

    if (repeatSwitchInput) {
        repeatSwitchInput.addEventListener('change', function() {
            localStorage.setItem('saved_repeat_status', JSON.stringify(this.checked));
            if(sessionStorage.getItem('spotify_access_token')) setRepeatMode(this.checked);
        });
    }

    // ==========================================================================
    // 8. 核心自動化需求：在後台自動搜尋最新一集 (Get Show)，並由網頁開播 (Play)
    // ==========================================================================
    startBtn.addEventListener('click', handlePlay);

    async function handlePlay() {
        const currentUrl = localStorage.getItem('saved_podcast_url');
        const token = sessionStorage.getItem('spotify_access_token');

        if (!currentUrl || !token) {
            alert('請確認已成功連結 Spotify 且已儲存指定節目網址！');
            return;
        }

        if (!currentDeviceId) {
            alert('虛擬播放裝置尚未就緒！請確認您是否為 Premium 會員，或嘗試重新登入。');
            return;
        }

        let showId = '';
        try {
            showId = currentUrl.split('show/')[1].split('?')[0];
        } catch(e) {
            alert('無法解析節目 ID，請確認網址格式。');
            return;
        }

        try {
            authStatus.innerText = '🔍 正在後台為您尋找最新一集...';

            // 呼叫 Web API 獲取該節目單集列表 (limit=1 確保拿到的第一筆為最新一集)
            const podcastResponse = await fetch(`https://api.spotify.com/v1/shows/${showId}/episodes?limit=1`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            
            if (!podcastResponse.ok) throw new Error('讀取 Podcast 列表失敗。');
            const podcastData = await podcastResponse.json();

            if (podcastData.items && podcastData.items.length > 0) {
                const latestEpisodeUri = podcastData.items[0].uri;
                const latestEpisodeName = podcastData.items[0].name;
                
                console.log('[自動化] 成功尋獲最新一集：', latestEpisodeName);
                authStatus.innerText = `🎵 正在開播：${latestEpisodeName}`;

                // 💡 官方指南做法：將網頁播放裝置當作接收端，利用 Web API 對特定 device_id 發送播放指令
                await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${currentDeviceId}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ uris: [latestEpisodeUri] })
                });

                // 滿足需求 4：自動帶入當下的循環設定狀態
                const isRepeat = repeatSwitchInput ? repeatSwitchInput.checked : false;
                setRepeatMode(isRepeat);

            } else {
                alert('該節目中沒有任何上架的單集內容。');
                authStatus.innerText = '🟢 播放裝置就緒';
            }
        } catch (error) {
            console.error(error);
            alert('開播連線失敗，請嘗試刷新網頁並重新登入連線。');
            authStatus.innerText = '🔴 播放錯誤';
        }
    }

    // 控制循環播放
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
            console.log('[循環控制] 切換失敗（可能裝置狀態尚未同步）', e);
        }
    }
});