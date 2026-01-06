// TopWordsEngine.js — Videogame Workshop LLC

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------


const START_SCORE = 0;
const MAX_GUESSES = 10;
const RENT = 75;
const WIN_SCORE = RENT;



let DATA = [];
let book = null;
let wordCounts = {};
let guessedWords = new Set();
let guesses = [];
let score = START_SCORE;
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

function renderScore(inc = 0) {
    const bankEl = $('#bank');
    const prevScore = bankEl.dataset.score ? +bankEl.dataset.score : score - inc;
    // Animate increment if score increased
    const formatScore = (val) => `You've made $${(val-RENT).toFixed(2)}<br><br>[$${val.toFixed(2)} - $${RENT} (Rent)]`;
    if (inc > 0) {
        let current = prevScore;
        bankEl.classList.add('flash-green');
        const step = () => {
            if (current < score) {
                current++;
                bankEl.innerHTML = formatScore(current);
                setTimeout(step, 10);
            } else {
                bankEl.innerHTML = formatScore(score);
                setTimeout(() => bankEl.classList.remove('flash-green'), 500);
            }
        };
        step();
        // trigger emoji confetti when money increases
        maybeLoadConfetti().then(m => {
            if (!m || typeof m.burst !== 'function') return;
            // try to anchor to the book title element if present
            const target = document.querySelector('.clue.book-title-responsive');
            let x = Math.round(window.innerWidth / 2);
            let y = 160;
            if (target) {
                const r = target.getBoundingClientRect();
                x = Math.round(r.left + r.width / 2 + window.scrollX);
                // position slightly above the element
                y = Math.max(60, Math.round(r.top + window.scrollY - (r.height * 0.25)));
            }
            m.burst({ x, y, count: Math.min(40, 10 + Math.round(inc/5)), emoji: '💵', duration: 1200 });
        });
    } else {
        bankEl.innerHTML = formatScore(score);
    }
    bankEl.dataset.score = score;
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
    guessedWords = new Set();
    guesses = [];
    score = START_SCORE;
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
        guessCounter.textContent = `Guesses left: ${MAX_GUESSES}`;
    }
    // Reset score display
    const bankEl = document.getElementById('bank');
    if (bankEl) {
        bankEl.textContent = `$${START_SCORE}-${RENT} = $${(START_SCORE-RENT).toFixed(2)}`;
        bankEl.dataset.score = START_SCORE;
    }
    renderScore();
    render();
}

// -----------------------------------------------------------------------------
// Guessing
// -----------------------------------------------------------------------------
function currentWord() {
    return words[idx] || '';
}


function compareGuess(input) {
    if (!book) return false;
    const g = input.trim().toUpperCase();
    // Only allow a word to be guessed once
    if (guessedWords.has(g)) return false;
    // Compare in uppercase for all keys
    return Object.hasOwn(wordCounts, g) && wordCounts[g] > 0;
}


function checkWord(guess) {
    if (!book) return;
    if (guesses.length >= MAX_GUESSES) return;
    const g = guess.trim().toUpperCase();
    console.log('Guess:', g, 'wordCounts[g]:', wordCounts[g], 'guessedWords:', guessedWords);
    let inc = 0;
    let correct = false;
    if (!guessedWords.has(g) && wordCounts[g]) {
        correct = true;
        guessedWords.add(g);
        inc = Math.round((wordCounts[g] / top3sum) * 100 * 100) / 100;
        score += inc;
    }
    guesses.push({ text: guess, correct, inc });
    renderScore(inc);
    render();

    // Update guess counter UI
    const guessCounter = document.getElementById('guessCounter');
    if (guessCounter) {
        guessCounter.textContent = `Guesses left: ${MAX_GUESSES - guesses.length}`;
    }
    // Always trigger endRound after the last guess, regardless of score
    if (guesses.length === MAX_GUESSES) {
        setTimeout(() => endRound(), 500);
    }
}


function endRound() {
    $('#guess').disabled = true; $('#submitGuess').disabled = true;
    // Try both local and window scope for showEndModal
    const showEnd = (typeof showEndModal === 'function') ? showEndModal : (typeof window !== 'undefined' && typeof window.showEndModal === 'function' ? window.showEndModal : null);
    if (showEnd) {
        showEnd(score, RENT);
    } else {
        // fallback legacy
        let msg = score >= WIN_SCORE
            ? `Good job! You scored $${score}-${RENT} = $${(score-RENT).toFixed(2)}.`
            : `Try again! You scored $${score}-${RENT} = $${(score-RENT).toFixed(2)}.`;
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
    // Only show guesses in #attempts, move book title/clue to #currentBookTitle (above controls)
    let attemptsHtml = '';
    if (book) {
        // Show most recent guess at the top
        attemptsHtml = guesses.slice().reverse().map(g => {
            let word = g.text.trim().toUpperCase();
            let count = wordCounts[word] || 0;
            let usedText = g.correct ? ` <span class=\"used-count\">(used ${count} times)</span>` : '';
            let scoreClass = '';
            if (g.correct) {
                if (g.inc >= 20) scoreClass = 'guess-green';
                else if (g.inc >= 10) scoreClass = 'guess-orange';
                else scoreClass = 'guess-red';
            }
            return `<div class=\"attempt\"><div class=\"guess pill ${scoreClass}\"><span class=\"status ${g.correct ? 'ok' : 'bad'}\">${g.correct ? '+$' + g.inc : '0'}</span> ${escapeHtml(g.text)}${usedText}</div></div>`;
        }).join('');
// Add color classes for guess pills (inject once)
if (!document.getElementById('guess-pill-style')) {
    const style = document.createElement('style');
    style.id = 'guess-pill-style';
    style.textContent = `
    .guess.pill { display: inline-flex; align-items: center; gap: 8px; min-width: 96px; padding: 6px 10px; border-radius: 8px; white-space: nowrap; }
    .guess-green { background: #2ecc40 !important; color: #fff !important; }
    .guess-orange { background: #ff9800 !important; color: #fff !important; }
    .guess-red { background: #e53935 !important; color: #fff !important; }
    .used-count { font-size: 0.9em; color: rgba(255,255,255,0.7); margin-left: 0.5em; }
    `;
    document.head.appendChild(style);
}
    }
    $('#attempts').innerHTML = attemptsHtml;
    // Book title in main UI (if present)
    const clueTitleEl = document.getElementById('currentBookTitle');
    if (clueTitleEl && book && book.title) {
        clueTitleEl.innerHTML = `<span class=\"clue book-title-responsive\">Movie: <b>${escapeHtml(book.title)}</b></span>`;
    } else if (clueTitleEl) {
        clueTitleEl.textContent = '';
    }

// Add responsive style for book title
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

    // Guess input and button state
    $('#guess').disabled = !book || guesses.length >= MAX_GUESSES;
    $('#submitGuess').disabled = !book || guesses.length >= MAX_GUESSES;
    $('#guess').value = '';
    if (book && guesses.length < MAX_GUESSES) $('#guess').focus();

    // Guess counter
    const guessCounter = document.getElementById('guessCounter');
    if (guessCounter) {
        guessCounter.textContent = `Words left: ${MAX_GUESSES - guesses.length}`;
    }

}

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

//All the events our buttons call
$('#submitGuess').addEventListener('click', () => { const v = $('#guess').value.trim(); if (v) checkWord(v); });
$('#guess').addEventListener('keydown', e => { if (e.key === 'Enter') { const v = $('#guess').value.trim(); if (v) checkWord(v); } });
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
