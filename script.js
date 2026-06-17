// ==========================================================================
// 🌐 1. 全域變數與全域函數
// ==========================================================================
let currentDeviceId = null;
let playerInstance = null;

// 進度條追蹤專用變數
let progressInterval = null; 
let currentProgressMs = 0;  
let totalDurationMs = 0;   
let isUserDragging = false; // 👈 關鍵防禦：標記使用者目前是否正在動手拖拉進度條

async function refreshAccessToken() {
    const client_id = localStorage.getItem('saved_client_id');
    const refresh_token = localStorage.getItem('spotify_refresh_token');
    const tokenExists = sessionStorage.getItem('spotify_access_token');
    const lastRefreshTime = sessionStorage.getItem('spotify_last_refresh_time');

    if (tokenExists && lastRefreshTime) {
        const currentTime = Date.now();
        const thirtyMinutes = 30 * 60 * 1000;
        if (currentTime - parseInt(lastRefreshTime) < thirtyMinutes) return true; 
    }
    if (!client_id || !refresh_token) return false;

    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh_token, client_id: client_id })
        });
        const data = await response.json();
        if (data.access_token) {
            sessionStorage.setItem('spotify_access_token', data.access_token);
            sessionStorage.setItem('spotify_last_refresh_time', Date.now().toString());
            const authStatus = document.getElementById('authStatus');
            if (authStatus) authStatus.innerText = '🟢 憑證已背景自動更新';
            return true;
        }
    } catch (error) { console.error(error); return false; }
    return false;
}

// 毫秒轉成人類看得懂的 MM:SS 格式
function formatTime(ms) {
    if (isNaN(ms) || ms < 0) return "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

window.onSpotifyWebPlaybackSDKReady = () => {
    const token = sessionStorage.getItem('spotify_access_token');
    if (!token) return;

    if (playerInstance) { try { playerInstance.disconnect(); } catch(e){} }

    const player = new Spotify.Player({
        name: '磨砂玻璃 Podcast 播放小工具',
        getOAuthToken: cb => { cb(token); },
        volume: 0.5
    });

    player.addListener('ready', ({ device_id }) => {
        currentDeviceId = device_id;
        playerInstance = player;
        const statusEl = document.getElementById('authStatus');
        if (statusEl) statusEl.innerText = '🟢 播放裝置就緒，隨時可開播！';
    });

    // 🎵 狀態監聽中心
    player.addListener('player_state_changed', state => {
        if (!state) {
            clearInterval(progressInterval);
            return;
        }

        // A. 擷取當前單集名稱與長度
        const currentTrack = state.track_window.current_track;
        if (currentTrack) {
            document.getElementById('trackTitle').innerText = currentTrack.name;
            document.getElementById('trackArtist').innerText = currentTrack.artists.map(a => a.name).join(', ');
        }

        // B. 同步播放暫停圖標
        const playToggleBtn = document.getElementById('playToggleBtn');
        if (playToggleBtn) {
            playToggleBtn.innerHTML = state.paused 
                ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>' 
                : '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
        }
        
        // C. 【進度條核心邏輯】
        totalDurationMs = state.duration;
        document.getElementById('timeTotal').innerText = formatTime(totalDurationMs);
        
        // 只有在使用者「沒有手動拉著拉條」時，才允許程式同步更新目前的毫秒進度
        if (!isUserDragging) {
            currentProgressMs = state.position;
            updateProgressBarUI();
        }

        // D. 智慧計時器管理：音樂在播就啟動計時，音樂暫停就立刻凍結計時，節省手機效能
        clearInterval(progressInterval);
        if (!state.paused && !isUserDragging) {
            progressInterval = setInterval(() => {
                currentProgressMs += 1000; // 每秒在前台自己加 1000 毫秒
                if (currentProgressMs > totalDurationMs) currentProgressMs = totalDurationMs;
                updateProgressBarUI();
            }, 1000);
        }

        // E. 【循環連動機制】：檢查後台的 repeat_mode 是不是單曲循環 (2)
        const isCurrentlyRepeating = (state.repeat_mode === 2);
        
        // 同步回到面板按鈕
        const panelRepeatBtn = document.getElementById('panelRepeatBtn');
        if (panelRepeatBtn) {
            if (isCurrentlyRepeating) panelRepeatBtn.classList.add('active');
            else panelRepeatBtn.classList.remove('active');
        }

        // 同步回到上方 Switch
        const repeatSwitchInput = document.getElementById('repeatSwitch');
        if (repeatSwitchInput) {
            repeatSwitchInput.checked = isCurrentlyRepeating;
        }
        localStorage.setItem('saved_repeat_status', JSON.stringify(isCurrentlyRepeating));
    });

    player.addListener('authentication_error', async () => { await refreshAccessToken(); });
    player.connect();
};

// 負責把毫秒數據刷新到前端畫面的工具函式
function updateProgressBarUI() {
    const progressBar = document.getElementById('progressBar');
    const timeCurrent = document.getElementById('timeCurrent');
    
    if (progressBar && timeCurrent && totalDurationMs > 0) {
        timeCurrent.innerText = formatTime(currentProgressMs);
        // 算出當前播放百分比
        const percentage = (currentProgressMs / totalDurationMs) * 100;
        progressBar.value = percentage;
    }
}

// ==========================================================================
// 🏠 2. DOM 介面互動與事件監聽
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

    const playToggleBtn = document.getElementById('playToggleBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    
    // 🎵 宣告進度條與面板循環按鈕
    const progressBar = document.getElementById('progressBar');
    const panelRepeatBtn = document.getElementById('panelRepeatBtn');

    // 回復紀錄
    const savedUrl = localStorage.getItem('saved_podcast_url');
    const savedRepeat = localStorage.getItem('saved_repeat_status');
    const savedID = localStorage.getItem('saved_client_id');
    
    if (currentSelectionEl && savedUrl) currentSelectionEl.innerText = savedUrl;
    if (podcastUrlInput && savedUrl) podcastUrlInput.value = savedUrl;
    if (clientIdInput && savedID) clientIdInput.value = savedID;
    if (repeatSwitchInput && savedRepeat) repeatSwitchInput.checked = JSON.parse(savedRepeat);

    function generateRandomString(length) {
        let text = '';
        let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < length; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); }
        return text;
    }

    async function generateCodeChallenge(codeVerifier) {
        function base64encode(string) { return btoa(String.fromCharCode.apply(null, new Uint8Array(string))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        return base64encode(digest);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) { exchangeCodeForToken(code); } 
    else {
        const token = sessionStorage.getItem('spotify_access_token');
        if (token) { authStatus.innerText = '🟢 驗證成功（已連結）'; loadSpotifySDK(); } 
        else if (localStorage.getItem('spotify_refresh_token')) {
            refreshAccessToken().then(success => { if (success) loadSpotifySDK(); });
        }
    }

    function loadSpotifySDK() {
        if (window.Spotify) { window.onSpotifyWebPlaybackSDKReady(); return; }
        const script = document.createElement('script');
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        document.head.appendChild(script);
    }

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
            response_type: 'code', client_id: client_id, scope: scopes, redirect_uri: redirect_uri, code_challenge_method: 'S256', code_challenge: codeChallenge
        }).toString();
        window.location.href = authUrl.toString(); 
    });

    async function exchangeCodeForToken(code) {
        const client_id = localStorage.getItem('saved_client_id');
        const codeVerifier = localStorage.getItem('code_verifier');
        const redirect_uri = window.location.href.split('?')[0].split('#')[0];

        try {
            const response = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ client_id: client_id, grant_type: 'authorization_code', code: code, redirect_uri: redirect_uri, code_verifier: codeVerifier })
            });
            const data = await response.json();
            if (data.access_token) {
                sessionStorage.setItem('spotify_access_token', data.access_token);
                sessionStorage.setItem('spotify_last_refresh_time', Date.now().toString());
                if (data.refresh_token) { localStorage.setItem('spotify_refresh_token', data.refresh_token); }
                authStatus.innerText = '🟢 Spotify 連線成功！';
                window.history.replaceState({}, document.title, redirect_uri);
                loadSpotifySDK();
            }
        } catch (error) { console.error(error); }
    }

    saveBtn.addEventListener('click', function() {
        const url = podcastUrlInput.value.trim();
        if (url === '' || !url.includes('show/')) { alert('請貼上包含 "show/" 的有效 Spotify 節目網址！'); return; }
        localStorage.setItem('saved_podcast_url', url);
        currentSelectionEl.innerText = url;
        alert('節目設定已儲存！');
    });

    // ─── 🕒 【全新功能：進度條拖拉操控事件】 ───
    if (progressBar) {
        // 使用者「正在拉動」進度條：凍結背景計時器，即時改變左側的當前時間字樣
        progressBar.addEventListener('input', function() {
            isUserDragging = true;
            const targetMs = (this.value / 1000) * totalDurationMs; 
            currentProgressMs = Math.floor((this.value / 100) * totalDurationMs);
            document.getElementById('timeCurrent').innerText = formatTime(currentProgressMs);
        });

        // 使用者「放開」手指/滑鼠：正式發送 seek 指令回傳給 Spotify 總部，並解除凍結
        progressBar.addEventListener('change', function() {
            if (playerInstance) {
                const seekToMs = Math.floor((this.value / 100) * totalDurationMs);
                playerInstance.seek(seekToMs).then(() => {
                    console.log(`[拉條操控] 成功跳轉播放進度至: ${seekToMs} 毫秒`);
                    // 延遲 0.5 秒再解鎖，等待伺服器狀態完全同步，體驗最滑順
                    setTimeout(() => { isUserDragging = false; }, 500);
                });
            } else {
                isUserDragging = false;
            }
        });
    }

    // ─── 🔁 【全新功能：面板內循環按鈕點擊】 ───
    if (panelRepeatBtn) {
        panelRepeatBtn.addEventListener('click', () => {
            const currentSwitchState = repeatSwitchInput ? repeatSwitchInput.checked : false;
            // 原地將目前的循環設定翻轉 (True 變 False，False 變 True)
            const nextState = !currentSwitchState;
            
            // 直接呼叫控制函式
            setRepeatMode(nextState);
        });
    }

    // 上方 Switch 開關連動
    if (repeatSwitchInput) {
        repeatSwitchInput.addEventListener('change', function() {
            localStorage.setItem('saved_repeat_status', JSON.stringify(this.checked));
            if(sessionStorage.getItem('spotify_access_token')) setRepeatMode(this.checked);
        });
    }

    if (playToggleBtn) playToggleBtn.addEventListener('click', () => { if (playerInstance) playerInstance.togglePlay(); });
    if (prevBtn) prevBtn.addEventListener('click', () => { if (playerInstance) playerInstance.previousTrack(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { if (playerInstance) playerInstance.nextTrack(); });

    startBtn.addEventListener('click', handlePlay);

    async function handlePlay() {
        let token = sessionStorage.getItem('spotify_access_token');
        const currentUrl = localStorage.getItem('saved_podcast_url');

        if (!currentUrl) { alert('請先儲存節目網址！'); return; }
        let showId = '';
        try { showId = currentUrl.split('show/')[1].split('?')[0]; } catch(e) { return; }

        if (!token && localStorage.getItem('spotify_refresh_token')) {
            const success = await refreshAccessToken();
            if (success) { token = sessionStorage.getItem('spotify_access_token'); } else return;
        }

        try {
            authStatus.innerText = '🔍 正在後台為您尋找最新一集...';
            let podcastResponse = await fetch(`https://api.spotify.com/v1/shows/${showId}/episodes?limit=1`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            
            if (podcastResponse.status === 401) {
                const success = await refreshAccessToken();
                if (success) {
                    token = sessionStorage.getItem('spotify_access_token');
                    podcastResponse = await fetch(`https://api.spotify.com/v1/shows/${showId}/episodes?limit=1`, { headers: { 'Authorization': 'Bearer ' + token } });
                } else return;
            }

            const podcastData = await podcastResponse.json();
            if (podcastData.items && podcastData.items.length > 0) {
                const latestEpisodeUri = podcastData.items[0].uri;
                
                await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${currentDeviceId}`, {
                    method: 'PUT',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uris: [latestEpisodeUri] })
                });

                const isRepeat = repeatSwitchInput ? repeatSwitchInput.checked : false;
                setRepeatMode(isRepeat);
            }
        } catch (error) { console.error(error); }
    }

    async function setRepeatMode(isRepeat) {
        const token = sessionStorage.getItem('spotify_access_token');
        const state = isRepeat ? 'track' : 'off';
        if (!token) return;
        try {
            await fetch(`https://api.spotify.com/v1/me/player/repeat?state=${state}`, { method: 'PUT', headers: { 'Authorization': 'Bearer ' + token } });
            console.log('[智慧同步] 循環播放成功切換為:', state);
        } catch (e) { console.log(e); }
    }
});