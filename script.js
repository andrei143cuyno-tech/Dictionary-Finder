const API_BASE_URL = "https://freedictionaryapi.com/api/v1/entries/en/";

const searchForm = document.querySelector("#search-form");
const wordInput = document.querySelector("#word-input");
const messageArea = document.querySelector("#message-area");
const historyList = document.querySelector("#history-list");
const clearHistoryButton = document.querySelector("#clear-history");
const quickSearchButtons = document.querySelectorAll(".word-chip");
let recentSearches = [];
let activeRequest = null;

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function showMessage(title, message, type = "info") {
  const card = element("div", type === "error" ? "status-card error" : "status-card");
  card.append(element("h2", "", title), element("p", "", message));
  messageArea.replaceChildren(card);
}

function showLoading(word) {
  const card = element("div", "status-card loading");
  const loader = element("div", "loader");
  loader.setAttribute("aria-hidden", "true");
  card.append(loader, element("h2", "", `Looking up “${word}”`), element("p", "", "Getting the dictionary entry. Just a moment…"));
  messageArea.replaceChildren(card);
}
  
function getPronunciation(entries) {
  for (const entry of entries) {
    const pronunciation = (entry.pronunciations || []).find(item => item && item.text);
    if (pronunciation) return pronunciation.text;
  }
  return "Pronunciation not provided";
}

function addWordChips(parent, label, words) {
  const unique = [...new Set((words || []).filter(word => typeof word === "string" && word.trim()))].slice(0, 8);
  if (!unique.length) return;
  const row = element("div", "synonym-row");
  row.appendChild(element("span", "synonym-label", label));
  unique.forEach(word => {
    const chip = element("button", "synonym-chip", word);
    chip.type = "button";
    chip.addEventListener("click", () => searchWord(word));
    row.appendChild(chip);
  });
  parent.appendChild(row);
}

function renderEntry(data) {
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const word = data.word || wordInput.value;
  const card = element("article", "result-card");
  const header = element("div", "result-header");
  header.appendChild(element("p", "result-kicker", "Dictionary entry"));
  const wordRow = element("div", "result-word-row");
  const wordDetails = element("div");
  wordDetails.append(element("h2", "result-word", word), element("p", "pronunciation", getPronunciation(entries)));
  wordRow.appendChild(wordDetails);
  // This API provides IPA text, but does not promise audio files.
  // Only show an audio button if an actual audio URL is supplied.
  const audioUrl = entries.flatMap(entry => entry.pronunciations || []).find(p => p && typeof p.audio === "string" && /^https:\/\//.test(p.audio))?.audio;
  if (audioUrl) {
    const audioButton = element("button", "audio-button", "▶");
    audioButton.type = "button";
    audioButton.setAttribute("aria-label", "Play pronunciation");
    audioButton.addEventListener("click", () => new Audio(audioUrl).play().catch(() => showMessage("Audio unavailable", "Could not play the pronunciation audio.", "error")));
    wordRow.appendChild(audioButton);
  }
  header.appendChild(wordRow);
  const body = element("div", "result-body");
  for (const entry of entries) {
    const block = element("section", "meaning-block");
    block.appendChild(element("h3", "part-of-speech", entry.partOfSpeech || "Meaning"));
    const list = element("ol", "definition-list");
    function addSense(sense, depth = 0) {
      if (!sense || typeof sense !== "object") return;
      if (sense.definition) {
        const item = element("li");
        item.appendChild(element("p", "definition-text", sense.definition));
        if (Array.isArray(sense.examples) && sense.examples.length) {
          const example = element("p", "example-text");
          example.append(element("span", "example-label", "Example: "), document.createTextNode(`“${sense.examples[0]}”`));
          item.appendChild(example);
        }
        list.appendChild(item);
      }
      if (depth < 2 && Array.isArray(sense.subsenses)) sense.subsenses.forEach(sub => addSense(sub, depth + 1));
    }
    (entry.senses || []).slice(0, 8).forEach(sense => addSense(sense));
    if (!list.children.length) list.appendChild(element("li", "", "No definition available for this part of speech."));
    block.appendChild(list);
    const senseSynonyms = (entry.senses || []).flatMap(sense => sense.synonyms || []);
    const senseAntonyms = (entry.senses || []).flatMap(sense => sense.antonyms || []);
    addWordChips(block, "Synonyms:", [...(entry.synonyms || []), ...senseSynonyms]);
    addWordChips(block, "Antonyms:", [...(entry.antonyms || []), ...senseAntonyms]);
    body.appendChild(block);
  }
  const source = element("div", "result-source");
  const link = element("a", "", "Free Dictionary API response ↗");
  link.href = API_BASE_URL + encodeURIComponent(word);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  source.append(document.createTextNode("Source: "), link);
  card.append(header, body, source);
  messageArea.replaceChildren(card);
}

function renderHistory() {
  historyList.replaceChildren();
  if (!recentSearches.length) {
    historyList.appendChild(element("p", "muted-text", "Words you search for will appear here."));
    return;
  }
  recentSearches.forEach(word => {
    const button = element("button", "history-item", word);
    button.type = "button";
    button.addEventListener("click", () => searchWord(word));
    historyList.appendChild(button);
  });
}

function updateHistory(word) {
  const normalized = word.toLowerCase();
  recentSearches = [normalized, ...recentSearches.filter(item => item !== normalized)].slice(0, 8);
  renderHistory();
}

async function searchWord(rawWord) {
  const word = String(rawWord || "").trim();
  if (!word) {
    showMessage("Enter a word first", "Type an English word in the search box.", "error");
    wordInput.focus();
    return;
  }
  if (!/^[a-zA-Z]+(?:[' -][a-zA-Z]+)*$/.test(word) || word.length > 60) {
    showMessage("Please check your input", "Use English letters, spaces, apostrophes, or hyphens only (up to 60 characters).", "error");
    wordInput.focus();
    return;
  }
  if (activeRequest) activeRequest.abort();
  const controller = new AbortController();
  activeRequest = controller;
  wordInput.value = word;
  showLoading(word);
  try {
    const response = await fetch(API_BASE_URL + encodeURIComponent(word.toLowerCase()), { signal: controller.signal });
    if (response.status === 404) {
      showMessage("Word not found", `No dictionary entry found for “${word}”.`, "error");
      return;
    }
    if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.entries) || !data.entries.length) {
      showMessage("Word not found", `No dictionary entry found for “${word}”. Try another spelling.`, "error");
      return;
    }
    renderEntry(data);
    updateHistory(word);
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error("Dictionary lookup failed:", error);
    showMessage("Could not fetch data", "Check your internet connection and try again. The dictionary service may be temporarily unavailable.", "error");
  } finally {
    if (activeRequest === controller) activeRequest = null;
  }
}

searchForm.addEventListener("submit", event => {
  event.preventDefault();
  searchWord(wordInput.value);
});
quickSearchButtons.forEach(button => button.addEventListener("click", () => searchWord(button.dataset.word)));
clearHistoryButton.addEventListener("click", () => {
  recentSearches = [];
  renderHistory();
});
renderHistory();