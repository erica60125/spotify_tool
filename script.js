document.addEventListener('DOMContentLoaded', function() {
    
    const currentSelectionEl = document.getElementById('currentSelection');
    const podcastUrlInput = document.getElementById('podcastUrl');
    const repeatSwitchInput = document.getElementById('repeatSwitch');
    const clientIdInput = document.getElementById('clientIdInput');
    
    const authBtn = document.getElementById('authBtn');
    const saveBtn = document.getElementById('saveBtn');
    const startBtn = document.getElementById('startBtn');
    const authStatus = document.getElementById('authStatus');

    let playerInstance = null; 
    let currentDeviceId = null; 

    // ==========================================
    // 1. 初始化與讀取本地紀錄
    // ==========================================
    const savedUrl = localStorage.getItem('saved_podcast_url');
    const savedRepeat = localStorage.getItem('saved_repeat_status');
    const savedID = localStorage.getItem('saved_client_id');
    
    if (currentSelectionEl && savedUrl) currentSelectionEl.innerText = savedUrl;
    if (podcastUrlInput && savedUrl) podcastUrlInput.value = savedUrl;
    if (clientIdInput && savedID) clientIdInput.value = savedID;
    if (repeatSwitchInput && savedRepeat) repeatSwitchInput.checked = JSON.parse(savedRepeat);

    // ==========================================
    // 2. 最新安全規範：PKCE 驗證加密工具函式
    // ==========================================
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

    // ==========================================
    // 3. 處理 Spotify 登入認證 (Authorization Code Flow)
    // ==========================================
    const urlParams = new URLSearchParams(window.location.search);
    let code = urlParams.get('code');

    // 檢查網址列是否有對方的授權 Code 回傳
    if (code) {
        // 馬上拿著 Code 去換取真正的 Access Token
        exchangeCodeForToken(code);
    } else {
        const token = sessionStorage.getItem('spotify_access_token');
        if (token) authStatus.innerText = '🟢 憑證有效（已連結）';
    }

    // 【核心修正】點擊登入：改用 response_type=code
    authBtn.addEventListener('click', async function() {
        const client_id = clientIdInput.value.trim();
        if(!client_id) { alert('請先輸入 Client ID！'); return; }
        localStorage.setItem('saved_client_id', client_id);

        const redirect_uri = "https://erica60125-spotifytool.vercel.app/index.html"; 
        const codeVerifier = generateRandomString(128);
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        
        localStorage.setItem('code_verifier', codeVerifier);

        const scopes = 'streaming user-read-playback-state user-modify-playback-state';
        
        // 組合最新的官方驗證網址
        const authUrl = new URL("https://accounts.spotify.com/authorize");
        const params = {
            response_type: 'code', // 👈 滿足官方最新的安全規範要求
            client_id: client_id,
            scope: scopes,
            redirect_uri: redirect_uri,
            code_challenge_method: 'S256',
            code_challenge: codeChallenge
        };

        authUrl.search = new URLSearchParams(params).toString();
        window.location.href = authUrl.toString(); // 跳轉登入
    });

    // 拿 Code 換 Token 的後台連線
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

            const data = await response.json();
            if (data.access_token) {
                sessionStorage.setItem('spotify_access_token', data.access_token); 
				authStatus.innerText = '🟢 Spotify 驗證成功！';
                // 清除網址列的參數
                window.history.replaceState({}, document.title, redirect_uri);
                // 重新載入 SDK 播放器
                if (window.Spotify) window.onSpotifyWebPlaybackSDKReady();
            }
        } catch (error) {
            console.error('換取 Token 失敗:', error);
            authStatus.innerText = '🔴 連線驗證失敗';
        }
    }

    // 儲存設定
    saveBtn.addEventListener('click', function() {
        const url = podcastUrlInput.value.trim();
        if (url === '') { alert('請輸入網址！'); return; }
        localStorage.setItem('saved_podcast_url', url);
        currentSelectionEl.innerText = url;
        alert('節目儲存成功！');
    });

    if (repeatSwitchInput) {
        repeatSwitchInput.addEventListener('change', function() {
            localStorage.setItem('saved_repeat_status', JSON.stringify(this.checked));
            if(sessionStorage.getItem('spotify_access_token')) setRepeatMode(this.checked);
        });
    }

    // ==========================================
    // 4. 初始化 Spotify Web Playback SDK
    // ==========================================
    window.onSpotifyWebPlaybackSDKReady = () => {
        const token = sessionStorage.getItem('spotify_access_token');
        if (!token) return;

        const player = new Spotify.Player({
            name: '我的磨砂玻璃 Podcast 播放器',
            getOAuthToken: cb => { cb(token); },
            volume: 0.5
        });

        player.addListener('ready', ({ device_id }) => {
            console.log('播放器準備就緒，裝置 ID:', device_id);
            currentDeviceId = device_id;
            playerInstance = player;
        });

        player.addListener('initialization_error', ({ message }) => { console.error('初始化錯誤:', message); });
        player.addListener('authentication_error', ({ message }) => { console.error('驗證錯誤:', message); });
        player.addListener('account_error', ({ message }) => { 
            alert('帳號錯誤：SDK 播放器僅支援 Spotify Premium 付費會員！');
        });

        player.connect();
    };

    // ==========================================
    // 5. 核心：自動搜尋最新一集、開播、設定循環
    // ==========================================
    startBtn.addEventListener('click', handlePlay);

    async function handlePlay() {
        const currentUrl = localStorage.getItem('saved_podcast_url');
        const token = sessionStorage.getItem('spotify_access_token');
		console.info(currentUrl);
        if (!currentUrl || !token) {
            alert('請確認已登入 Spotify 且已儲存節目網址！');
            return;
        }

        if (!currentDeviceId) {
            alert('播放器尚未就緒，請確認你是 Premium 會員或重新登入連線。');
            return;
        }

        let showId = '';
        try {
            showId = currentUrl.split('show/')[1].split('?')[0];
        } catch(e) {
            alert('無法解析該 Podcast 網址。');
            return;
        }

        try {
            // 自動搜尋最新一集 (limit=1)
            const podcastResponse = await fetch(`https://api.spotify.com/v1/shows/${showId}/episodes?limit=1`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const podcastData = await podcastResponse.json();

            if (podcastData.items && podcastData.items.length > 0) {
                const latestEpisodeUri = podcastData.items[0].uri;
                
                // 指揮網頁播放器直接開播
                await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${currentDeviceId}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ uris: [latestEpisodeUri] })
                });

                // 依據畫面的 Switch 決定是否循環
                const isRepeat = repeatSwitchInput ? repeatSwitchInput.checked : false;
                setRepeatMode(isRepeat);

            } else {
                alert('找不到任何單集內容。');
            }
        } catch (error) {
            console.error(error);
            alert('播放失敗，請檢查金鑰或嘗試重新登入。');
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
            console.log('循環播放模式已更新為:', state);
        } catch (e) {
            console.log('設定循環模式失敗', e);
        }
    }
});