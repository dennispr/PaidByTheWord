// TopWordsEngine.js — Videogame Workshop LLC

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------


const START_SCORE = 0;
const MAX_PITCHES = 5;
const RENT = 150;
const WIN_SCORE = RENT;

// Words that don't count toward score (allow natural sentence writing)
const STOP_WORDS = new Set([
    'THE','A','AN','AND','OR','BUT','IN','ON','AT','TO','FOR','OF','WITH','BY',
    'FROM','IS','WAS','ARE','WERE','BE','BEEN','HAVE','HAS','HAD','DO','DID',
    'DOES','WILL','WOULD','COULD','SHOULD','MAY','MIGHT','SHALL','THAT','THIS',
    'THESE','THOSE','IT','ITS','AS','IF','NOT','NO','SO','UP','OUT','THAN',
    'THEN','WHEN','WHERE','WHO','HOW','ALL','SOME','ONE','TWO','CAN','GET',
    'GOT','THEY','THEM','THEIR','WE','OUR','YOU','YOUR','I','MY','ME'
]);



let DATA = [];
let book = null;
let wordCounts = {};
let pitches = [];   // { text, wordResults:[{word,score}], pitchScore }
let bestPitchScore = 0;
let bestPitchIndex = -1;  // 1-based pitch number of the best pitch
let top3sum = 1;

// Confetti helper (dynamically imported when needed)
let _confetti = null;
async function maybeLoadConfetti() {
    if (_confetti) return _confetti;
    try {
        const mod = await import('./confetti.js');
        _confetti = mod; return _confetti;
    } catch (e) {
        console.warn('Confetti load failed', e);
        return null;
    }
}

// -----------------------------------------------------------------------------
// DOM helpers
// -----------------------------------------------------------------------------
const $ = sel => document.querySelector(sel);
//This is regex!
const escapeHtml = str => String(str).replace(/["'&<>]/g, c => ({
    '"': '&quot;',
    "'": '&#39;',
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
}[c]));

// -----------------------------------------------------------------------------
// Bank helpers
// -----------------------------------------------------------------------------

function renderScore(pitchScore = 0) {
    const bankEl = $('#bank');
    const formatScore = (val) => val > 0
        ? `Best pitch: $${val}<br><br>${val >= RENT ? '🎉 Rent covered!' : `Need $${Math.round(RENT - val)} more to make rent!`}`
        : `Best pitch: $0<br><br>Need $${RENT} to make rent!`;
    if (pitchScore > 0) {
        bankEl.classList.add('flash-green');
        bankEl.innerHTML = formatScore(bestPitchScore);
        setTimeout(() => bankEl.classList.remove('flash-green'), 500);
        // trigger confetti on a pitch that beats rent
        if (bestPitchScore >= RENT) {
            maybeLoadConfetti().then(m => {
                if (!m || typeof m.burst !== 'function') return;
                const target = document.querySelector('.clue.book-title-responsive');
                let x = Math.round(window.innerWidth / 2);
                let y = 160;
                if (target) {
                    const r = target.getBoundingClientRect();
                    x = Math.round(r.left + r.width / 2 + window.scrollX);
                    y = Math.max(60, Math.round(r.top + window.scrollY - (r.height * 0.25)));
                }
                m.burst({ x, y, count: 40, emoji: '💵', duration: 1200 });
            });
        }
    } else {
        bankEl.innerHTML = formatScore(bestPitchScore);
    }
}

function canSpend(a) {
    return cash >= a;
}
function spend(a) {
    if (!canSpend(a)) return false;
    cash -= a;
    renderBank();
    return true;
}
function showGameOver(msg = 'Game over!') {
    $('#guess').disabled = true;
    $('#submitGuess').disabled = true;
    $('#revealText').textContent = msg;
    $('#reveal').hidden = false;
}

// -----------------------------------------------------------------------------
// Round + book control
// -----------------------------------------------------------------------------

function chooseBook() {
    if (!DATA.length) { console.warn('No books loaded.'); return; }
    console.log('DATA:', DATA);
    book = DATA[Math.floor(Math.random() * DATA.length)];
    console.log('Chosen book:', book);
    // Normalize all word keys to uppercase for consistent comparison
    const rawCounts = (book.WORD_COUNTS || book.WORD_COUNTS_RAW || {});
    console.log('rawCounts keys:', Object.keys(rawCounts));
    wordCounts = {};
    for (const k in rawCounts) {
        if (Object.hasOwn(rawCounts, k)) {
            wordCounts[k.toUpperCase()] = rawCounts[k];
        }
    }
    console.log('wordCounts keys:', Object.keys(wordCounts));
    pitches = [];
    bestPitchScore = 0;
    bestPitchIndex = -1;
    // Reset live pitch display
    const livePitchWrap = document.getElementById('livePitchWrap');
    if (livePitchWrap) livePitchWrap.style.display = 'none';
    const livePitchEl = document.getElementById('livePitch');
    if (livePitchEl) livePitchEl.innerHTML = '';
    // Compute top 3 word counts sum for normalization
    const sortedCounts = Object.values(wordCounts).sort((a, b) => b - a);
    top3sum = (sortedCounts[0] || 0) + (sortedCounts[1] || 0) + (sortedCounts[2] || 0) || 1;
}

function newRound() {
    chooseBook();
    // Set the book title in the UI
    const titleEl = document.getElementById('currentBookTitle');
    if (titleEl && book && book.title) {
        titleEl.textContent = book.title;
    }
    const guessCounter = document.getElementById('guessCounter');
    if (guessCounter) {
        guessCounter.textContent = `Pitches left: ${MAX_PITCHES}`;
    }
    // Reset score display
    const bankEl = document.getElementById('bank');
    if (bankEl) {
        bankEl.innerHTML = `Script earnings: $0<br><br>Need $${RENT} more to make rent!`;
        bankEl.dataset.score = START_SCORE;
    }
    renderScore();
    render();
}

// -----------------------------------------------------------------------------
// Pitch scoring helpers
// -----------------------------------------------------------------------------

function scoreWord(word) {
    const w = word.toUpperCase();
    if (!wordCounts[w]) return 0;
    return Math.round((wordCounts[w] / top3sum) * 100 * 100) / 100;
}

// Returns 'high' | 'mid' | 'stop' | 'none'
function getWordTier(word, score) {
    const w = word.toUpperCase();
    if (STOP_WORDS.has(w)) return 'stop';
    if (score >= 15) return 'high';
    if (score > 0) return 'mid';
    return 'none';
}

// Returns HTML markup of a pitch sentence with per-word coloring
function renderPitchMarkup(pitchText) {
    const tokens = pitchText.split(/(\s+)/);
    return tokens.map(token => {
        if (/^\s+$/.test(token)) return token;
        const bare = token.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
        if (!bare) return escapeHtml(token);
        const s = scoreWord(bare);
        const tier = getWordTier(bare, s);
        const label = tier === 'none' ? 'not in the original' :
                      tier === 'stop' ? '' :
                      `used ${wordCounts[bare.toUpperCase()]} times (+$${s})`;
        return `<span class="pitch-word pitch-${tier} revealed" title="${escapeHtml(label)}">${escapeHtml(token)}</span>`;
    }).join('');
}

// -----------------------------------------------------------------------------
// Pitching
// -----------------------------------------------------------------------------

function submitPitch(pitchText) {
    if (!book) return;
    if (pitches.length >= MAX_PITCHES) return;
    const text = pitchText.trim();
    if (!text) return;

    // Disable input during animation
    $('#guess').disabled = true;
    $('#submitGuess').disabled = true;

    // Score unique non-stop words in this pitch
    const tokens = text.split(/(\s+)/);
    const seen = new Set();
    let pitchScore = 0;
    const wordResults = [];

    // Pre-compute per-token data
    const tokenData = tokens.map(token => {
        if (/^\s+$/.test(token)) return { token, bare: null };
        const bare = token.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').toUpperCase();
        if (!bare) return { token, bare: null };
        const isStop = STOP_WORDS.has(bare);
        const isDupe = seen.has(bare);
        if (!isStop && !isDupe && bare) seen.add(bare);
        const s = (!isStop && !isDupe) ? scoreWord(bare) : 0;
        if (!isStop && !isDupe && bare) {
            pitchScore += s;
            wordResults.push({ word: bare, score: s });
        }
        const tier = isStop ? 'stop' : isDupe ? (scoreWord(bare) > 0 ? 'dupe' : 'none') : getWordTier(bare, s);
        return { token, bare, tier, s };
    });

    pitchScore = Math.round(pitchScore * 100) / 100;
    if (pitchScore > bestPitchScore) {
        bestPitchScore = pitchScore;
        bestPitchIndex = pitches.length + 1;  // 1-based, before push
    }
    pitches.push({ text, wordResults, pitchScore });

    // Show live pitch area with plain text first
    const livePitchWrap = document.getElementById('livePitchWrap');
    const livePitchEl = document.getElementById('livePitch');
    if (livePitchWrap && livePitchEl) {
        livePitchWrap.style.display = '';
        // Render all tokens as plain spans first
        livePitchEl.innerHTML = tokenData.map(({ token, bare, tier }) => {
            if (!bare || /^\s+$/.test(token)) return escapeHtml(token);
            return `<span class="pitch-word pitch-stop" data-tier="${tier}" data-token="${escapeHtml(token)}">${escapeHtml(token)}</span>`;
        }).join('');
    }

    // Animate score counter from 0 up to pitchScore as words are revealed
    let animatedScore = 0;
    const bankEl = $('#bank');
    const formatScore = (val) => val > 0
        ? `Best pitch: $${val}<br><br>${val >= RENT ? '🎉 Rent covered!' : `Need $${Math.round(RENT - val)} more to make rent!`}`
        : `Best pitch: $0<br><br>Need $${RENT} to make rent!`;

    // Word-by-word reveal
    const wordSpans = livePitchEl ? Array.from(livePitchEl.querySelectorAll('span[data-tier]')) : [];
    const STEP_MS = 280;

    wordSpans.reduce((promise, span, i) => {
        return promise.then(() => new Promise(resolve => {
            setTimeout(() => {
                const tier = span.dataset.tier;
                span.className = `pitch-word pitch-${tier}`;
                // Two rAF calls ensure the browser paints width:0 before transitioning
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    span.classList.add('revealed');
                }));

                // find score contribution for this token
                const tokenBare = span.dataset.token.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').toUpperCase();
                const contribution = wordResults.find(w => w.word === tokenBare);
                if (contribution && contribution.score > 0) {
                    animatedScore = Math.round((animatedScore + contribution.score) * 100) / 100;
                    bankEl.classList.add('flash-green');
                    bankEl.innerHTML = formatScore(animatedScore);
                    setTimeout(() => bankEl.classList.remove('flash-green'), 400);
                } else if (tier === 'none') {
                    bankEl.classList.add('flash-red');
                    setTimeout(() => bankEl.classList.remove('flash-red'), 400);
                }
                resolve();
            }, STEP_MS);
        }));
    }, Promise.resolve()).then(() => {
        // Animation done — commit real score, re-enable input, show history toast
        renderScore(pitchScore);
        render();

        const guessCounter = document.getElementById('guessCounter');
        if (guessCounter) {
            const bestLabel = bestPitchIndex > 0
                ? ` · Best: Pitch ${bestPitchIndex} ($${Math.round(bestPitchScore)})`
                : '';
            guessCounter.textContent = `Pitch ${pitches.length} of ${MAX_PITCHES}${bestLabel}`;
        }

        // Show toast if this isn't the first pitch (history now has prior entries)
        if (pitches.length > 1) {
            const toast = document.getElementById('historyToast');
            if (toast) {
                toast.style.display = '';
                setTimeout(() => { toast.style.display = 'none'; }, 3000);
            }
        }

        if (pitches.length >= MAX_PITCHES) {
            setTimeout(() => endRound(), 600);
        } else {
            $('#guess').disabled = false;
            $('#submitGuess').disabled = false;
            $('#guess').focus();
        }
    });
}


function endRound() {
    $('#guess').disabled = true; $('#submitGuess').disabled = true;
    // Try both local and window scope for showEndModal
    const showEnd = (typeof showEndModal === 'function') ? showEndModal : (typeof window !== 'undefined' && typeof window.showEndModal === 'function' ? window.showEndModal : null);
    const bestPitchText = bestPitchIndex > 0 ? (pitches[bestPitchIndex - 1] || {}).text || '' : '';
    if (showEnd) {
        showEnd(bestPitchScore, RENT, bestPitchText);
    } else {
        let msg = bestPitchScore >= WIN_SCORE
            ? `Greenlit! Best pitch: $${bestPitchScore}.`
            : `Rejected. Best pitch: $${bestPitchScore} of $${RENT} needed.`;
        $('#revealText').textContent = msg;
        $('#reveal').hidden = false;
    }
}

// -----------------------------------------------------------------------------
// Reveal grid
// -----------------------------------------------------------------------------
function renderRevealGrid() {
    // Set up clueWords grid
    const gridClue = $('#gridClueWords');
    if (!gridClue) return;
    let clueWords = (book.clueWords || []).slice(0, 10);
    while (clueWords.length < 10) clueWords.push(["—", "—"]);
    gridClue.innerHTML = clueWords.map((pair, i) =>
        revealedClueWords[i] && pair[0] !== '—'
            ? `<div class=\"tile clue-btn\">${pair[0]}<br>(${pair[1]})</div>`
            : `<button class=\"tile clue-btn\" data-idx=\"${i}\" data-cost=\"${CLUE_WORD_COSTS[i]}\">$${CLUE_WORD_COSTS[i]}</button>`
    ).join('');
    gridClue.querySelectorAll('button.tile').forEach(b => b.addEventListener('click', () => handleClueWordBtn(b, clueWords)));

    // Set up clue buttons
    const authorBtn = $('#revealAuthor');
    if (authorBtn) {
        authorBtn.className = 'tile clue-btn';
        authorBtn.disabled = revealedAuthor;
        authorBtn.textContent = revealedAuthor ? `Author: ${book.author}` : `Author ($${AUTHOR_COST})`;
        authorBtn.onclick = () => handleRevealAuthor(authorBtn);
    }
    [1, 2, 3].forEach(idx => {
        const btn = $(`#revealFunFact${idx}`);
        if (btn) {
            btn.className = 'tile clue-btn';
            btn.disabled = revealedFunFacts[idx - 1];
            const fact = book[`funFact${idx}`] || ["", ""];
            btn.textContent = revealedFunFacts[idx - 1] ? `Fun Fact ${idx}: ${fact[0]} ${fact[1]}` : `Fun Fact ${idx} ($${FUN_FACT_COSTS[idx - 1]})`;
            btn.onclick = () => handleRevealFunFact(btn, idx - 1);
        }
    });
}

function handleClueWordBtn(btn, clueWords) {
    const i = +btn.dataset.idx, cost = +btn.dataset.cost, pair = clueWords[i];
    if (pair[0] === '—') return;
    if (!spend(cost)) return showGameOver('Not enough funds.');
    revealedClueWords[i] = true;
    const div = document.createElement('div');
    div.className = 'tile clue-btn flash-green';
    div.innerHTML = `${pair[0]}<br>(${pair[1]})`;
    btn.replaceWith(div);
    setTimeout(() => div.classList.remove('flash-green'), 500);
    div.className = 'done';
    if (cash <= 0) showGameOver();
}

function handleRevealAuthor(btn) {
    if (!spend(AUTHOR_COST)) return showGameOver('Not enough funds.');
    revealedAuthor = true;
    btn.textContent = `Author: ${book.author}`;
    btn.className = 'tile clue-btn flash-green';
    btn.disabled = true;
    setTimeout(() => btn.classList.remove('flash-green'), 500);
    btn.className = 'done';
    if (cash <= 0) showGameOver();
}

function handleRevealFunFact(btn, idx) {
    if (!spend(FUN_FACT_COSTS[idx])) return showGameOver('Not enough funds.');
    revealedFunFacts[idx] = true;
    const fact = book[`funFact${idx + 1}`] || ["", ""];
    btn.textContent = `Fun Fact ${idx + 1}: ${fact[0]} ${fact[1]}`;
    btn.className = 'tile clue-btn flash-green';
    btn.disabled = true;
    setTimeout(() => btn.classList.remove('flash-green'), 500);
    btn.className = 'done';
    if (cash <= 0) showGameOver();
}

function handleRevealBtn(btn, list) {
    const side = btn.dataset.side, i = +btn.dataset.idx, cost = +btn.dataset.cost, word = list[i];
    console.log(word);
    console.log(list);
    if (word === '—') return; //if it's empty
    if (!spend(cost)) return showGameOver('Not enough funds.'); //if no money
    if (side === 'C') revealedCommon[i] = true; else revealedUncommon[i] = true;
    const div = document.createElement('div');
    div.className = 'tile';
    wordInfo = word.split(',');
    div.textContent = `${wordInfo[0]}\n(${wordInfo[1]})`;
    btn.replaceWith(div);
    if (cash <= 0) showGameOver();
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------


function render() {
    let attemptsHtml = '';
    if (book) {
        attemptsHtml = pitches.slice().reverse().map((p, revIdx) => {
            const pitchNum = pitches.length - revIdx;
            const markup = renderPitchMarkup(p.text);
            const earned = p.pitchScore > 0
                ? `<span class="pitch-score-badge">+$${p.pitchScore}</span>`
                : `<span class="pitch-score-badge pitch-score-zero">$0 — too original!</span>`;
            return `<div class="attempt pitch-attempt">
                <div class="pitch-header">PITCH #${pitchNum} ${earned}</div>
                <div class="pitch-display">${markup}</div>
            </div>`;
        }).join('');
    }
    $('#attempts').innerHTML = attemptsHtml;

    // Book title
    const clueTitleEl = document.getElementById('currentBookTitle');
    if (clueTitleEl && book && book.title) {
        clueTitleEl.innerHTML = `<span class="clue book-title-responsive">SEQUEL TO: <b>${escapeHtml(book.title)}</b></span>`;
    } else if (clueTitleEl) {
        clueTitleEl.textContent = '';
    }

    // Add responsive style for book title (inject once)
    if (!document.getElementById('book-title-style')) {
        const bookTitleStyle = document.createElement('style');
        bookTitleStyle.id = 'book-title-style';
        bookTitleStyle.textContent = `
        .book-title-responsive {
            display: inline-block;
            max-width: 90vw;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 2.5vw;
            font-weight: bold;
            vertical-align: middle;
        }
        @media (max-width: 600px) {
            .book-title-responsive { font-size: 4vw; }
        }
        `;
        document.head.appendChild(bookTitleStyle);
    }

    // Pitch input and button state
    $('#guess').disabled = !book || pitches.length >= MAX_PITCHES;
    $('#submitGuess').disabled = !book || pitches.length >= MAX_PITCHES;
    $('#guess').value = '';
    if (book && pitches.length < MAX_PITCHES) $('#guess').focus();

    // Pitch counter
    const guessCounter = document.getElementById('guessCounter');
    if (guessCounter) {
        guessCounter.textContent = `Pitches left: ${MAX_PITCHES - pitches.length}`;
    }
}

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

//All the events our buttons call
$('#submitGuess').addEventListener('click', () => { const v = $('#guess').value.trim(); if (v) submitPitch(v); });
$('#guess').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const v = $('#guess').value.trim();
        if (v) submitPitch(v);
    }
});
const newGameBtn = document.getElementById('newGame');
if (newGameBtn) newGameBtn.addEventListener('click', () => { newRound(); $('#reveal').hidden = true; });

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------
window.BookByWord = {
    setData(list) {
        // Accepts an array of book objects, each with at least title, author, WORD_COUNTS, WORD_COUNTS_RAW
        DATA = list.map(book => ({
            title: book.title,
            author: book.author,
            WORD_COUNTS: book.WORD_COUNTS || {},
            WORD_COUNTS_RAW: book.WORD_COUNTS_RAW || {},
            // Add more fields if needed
        }));
        // Auto-start a new round on page load
        newRound();
    }
};
