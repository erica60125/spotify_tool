// ==========================================================================
// 🌐 1. 全域變數與全域函數（確保任何人、在任何地方都呼叫得到）
// ==========================================================================
let currentDeviceId = null;
let playerInstance = null;

// 💡 修正：將 refreshAccessToken 移至最外層，確保 SDK 監聽器呼叫得到！
async function refreshAccessToken() {
    const client_id = localStorage.getItem('saved_client_id');
    const refresh_token = localStorage.getItem('spotify_refresh_token');

    if (!client_id || !refresh_token) {
        console.log("[Auto-Refresh] 缺少 Client ID 或 Refresh Token，無法自動刷新。");
        return false;
    }

    try {
        console.log("[Auto-Refresh] 正在向 Spotify 總部申請更換全新 Access Token...");
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
            sessionStorage.setItem('spotify_access_token', data.access_token);
            if (data.refresh_token) {
                localStorage.setItem('spotify_refresh_token', data.refresh_token);
            }
            console.log("[Auto-Refresh] ✨ Token 刷新成功！");
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

// 💡 官方 SDK 專用監聽器（必須在全域）
window.onSpotifyWebPlaybackSDKReady = () => {
    const token = sessionStorage.getItem('spotify_access_token');
    if (!token) return;

    const player = new Spotify.Player({
        name: '磨砂玻璃 Podcast 播放小工具',
        getOAuthToken: cb => { cb(token); },
        volume: 0.5
    });

    player.addListener('ready', ({ device_id }) => {
        console.log('[SDK] 播放裝置已就緒！裝置 ID:', device_id);
        currentDeviceId = device_id;
        playerInstance = player;
        const statusEl = document.getElementById('authStatus');
        if (statusEl) statusEl.innerText = '🟢 播放裝置就緒，隨時可開播！';
    });

    player.addListener('authentication_error', async ({ message }) => { 
        console.warn('[SDK 驗證過期] 嘗試啟動自動刷新機制...'); 
        const statusEl = document.getElementById('authStatus');
        if (statusEl) statusEl.innerText = '🔄 憑證過期，正在自動刷新中...';
        
        // 這裡現在可以安全呼叫最上方的全域 refreshAccessToken 了！
        const refreshed = await refreshAccessToken();
        if (refreshed) {
            player.disconnect();
            window.onSpotifyWebPlaybackSDKReady();
        } else {
            if (statusEl) statusEl.innerText = '🔴 憑證已過期，請重新連結';
        }
    });

    player.connect();
};

// ==========================================================================
// 🏠 2. DOM 介面互動與事件綁定（當網頁畫面載入完畢後執行）
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

    // 回復歷史紀錄
    const savedUrl = localStorage.getItem('saved_podcast_url');
    const savedRepeat = localStorage.getItem('saved_repeat_status');
    const savedID = localStorage.getItem('saved_client_id');
    
    if (currentSelectionEl && savedUrl) currentSelectionEl.innerText = savedUrl;
    if (podcastUrlInput && savedUrl) podcastUrlInput.value = savedUrl;
    if (clientIdInput && savedID) clientIdInput.value = savedID;
    if (repeatSwitchInput && savedRepeat) repeatSwitchInput.checked = JSON.parse(savedRepeat);

    // PKCE 工具函式
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

    // 檢查網址列參數是否有 Code
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
        exchangeCodeForToken(code);
    } else {
        const token = sessionStorage.getItem('spotify_access_token');
        if (token) {
            authStatus.innerText = '🟢 驗證成功（已連結）';
            loadSpotifySDK();
        } else if (localStorage.getItem('spotify_refresh_token')) {
            refreshAccessToken().then(success => {
                if (success) loadSpotifySDK();
            });
        }
    }

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

    // 點擊登入連線
    authBtn.addEventListener('click', async function() {
        const client_id = clientIdInput.value.trim();
        if(!client_id) { alert('請填寫有效的 Client ID！'); return; }
        localStorage.setItem('saved_client_id', client_id);

        const redirect_uri = "https://erica60125-spotifytool.vercel.app/index.html"; 
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

    // Code 換 Token
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

    // 儲存設定
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

    // 點擊 START 播放最新一集
    startBtn.addEventListener('click', handlePlay);

    async function handlePlay() {
        let token = sessionStorage.getItem('spotify_access_token');
        const currentUrl = localStorage.getItem('saved_podcast_url');

        if (!currentUrl) { alert('請先儲存指定節目網址！'); return; }

        let showId = '';
        try { showId = currentUrl.split('show/')[1].split('?')[0]; } catch(e) { alert('網址格式錯誤。'); return; }

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

            let podcastResponse = await fetch(`https://api.spotify.com/v1/shows/${showId}/episodes?limit=1`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            
            if (podcastResponse.status === 401) {
                console.log("[API 防禦] Token 過期，原地啟動背景刷新...");
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

                await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${currentDeviceId}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ uris: [latestEpisodeUri] })
                });

                const isRepeat = repeatSwitchInput ? repeatSwitchInput.checked : false;
                setRepeatMode(isRepeat);

            } else {
                alert('該節目中沒有單集內容。');
                authStatus.innerText = '🟢 播放裝置就緒';
            }
        } catch (error) {
            console.error(error);
            alert(error.message || '開播失敗，請重新嘗試登入。');
            authStatus.innerText = '🔴 播放錯誤';
        }
    }

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
            console.log('[循環控制] 切換失敗', e);
        }
    }
});