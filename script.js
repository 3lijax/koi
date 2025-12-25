// --- Configuration & Constants ---
const CONFIG = {
    app_id: 1089, // Public Test App ID
    ws_url: 'wss://ws.binaryws.com/websockets/v3',
    max_ticks: 100, // Analysis window
    chart_points: 50
};

// Index Mapping (UI Name -> API Symbol)
const MARKET_ASSETS = {
    volatility: [
        { name: 'Volatility 10 (1s)', symbol: '1HZ10V' },
        { name: 'Volatility 100 (1s)', symbol: '1HZ100V' },
        { name: 'Volatility 10', symbol: 'R_10' },
        { name: 'Volatility 25', symbol: 'R_25' },
        { name: 'Volatility 50', symbol: 'R_50' },
        { name: 'Volatility 75', symbol: 'R_75' },
        { name: 'Volatility 100', symbol: 'R_100' }
    ],
    boom_crash: [
        { name: 'Boom 300', symbol: 'BOOM300' }, // May need checking
        { name: 'Boom 500', symbol: 'BOOM500' },
        { name: 'Boom 1000', symbol: 'BOOM1000' },
        { name: 'Crash 300', symbol: 'CRASH300' },
        { name: 'Crash 500', symbol: 'CRASH500' },
        { name: 'Crash 1000', symbol: 'CRASH1000' }
    ],
    step: [
        { name: 'Step Index', symbol: 'STEP' }
        // Note: Step indices usually just have "Step Index" on Deriv, adding ranges might be custom/unsupported.
    ],
    jump: [
        { name: 'Jump 10', symbol: 'JUMP_10' },
        { name: 'Jump 25', symbol: 'JUMP_25' },
        { name: 'Jump 50', symbol: 'JUMP_50' },
        { name: 'Jump 75', symbol: 'JUMP_75' },
        { name: 'Jump 100', symbol: 'JUMP_100' }
    ]
};

// --- State Management ---
const State = {
    ws: null,
    ticks: [], // Array of { quote, epoch, digit }
    currentSymbol: '1HZ10V',
    currentStrategy: 'even_odd',
    isAuthenticated: false,
    chart: null,
    lastDigit: null
};

// --- DOM Elements ---
const DOM = {
    views: {
        login: document.getElementById('login-view'),
        dashboard: document.getElementById('dashboard-view')
    },
    loginForm: document.getElementById('login-form'),
    selectors: {
        category: document.getElementById('market-category-select'),
        asset: document.getElementById('asset-select'),
        strategy: document.getElementById('strategy-select')
    },
    display: {
        price: document.getElementById('current-price'),
        lastDigit: document.getElementById('last-digit'),
        clock: document.getElementById('clock-display'),
        marketTitle: document.getElementById('market-title'),
        statsContent: document.getElementById('stats-content'),
        digitGrid: document.getElementById('digit-grid'),
        predictionPanel: document.getElementById('prediction-result-panel'),
        finalPrediction: document.getElementById('final-prediction'),
        confidenceBar: document.getElementById('confidence-bar'),
        confidenceText: document.getElementById('confidence-text')
    },
    btn: {
        predict: document.getElementById('predict-btn'),
        logout: document.getElementById('logout-btn')
    }
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();
    initChart();
});

function checkAuth() {
    if (localStorage.getItem('authToken')) {
        State.isAuthenticated = true;
        showView('dashboard');
        initMarketSelectors();
        connectWS();
    } else {
        showView('login');
    }
}

function setupEventListeners() {
    // Login
    DOM.loginForm.addEventListener('submit', (e) => {
        e.preventDefault();

        // Remember Me Logic
        const usernameInput = document.getElementById('username');
        const rememberMe = document.getElementById('remember-me').checked;

        if (rememberMe) {
            localStorage.setItem('rememberedUser', usernameInput.value);
        } else {
            localStorage.removeItem('rememberedUser');
        }

        // Simulate Login
        const btn = DOM.loginForm.querySelector('button');
        const original = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Authenticating...';

        setTimeout(() => {
            localStorage.setItem('authToken', 'mock_token');
            checkAuth();
            btn.innerHTML = original;
        }, 800);
    });

    // Check for remembered user
    const savedUser = localStorage.getItem('rememberedUser');
    if (savedUser) {
        document.getElementById('username').value = savedUser;
        document.getElementById('remember-me').checked = true;
    }

    // Logout
    DOM.btn.logout.addEventListener('click', () => {
        localStorage.removeItem('authToken');
        closeWS();
        window.location.reload();
    });

    // Market Selectors - Category Change
    DOM.selectors.category.addEventListener('change', (e) => {
        populateAssetSelect(e.target.value);
    });

    // Asset Change
    DOM.selectors.asset.addEventListener('change', (e) => {
        State.currentSymbol = e.target.value;
        State.ticks = []; // Clear history
        updateMarketTitle();
        connectWS(); // Reconnect with new symbol
    });

    // Strategy Change
    DOM.selectors.strategy.addEventListener('change', (e) => {
        State.currentStrategy = e.target.value;
        renderStatsUI();
        updateStats(); // Recalculate based on existing data
    });

    // Predict Button
    DOM.btn.predict.addEventListener('click', () => {
        generatePrediction();
    });
}

function initMarketSelectors() {
    populateAssetSelect('volatility'); // Default
}

function populateAssetSelect(category) {
    const assets = MARKET_ASSETS[category];
    DOM.selectors.asset.innerHTML = '';

    if (assets) {
        assets.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.symbol;
            opt.textContent = a.name;
            DOM.selectors.asset.appendChild(opt);
        });
        // Set first as current
        State.currentSymbol = assets[0].symbol;
        updateMarketTitle();
    }
}

function updateMarketTitle() {
    const assetName = DOM.selectors.asset.options[DOM.selectors.asset.selectedIndex].text;
    DOM.display.marketTitle.innerText = assetName;
}

function showView(name) {
    DOM.views.login.classList.add('hidden');
    DOM.views.dashboard.classList.add('hidden');
    DOM.views[name].classList.remove('hidden');
}

// --- WebSocket Logic ---
function connectWS() {
    closeWS(); // Ensure clean slate

    State.ws = new WebSocket(`${CONFIG.ws_url}?app_id=${CONFIG.app_id}`);

    State.ws.onopen = () => {
        console.log('Connected to Deriv');
        State.ws.send(JSON.stringify({
            ticks: State.currentSymbol,
            subscribe: 1
        }));
    };

    State.ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.tick) {
            handleTick(data.tick);
        } else if (data.error) {
            console.error('API Error:', data.error.message);
            // Fallback for invalid symbols (like custom generic ones)
            if (data.error.code === 'MarketIsClosed' || data.error.code === 'InvalidSymbol') {
                alert(`Error: ${data.error.message}`);
            }
        }
    };
}

function closeWS() {
    if (State.ws) {
        State.ws.close();
        State.ws = null;
    }
}

function handleTick(tick) {
    const price = tick.quote;
    const epoch = tick.epoch;
    const digit = parseInt(price.toFixed(tick.pip_size || 5).slice(-1)); // Robust digit extraction

    // State Update
    State.lastDigit = digit;
    State.ticks.push({ price, digit, epoch });
    if (State.ticks.length > CONFIG.max_ticks) State.ticks.shift();

    // UI Updates
    DOM.display.price.innerText = price;
    DOM.display.lastDigit.innerText = digit;
    DOM.display.clock.innerText = new Date(epoch * 1000).toLocaleTimeString();

    // Colorize Last Digit Box
    const digitBox = document.getElementById('last-digit-box');
    if (digit % 2 === 0) {
        digitBox.style.borderColor = 'var(--accent-green)';
        DOM.display.lastDigit.style.color = 'var(--accent-green)';
    } else {
        digitBox.style.borderColor = 'var(--primary)';
        DOM.display.lastDigit.style.color = 'var(--primary)';
    }

    // Trigger Analyzers
    updateChart(price);
    updateStats();
    updateDigitHeatmap();
}

// --- Analysis Engine ---
function updateStats() {
    if (State.ticks.length === 0) return;

    const total = State.ticks.length;
    let html = '';

    if (State.currentStrategy === 'even_odd') {
        const evens = State.ticks.filter(t => t.digit % 2 === 0).length;
        const odds = total - evens;
        const evenPct = ((evens / total) * 100).toFixed(1);
        const oddPct = (100 - evenPct).toFixed(1);

        html = `
            <div class="default-stats">
                <div class="stat-row">
                    <span>Even</span>
                    <div class="progress"><div class="bar" style="width: ${evenPct}%; background: var(--accent-green)"></div></div>
                    <span>${evenPct}%</span>
                </div>
                <div class="stat-row">
                    <span>Odd</span>
                    <div class="progress"><div class="bar" style="width: ${oddPct}%; background: var(--primary)"></div></div>
                    <span>${oddPct}%</span>
                </div>
            </div>
        `;
    } else if (State.currentStrategy === 'matches_differs') {
        // Matches/Differs usually focuses on the last digit. 
        // Showing stats for "Matches Last Digit" vs "Differs" would be simulated here
        // or just showing frequency of the *current* last digit in history.
        const target = State.lastDigit;
        const matches = State.ticks.filter(t => t.digit === target).length;
        const matchPct = ((matches / total) * 100).toFixed(1);
        const differPct = (100 - matchPct).toFixed(1);

        html = `
            <div class="default-stats">
                <div class="stat-row">
                    <span>Match (${target})</span>
                    <div class="progress"><div class="bar" style="width: ${matchPct}%; background: var(--accent-gold)"></div></div>
                    <span>${matchPct}%</span>
                </div>
                <div class="stat-row">
                    <span>Differ</span>
                    <div class="progress"><div class="bar" style="width: ${differPct}%; background: var(--primary)"></div></div>
                    <span>${differPct}%</span>
                </div>
            </div>
        `;
    } else if (State.currentStrategy === 'over_under') {
        // Over/Under 4.5 is a common standard reference
        const over = State.ticks.filter(t => t.digit > 4).length;
        const under = total - over;
        const overPct = ((over / total) * 100).toFixed(1);

        html = `
            <div class="default-stats">
                <div class="stat-row">
                    <span>Over 4</span>
                    <div class="progress"><div class="bar" style="width: ${overPct}%; background: var(--accent-red)"></div></div>
                    <span>${overPct}%</span>
                </div>
                <div class="stat-row">
                    <span>Under 5</span>
                    <div class="progress"><div class="bar" style="width: ${100 - overPct}%; background: var(--primary)"></div></div>
                    <span>${(100 - overPct).toFixed(1)}%</span>
                </div>
            </div>
        `;
    }

    DOM.display.statsContent.innerHTML = html;
}

function updateDigitHeatmap() {
    const counts = Array(10).fill(0);
    State.ticks.forEach(t => counts[t.digit]++);
    const total = State.ticks.length;
    const maxFreq = Math.max(...counts);

    DOM.display.digitGrid.innerHTML = '';

    counts.forEach((count, digit) => {
        const pct = ((count / total) * 100).toFixed(0);
        const div = document.createElement('div');
        div.className = 'digit-box';

        if (count === maxFreq) div.classList.add('hot');
        else if (count === 0) div.classList.add('cold');

        div.innerHTML = `
            <span class="d-num" style="color: ${digit % 2 === 0 ? 'var(--accent-green)' : 'var(--primary)'}">${digit}</span>
            <span class="d-pct">${pct}%</span>
        `;
        DOM.display.digitGrid.appendChild(div);
    });
}

function generatePrediction() {
    DOM.display.predictionPanel.classList.remove('hidden');
    DOM.display.finalPrediction.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    DOM.display.confidenceText.innerText = 'Calculating...';
    DOM.display.confidenceBar.style.width = '0%';

    setTimeout(() => {
        // Algorithmic Prediction Logic
        // This is a statistical simulation based on "Reversion to Mean" or "Trend Following" depending on state

        let result = '--';
        let confidence = 0;
        const total = State.ticks.length;

        if (State.currentStrategy === 'even_odd') {
            const evens = State.ticks.filter(t => t.digit % 2 === 0).length;
            const deviation = Math.abs(evens - (total / 2)); // How far from 50/50

            // Reversion Logic: If Even is 70%, predict Odd.
            if (evens > total * 0.55) {
                result = 'ODD';
                confidence = 50 + (evens - (total * 0.5)); // e.g., 70% even -> 70% confidence in Odd
            } else if (evens < total * 0.45) {
                result = 'EVEN';
                confidence = 50 + ((total * 0.5) - evens);
            } else {
                result = 'HOLD';
                confidence = 30;
            }
        }
        else if (State.currentStrategy === 'matches_differs') {
            // Differs is almost always high probability (90%), so let's predict Matches if a number hasn't appeared in a long time (Gambler's Fallacy logic often requested in these tools)
            const counts = Array(10).fill(0);
            State.ticks.forEach(t => counts[t.digit]++);
            const minFreq = Math.min(...counts);
            const rarestDigit = counts.indexOf(minFreq); // Most likely to appear strictly by "balancing" logic

            result = `MATCH ${rarestDigit}`;
            confidence = (100 - (minFreq / total) * 100);
        }
        else {
            // Over/Under
            const over = State.ticks.filter(t => t.digit > 4).length;
            if (over > total * 0.6) {
                result = 'UNDER';
                confidence = 65;
            } else {
                result = 'OVER';
                confidence = 65;
            }
        }

        // Clamp confidence
        confidence = Math.min(Math.max(confidence, 10), 95);

        // Display Result
        DOM.display.finalPrediction.innerText = result;
        DOM.display.finalPrediction.style.color = confidence > 70 ? 'var(--accent-green)' : 'var(--accent-gold)';

        DOM.display.confidenceBar.style.width = `${confidence}%`;
        DOM.display.confidenceBar.style.background = confidence > 70 ? 'var(--accent-green)' : 'var(--accent-red)';
        DOM.display.confidenceText.innerText = `Confidence: ${confidence.toFixed(1)}%`;

    }, 1000);
}

// --- Charting ---
function initChart() {
    const ctx = document.getElementById('tickChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(0, 230, 118, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 230, 118, 0.0)');

    State.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(CONFIG.chart_points).fill(''),
            datasets: [{
                data: Array(CONFIG.chart_points).fill(null),
                borderColor: '#00e676',
                backgroundColor: gradient,
                borderWidth: 2,
                pointRadius: 2,
                pointHoverRadius: 5,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: {
                    position: 'right',
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#8b949e', font: { size: 10 } }
                }
            },
            animation: false
        }
    });
}

function updateChart(price) {
    if (!State.chart) return;

    const data = State.chart.data.datasets[0].data;
    data.push(price);
    if (data.length > CONFIG.chart_points) data.shift();

    // Dynamic Y-axis adjustment happens automatically by Chart.js usually, 
    // but explicit updates help smoothness
    State.chart.update('none'); // 'none' mode for performance
}

function renderStatsUI() {
    // Initial Render call when strategy changes, actual data comes from updateStats()
    DOM.display.statsContent.innerHTML = '<div style="text-align:center; padding:10px; color:var(--text-muted)">Collecting data...</div>';
}
