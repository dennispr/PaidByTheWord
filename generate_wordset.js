// generate_wordset.js

// Run with: node generate_wordset.js
// Required modules
const fs = require('fs');
const path = require('path');

// -----------------------------------------------------------------------
// Character name extractor from IMSDB HTML
// -----------------------------------------------------------------------
// In IMSDB <pre> scripts, character cue lines are in <b> tags with heavy
// leading whitespace (≥25 spaces before the text). Scene headings are also
// bold but left-aligned (≤5 spaces). We use the indent threshold to split them.
const IMSDB_HTML_DIR = path.join(__dirname, 'imsdb_raw_html');

const CHAR_CUE_SUFFIXES = /\s*\((CONT'D|V\.O\.|O\.S\.|O\.C\.|V\/O|CONT)\)$/i;
const SCENE_HEADING = /^\s*(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i;
const PAGE_NUMBER = /^\s*\d+\s*$/;

function extractCharactersFromHtml(htmlFilePath) {
	if (!fs.existsSync(htmlFilePath)) return { charCounts: {}, totalMentions: 0 };
	const html = fs.readFileSync(htmlFilePath, 'utf8');

	// Pull the <pre> block that holds the screenplay
	const preMatch = html.match(/<pre>([\s\S]*?)<\/pre>/i);
	if (!preMatch) return { charCounts: {}, totalMentions: 0 };
	const preText = preMatch[1];

	// Split on <b>...</b> tags and examine each bold run
	const boldRe = /<b>([\s\S]*?)<\/b>/gi;
	const charCounts = {};
	let totalMentions = 0;
	let match;

	while ((match = boldRe.exec(preText)) !== null) {
		// Strip any inner tags (e.g. nested <b>), get plain text
		const raw = match[1].replace(/<[^>]+>/g, '');
		// Count leading spaces to determine indentation
		const leadingSpaces = raw.match(/^( *)/)[1].length;
		const trimmed = raw.trim();

		if (!trimmed) continue;
		if (SCENE_HEADING.test(raw)) continue;
		if (PAGE_NUMBER.test(trimmed)) continue;
		// Character cues are centered — typically 25+ spaces
		if (leadingSpaces < 20) continue;
		// Must be ALL CAPS (after stripping suffix)
		const name = trimmed.replace(CHAR_CUE_SUFFIXES, '').trim();
		if (!name || name !== name.toUpperCase()) continue;
		// Skip very long lines (likely song lyrics or title cards, not cues)
		if (name.length > 40) continue;
		// Must be only alpha + spaces + punctuation typical of a name
		if (!/^[A-Z][A-Z0-9 \-'.]+$/.test(name)) continue;

		charCounts[name] = (charCounts[name] || 0) + 1;
		totalMentions++;
	}

	// Filter noise: characters mentioned only once are likely false positives
	for (const k of Object.keys(charCounts)) {
		if (charCounts[k] < 2) delete charCounts[k];
	}
	// Recount totalMentions after filtering
	totalMentions = Object.values(charCounts).reduce((s, v) => s + v, 0);

	return { charCounts, totalMentions };
}

// Per-file character data (keyed by txt file path → matching html basename)
const charDataMap = {}; // { txtFilePath: { charCounts, totalMentions } }
// Per-file bigram adjacency data
const userBigramMap = {}; // { txtFilePath: { WORD1: { WORD2: count } } }
// Dynamically get all files from the /books directory
const BOOKS_DIR = path.join(__dirname, 'books');
// List of .txt files to process (dynamically discovered)
const TXT_FILES = fs.existsSync(BOOKS_DIR)
	? fs.readdirSync(BOOKS_DIR)
			.filter(f => f.toLowerCase().endsWith('.txt'))
			.map(f => path.join('books', f))
	: [];
// List of .epub files to process (dynamically discovered)
const EPUB_FILES = fs.existsSync(BOOKS_DIR)
	? fs.readdirSync(BOOKS_DIR)
			.filter(f => f.toLowerCase().endsWith('.epub'))
			.map(f => path.join('books', f))
	: [];


// Optional CLI flags: --top=5 --rareMin=2
const argv = Object.fromEntries(
	process.argv.slice(2).map(a => {
		const [k, v] = a.replace(/^--/, '').split('=');
		return [k, v ?? true];
	})
);

const N_TOP = Number(argv.top ?? 20);
const RARE_MIN = Number(argv.rareMin ?? 2);

// User file word count objects (per file)
const userWordCountsMap = {}; // { filename: { word: count, ... } }

// filename -> extracted metadata
const userMetaMap = {}; // { file: { title, author, publisher, date, identifiers, aliases } }

// --- Filtering + ranking helpers ---------------------------------------------
// Core function words filtered from WORD_COUNTS so they don't pollute scoring.
// Directional prepositions added after Alien analysis (INTO:140, DOWN:115, etc.)
// were inflating scores due to heavy use in screenplay action lines.
// Future candidates if more noise surfaces:
//   Adverbs:      JUST, NOW, HERE, BACK, STILL, ALREADY, EVEN, ALSO, REALLY
//   Prepositions: THROUGH, ACROSS, BEHIND, BENEATH, TOWARD, UPON, ALONG
//   Filler verbs: LIKE, WANT, MAKE, LOOK, COME, KNOW, THINK, FEEL, TAKE, HOLD
const DEFAULT_STOP = new Set([
	'THE', 'AND', 'OF', 'TO', 'IN', 'A', 'THAT', 'IT', 'IS', 'WAS', 'HE', 'FOR', 'AS', 'WITH',
	'HIS', 'ON', 'BE', 'AT', 'BY', 'I', 'YOU', 'THIS', 'BUT', 'FROM', 'OR', 'HAD', 'NOT', 'ARE',
	'HER', 'SHE', 'THEY', 'THEM', 'THEIR', 'AN', 'WHICH', 'WE', 'MY', 'ME', 'YOUR', 'OUR',
	'SO', 'IF', 'NO', 'THERE', 'WHEN', 'WHAT', 'WHO', 'WHOM', 'WHERE', 'WHY', 'HOW', 'THE', 'PROJECT',
	'GUTENBERG', 'EBOOK', 'SPAN', 'TITLE',
	// Directional prepositions common in screenplay action lines:
	'INTO', 'DOWN', 'OVER', 'AROUND', 'OFF'
]);

const DEFAULT_NOISE = new Set([
	'DIV', 'STYLE', 'TEXT', 'ALIGN', 'CENTER', 'IMG', 'SRC', 'IMAGES', 'OEBPS', 'COVER',
	'PNG', 'ALT', 'CLASS', 'EBOOKMAKER', 'HEIGHT', 'EPILOGUE'
]);

const TOKEN_OK = (w) => /^[A-Z][A-Z'’-]*$/.test(w) && w.length > 2;

function entriesFromCounts(counts) {
	return Object.entries(counts).filter(([w, c]) =>
		Number.isFinite(c) && c > 0 && TOKEN_OK(w) && !DEFAULT_NOISE.has(w) && !DEFAULT_STOP.has(w)
	);
}
function topCommon(entries, n) {
	return entries.slice().sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).slice(0, n).map(([w]) => w);
}
function topUncommon(entries, n, minCount = 2) {
	return entries
		.filter(([, c]) => c >= minCount)
		.sort((a, b) => (a[1] - b[1]) || a[0].localeCompare(b[0]))
		.slice(0, n)
		.map(([w]) => w);
}

function ensureDir(dir) {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}


// --- Game module writer -------------------------------------------------------
function writeGameModule({
	outPath, title, author, aliases, counts, nTop = 10, rareMin = 2,
}) {
	const entries = entriesFromCounts(counts);
	const COMMON_TopN = topCommon(entries, nTop);
	const UNCOMMON_TopN = topUncommon(entries, nTop, rareMin);

		// clueWords: top 10 common words and counts
		const clueWords = COMMON_TopN.map(([w, c]) => [w, c]);
		const module = `// Auto-generated game module for ${title}
export const META = ${JSON.stringify({ title, author, aliases }, null, 2)};
export const WORD_COUNTS = ${JSON.stringify(counts, null, 2)};
export const COMMON_TOP${nTop} = ${JSON.stringify(COMMON_TopN, null, 2)};
export const UNCOMMON_TOP${nTop} = ${JSON.stringify(UNCOMMON_TopN, null, 2)};
export const FUN_FACT_1 = ["", ""];
export const FUN_FACT_2 = ["", ""];
export const FUN_FACT_3 = ["", ""];
export const CLUE_WORDS = ${JSON.stringify(clueWords, null, 2)};

// Game-ready object
export const BOOK_FOR_GAME = {
	...META,
	commonTop: COMMON_TOP${nTop},
	uncommonTop: UNCOMMON_TOP${nTop},
	funFact1: FUN_FACT_1,
	funFact2: FUN_FACT_2,
	funFact3: FUN_FACT_3,
	clueWords: CLUE_WORDS
};

export default BOOK_FOR_GAME;
`;
	ensureDir(path.dirname(outPath));
	fs.writeFileSync(outPath, module, 'utf-8');
	return { COMMON_TopN, UNCOMMON_TopN };
}

// --- Combined pack (array of all books) --------------------------------------
function writePack(packPath, books) {
	ensureDir(path.dirname(packPath));
	const booksContent = books.map(book => `  ${JSON.stringify(book)}`).join(',\n');
	const packContent = `// Auto-generated pack of books for the game
export const BOOKS = [
${booksContent}
];
export default BOOKS;
`;
	fs.writeFileSync(packPath, packContent, 'utf-8');
}

function processTxtFile(filePath) {
	const wordCounts = {};
	const text = fs.readFileSync(filePath, 'utf8');
	// Match words including mid-word apostrophes (contractions/possessives), min 2 chars
	const words = text.match(/[a-zA-Z][a-zA-Z'\u2019]*[a-zA-Z]/g) || [];
	for (const word of words) {
		// Normalize curly apostrophes, strip leading/trailing punctuation, uppercase
		const w = word.replace(/[\u2018\u2019]/g, "'").toUpperCase();
		if (w.length < 2) continue;
		wordCounts[w] = (wordCounts[w] || 0) + 1;
	}

	// Extract character names from matching HTML file first, then subtract their
	// stage-direction appearances from the word counts so that character cue lines
	// (e.g. "ANNA" as a scene header) don't inflate dialogue word frequencies.
	const base = path.basename(filePath, path.extname(filePath));
	const htmlPath = path.join(IMSDB_HTML_DIR, base + '.html');
	const charData = extractCharactersFromHtml(htmlPath);
	charDataMap[filePath] = charData;

	for (const [charName, cueCnt] of Object.entries(charData.charCounts)) {
		for (const namePart of charName.split(/\s+/)) {
			if (wordCounts[namePart]) {
				wordCounts[namePart] = Math.max(0, wordCounts[namePart] - cueCnt);
				if (wordCounts[namePart] === 0) delete wordCounts[namePart];
			}
		}
	}

	userWordCountsMap[filePath] = wordCounts;

	// Build directed bigram map: pairs of consecutive non-stop scoring words.
	// Stop words between pairs are skipped but don’t break the chain.
	// Filter to pairs appearing ≥3 times to remove noise.
	const bigramCounts = {};
	let prevBigramWord = null;
	for (const word of words) {
		const w = word.replace(/[\u2018\u2019]/g, "'").toUpperCase();
		if (w.length < 2) continue;
		if (DEFAULT_STOP.has(w) || DEFAULT_NOISE.has(w)) continue;
		if (prevBigramWord) {
			if (!bigramCounts[prevBigramWord]) bigramCounts[prevBigramWord] = {};
			bigramCounts[prevBigramWord][w] = (bigramCounts[prevBigramWord][w] || 0) + 1;
		}
		prevBigramWord = w;
	}
	const filteredBigrams = {};
	for (const [w1, nexts] of Object.entries(bigramCounts)) {
		for (const [w2, cnt] of Object.entries(nexts)) {
			if (cnt >= 3) {
				if (!filteredBigrams[w1]) filteredBigrams[w1] = {};
				filteredBigrams[w1][w2] = cnt;
			}
		}
	}
	userBigramMap[filePath] = filteredBigrams;
}

// EPUB file processing (async, fixed + complete)
function processEpubFile(filePath, done) {
	const EPub = require('epub');           // npm i epub
	const epub = new EPub(filePath);
	const base = path.basename(filePath, path.extname(filePath)); // <-- define base here
	const wordCounts = {};

	// tiny counter helper
	function countText(text) {
		// Match words including mid-word apostrophes (contractions/possessives), min 2 chars
		const words = (text && text.match(/[a-zA-Z][a-zA-Z'\u2019]*[a-zA-Z]/g)) || [];
		for (const word of words) {
			const w = word.replace(/[\u2018\u2019]/g, "'").toUpperCase();
			if (w.length < 2) continue;
			wordCounts[w] = (wordCounts[w] || 0) + 1;
		}
	}

	epub.on('end', () => {
		// ---- metadata ----
		const md = epub.metadata || {};
		const author =
			md.creator ||
			md.creatorFileAs ||
			(Array.isArray(md.creators) && md.creators[0]?.name) ||
			'Unknown';
		const title = md.title || base;
		const publisher = md.publisher || null;
		const date = md.date || md.pubdate || null;
		const identifiers = md.identifier
			? [md.identifier]
			: (Array.isArray(md.identifiers) ? md.identifiers : []);

		if (!md.title) console.warn(`[meta-missing] ${filePath}: EPUB title not found; using "${base}"`);
		if (!md.creator && !md.creatorFileAs && !(Array.isArray(md.creators) && md.creators[0]?.name)) {
			console.warn(`[meta-missing] ${filePath}: EPUB author not found`);
		}

		// store per-file metadata (keyed by the same filePath you use in the counts map)
		userMetaMap[filePath] = { title, author, publisher, date, identifiers, aliases: [] };

		// ---- text extraction & counting ----
		// epub.flow is the list of spine items (chapters)
		const ids = Array.isArray(epub.flow) ? epub.flow.map(n => n.id).filter(Boolean) : [];
		let i = 0;

		const next = () => {
			if (i >= ids.length) {
				// done: publish counts and notify caller
				userWordCountsMap[filePath] = wordCounts;
				if (typeof done === 'function') done();
				return;
			}
			const id = ids[i++];
			epub.getChapter(id, (err, html) => {
				if (err) {
					console.warn(`[epub-warn] ${filePath}: failed to read chapter ${id}:`, err.message || err);
				} else {
					// strip tags quickly; you can swap for a proper HTML->text if you like
					const textOnly = String(html).replace(/<[^>]+>/g, ' ');
					countText(textOnly);
				}
				next();
			});
		};

		next();
	});

	epub.on('error', (err) => {
		console.error(`[epub-error] ${filePath}:`, err);
		if (typeof done === 'function') done(err);
	});

	epub.parse(); // kick off parsing
}

// Main processing
function processAllFiles(callback) {
	// Process TXT files
	for (const txt of TXT_FILES) {
		if (fs.existsSync(txt)) {
			processTxtFile(txt);
			console.log('Processed TXT:', txt);
		} else {
			console.warn('TXT file not found:', txt);
		}
	}

	// Process EPUB files (async)
	let epubCount = EPUB_FILES.length;
	if (epubCount === 0) return callback();
	for (const epub of EPUB_FILES) {
		if (fs.existsSync(epub)) {
			processEpubFile(epub, () => {
				console.log('Processed EPUB:', epub);
				if (--epubCount === 0) callback();
			});
		} else {
			console.warn('EPUB file not found:', epub);
			if (--epubCount === 0) callback();
		}
	}
}


function writeOutputs() {
	const PACK_PATH = path.join('words', 'books.pack.js');
	const allBooks = []; // Collect all books for the pack

	for (const file in userWordCountsMap) {
		const counts = userWordCountsMap[file];
		const base = path.basename(file, path.extname(file));

		   // --- Existing 3 outputs (kept) -------------------------------------------
		   // Sort words by frequency (descending), then alphabetically for ties
		   const words = Object.keys(counts)
			   .sort((a, b) => {
				   const freqDiff = counts[b] - counts[a];
				   return freqDiff !== 0 ? freqDiff : a.localeCompare(b);
			   });

		   const wordListFile = path.join('words', `${base}-wordlist.js`);
		   const wordCountFile = path.join('words', `${base}-wordcount.js`);
		   const wordArrayFile = path.join('words', `${base}-wordarray.js`);

		const meta = userMetaMap[file] || {
		    title: base,
		    author: 'Unknown',
		    publisher: null,
		    date: null,
		    identifiers: [],
		    aliases: []
		};

		const { charCounts, totalMentions } = charDataMap[file] || { charCounts: {}, totalMentions: 0 };

		// Order character counts by mention frequency descending
		const orderedCharCounts = Object.fromEntries(
			Object.entries(charCounts).sort((a, b) => b[1] - a[1])
		);

		const setExport = `// Auto-generated word list for ${file}
	export const WORD_SET = new Set([${words.map(w => `  "${w}"`).join(',\n')}]);
	`;
		const filtered = countsFiltered(counts);

		// Create ordered objects by frequency (highest to lowest)
		const orderedCounts = {};
		const orderedFiltered = {};
		
		// Sort all words by frequency, then alphabetically
		const sortedWords = Object.keys(counts)
			.sort((a, b) => {
				const freqDiff = counts[b] - counts[a];
				return freqDiff !== 0 ? freqDiff : a.localeCompare(b);
			});
		
		// Build ordered objects
		for (const word of sortedWords) {
			orderedCounts[word] = counts[word];
			if (filtered[word]) {
				orderedFiltered[word] = filtered[word];
			}
		}

		const metaExport = `export const META = ${JSON.stringify({ title: meta.title, author: meta.author }, null, 2)};`;

		const fileBigrams = userBigramMap[file] || {};
		const countExport = `// Auto-generated word count metadata for ${file}
	${metaExport}
	export const WORD_COUNTS = ${JSON.stringify(orderedFiltered, null, 2)}; // filtered (no stopwords/noise)
	export const WORD_COUNTS_RAW = ${JSON.stringify(orderedCounts, null, 2)}; // original, unfiltered
	export const CHARACTER_COUNTS = ${JSON.stringify(orderedCharCounts, null, 2)}; // character cue mentions
	export const TOTAL_CHAR_MENTIONS = ${totalMentions};
	export const BIGRAMS = ${JSON.stringify(fileBigrams, null, 2)}; // directed word-pair adjacency (count ≥3)`;

		const arrayExport = `// Auto-generated word array for ${file}
	${metaExport}
	export const WORD_ARRAY = [
	${words.map(w => `  "${w}"`).join(',\n')}];`;

		   fs.writeFileSync(wordListFile, setExport, 'utf-8');
		   fs.writeFileSync(wordCountFile, countExport, 'utf-8');
		   fs.writeFileSync(wordArrayFile, arrayExport, 'utf-8');
		   console.log(`Wrote ${wordListFile}, ${wordCountFile}, and ${wordArrayFile}`);

	const gameOut = path.join('words', `${base}.game.js`);
		const { COMMON_TopN, UNCOMMON_TopN } = writeGameModule({
			outPath: gameOut,
			title: meta.title,
			author: meta.author,
			aliases: meta.aliases,
			counts,
			nTop: N_TOP,
			rareMin: RARE_MIN,
		});
		console.log(`Wrote ${gameOut}`);

		// clueWords: top 10 common words and counts
		const clueWords = COMMON_TopN.map(([w, c]) => [w, c]);
		allBooks.push({
			title: meta.title,
			author: meta.author,
			aliases: meta.aliases,
			commonTop: COMMON_TopN,
			uncommonTop: UNCOMMON_TopN,
			funFact1: ["", ""],
			funFact2: ["", ""],
			funFact3: ["", ""],
			clueWords,
			// Optional: keep extra metadata in the pack if you want to show it later
			publisher: meta.publisher,
			date: meta.date,
			identifiers: meta.identifiers
		});
		console.log(`Added ${meta.title} to pack`);
	}

	// Write the complete pack file
	writePack(PACK_PATH, allBooks);
	console.log(`Wrote ${PACK_PATH} with ${allBooks.length} books`);

	// --- Generate bookwords.pack.js: index of all *-wordcount.js files with metadata ---
	const wordsDir = path.join(__dirname, 'words');
	const wordcountFiles = fs.readdirSync(wordsDir)
		.filter(f => f.endsWith('-wordcount.js'));
	const bookwordsPackPath = path.join(wordsDir, 'bookwords.pack.js');

	// Helper to extract META from a wordcount file (sync, simple regex parse)
	function extractMetaFromFile(filePath) {
		const content = fs.readFileSync(filePath, 'utf-8');
		// Look for: export const META = { ... };
		const metaMatch = content.match(/export const META = (\{[\s\S]*?\});/);
		if (metaMatch) {
			try {
				return JSON.parse(metaMatch[1]);
			} catch (e) {
				console.warn('Failed to parse META in', filePath, e);
			}
		}
		return { title: filePath, author: 'Unknown' };
	}

	const bookMetaArray = wordcountFiles.map(f => {
		const meta = extractMetaFromFile(path.join(wordsDir, f));
		return {
			title: meta.title || f,
			author: meta.author || 'Unknown',
			modulePath: `./words/${f}`
		};
	});

	const bookwordsPackContent = `// Auto-generated index of all wordcount files with metadata\n\nexport const BOOK_WORDCOUNT_INDEX = [\n${bookMetaArray.map(b => `  ${JSON.stringify(b)}`).join(',\n')}\n];\nexport default BOOK_WORDCOUNT_INDEX;\n`;
	fs.writeFileSync(bookwordsPackPath, bookwordsPackContent, 'utf-8');
	console.log(`Wrote ${bookwordsPackPath}`);
	console.log('All outputs complete ✔');
}

function countsFiltered(counts) {
	// re-use your DEFAULT_STOP / DEFAULT_NOISE / TOKEN_OK
	return Object.fromEntries(
		Object.entries(counts).filter(([w, c]) =>
			Number.isFinite(c) && c > 0 &&
			TOKEN_OK(w) &&
			!DEFAULT_STOP.has(w) &&
			!DEFAULT_NOISE.has(w)
		)
	);
}

function entriesFromCounts(counts) {
	return Object.entries(counts).filter(([w, c]) =>
		Number.isFinite(c) && c > 0 && TOKEN_OK(w) && !DEFAULT_NOISE.has(w) && !DEFAULT_STOP.has(w)
	);
}

function topCommon(entries, n) {
	// highest frequency, deterministic tie-break
	return entries
		.slice()
		.sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
		.slice(0, n);
		//.map(([w]) => w);
}

function topUncommon(entries, n, minCount = 2) {
	// lowest frequency above a minimum, deterministic tie-break
	return entries
		.filter(([, c]) => c >= minCount)
		.sort((a, b) => (a[1] - b[1]) || a[0].localeCompare(b[0]))
		.slice(0, n);
		//.map(([w]) => w);
}

// ---- writer for the game-ready module ---------------------------------------
function writeGameModule({
	outPath,                // e.g., 'dist/mobyDick.game.js'
	title, author, aliases, // metadata strings/array
	counts,                 // { WORD: count }
	nTop = 10,
	rareMin = 2,
}) {
	ensureDir(path.dirname(outPath));
	const entries = entriesFromCounts(counts);
	const COMMON_TopN = topCommon(entries, nTop);
	const UNCOMMON_TopN = topUncommon(entries, nTop, rareMin);

	const module = `// Auto-generated game module for ${title}
export const META = ${JSON.stringify({ title, author, aliases }, null, 2)};
export const WORD_COUNTS = ${JSON.stringify(counts, null, 2)};
export const COMMON_TOP${nTop} = ${JSON.stringify(COMMON_TopN, null, 2)};
export const UNCOMMON_TOP${nTop} = ${JSON.stringify(UNCOMMON_TopN, null, 2)};

// Game-ready object
export const BOOK_FOR_GAME = {
  ...META,
  commonTop: COMMON_TOP${nTop},
  uncommonTop: UNCOMMON_TOP${nTop}
};

export default BOOK_FOR_GAME;
`;

	fs.writeFileSync(outPath, module, 'utf-8');
	return { COMMON_TopN, UNCOMMON_TopN };
}

// Entry point
if (TXT_FILES.length === 0 && EPUB_FILES.length === 0) {
	console.error('No TXT or EPUB files specified for processing.');
} else {
	processAllFiles(writeOutputs);
}
