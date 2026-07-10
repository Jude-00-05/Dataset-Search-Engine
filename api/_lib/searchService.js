import fs from "fs";
import path from "path";
import natural from "natural";

const DATASETS_PATH = path.join(process.cwd(), "data", "merged_datasets.json");
const INDEX_PATH = path.join(process.cwd(), "data", "inverted_index.json");
const STOPWORDS_PATH = path.join(process.cwd(), "data", "stopwords.txt");

const SEARCH_FIELDS = ["title", "description", "tags", "task_types", "formats"];
const FIELD_WEIGHTS = {
  title: 3,
  tags: 2,
  task_types: 2,
  description: 1,
  formats: 1,
};
const GENERIC_QUERY_TERMS = new Set(["dataset", "datasets", "data", "file", "files"]);
const EXPLICIT_FORMAT_TERMS = new Set(["csv", "json", "parquet", "zip", "tsv"]);
const PHRASE_BOOSTS = {
  title: 28,
  tags: 22,
  description: 16,
};
const TERM_BOOSTS = {
  title: 6,
  tags: 5,
  task_types: 4,
  formats: 4,
  description: 1.5,
};
const SOURCE_INTENT_WEIGHTS = {
  kaggle: 2.5,
  huggingface: 2.5,
  uci: 1.8,
  openml: 1.8,
  mendeley: 1.5,
  github: 0.5,
  datagov: -0.5,
};
const MODALITY_KEYWORDS = {
  tabular: ["tabular", "table", "spreadsheet", "csv", "parquet", "excel", "rows", "columns"],
  text: ["text", "nlp", "language", "jsonl", "document", "corpus", "qa", "question-answering"],
  image: ["image", "images", "vision", "imagefolder", "object-detection", "image-classification"],
  audio: ["audio", "speech", "wav", "mp3", "sound", "voice"],
  video: ["video", "videos", "mp4", "action-recognition"],
  geospatial: ["geospatial", "geo", "gis", "map", "location", "latitude", "longitude"],
  time_series: ["time-series", "time series", "temporal", "forecasting", "sensor", "monitoring"],
  code: ["code", "programming", "source-code", "python", "javascript"],
};
const LICENSE_GROUPS = {
  open: ["mit", "apache", "bsd", "cc0", "creative commons", "cc-by", "odc", "open"],
  commercial_friendly: ["mit", "apache", "bsd", "cc0", "cc-by", "creative commons attribution"],
  research: ["research", "academic", "non-commercial", "noncommercial", "cc-by-nc"],
  restrictive: ["gpl", "agpl", "lgpl", "sharealike", "cc-by-sa"],
};
const SYNONYM_PHRASES = {
  ml: ["machine learning"],
  ai: ["artificial intelligence"],
  nlp: ["natural language processing"],
  cv: ["computer vision"],
  dl: ["deep learning"],
  nn: ["neural network"],
  rnn: ["recurrent neural network"],
  cnn: ["convolutional neural network"],
  gan: ["generative adversarial network"],
  lstm: ["long short term memory"],
  bert: ["transformer", "language model"],
  db: ["database"],
  sql: ["structured query language", "database"],
  nosql: ["database"],
  api: ["application programming interface"],
  ui: ["user interface"],
  ux: ["user experience"],
  "machine learning": ["ml"],
  "artificial intelligence": ["ai"],
  "natural language processing": ["nlp"],
  "computer vision": ["cv", "image classification"],
  "deep learning": ["dl", "neural network"],
};
const INTENT_PROFILES = [
  {
    name: "mental_health",
    triggers: [
      "mental health",
      "depression",
      "anxiety",
      "stress",
      "wellbeing",
      "psychology",
      "behavioral health",
      "behavioural health",
    ],
    expansionTerms: [
      "depression",
      "anxiety",
      "stress",
      "wellbeing",
      "psychology",
      "behavioral health",
      "behavioural health",
      "questionnaire",
      "survey",
      "student mental health",
      "suicide",
      "therapy",
      "wellness",
    ],
    negativeTerms: [
      "dispatch",
      "911",
      "ems",
      "fire",
      "county",
      "census",
      "tract",
      "shortage",
      "hpsa",
      "address",
      "service area",
      "provider",
      "infrastructure",
      "facility",
      "administrative",
      "public safety",
      "emergency response",
    ],
    sourceAdjustments: {
      kaggle: 4,
      huggingface: 4,
      uci: 3,
      github: 1,
      datagov: -3,
    },
  },
];

let dataStore = null;
let queryCache = {};

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function readStopwords() {
  try {
    return new Set(
      fs
        .readFileSync(STOPWORDS_PATH, "utf8")
        .split(/\r?\n/)
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean)
    );
  } catch (error) {
    return new Set();
  }
}

function normalizeList(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function joinFieldValue(value) {
  return normalizeList(value).join(" ");
}

function rawTokens(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

function stemToken(token) {
  if (token.length <= 3) {
    return token;
  }
  return natural.PorterStemmer.stem(token);
}

function tokenize(text, stopwords) {
  return rawTokens(text)
    .filter((token) => !stopwords.has(token))
    .map((token) => stemToken(token));
}

function getSourceKey(dataset) {
  return String(dataset.source || "").toLowerCase();
}

function normalizeKey(value) {
  return (
    String(value || "unknown")
      .trim()
      .toLowerCase()
      .replace(/[\s/]+/g, "-")
      .replace(/[^a-z0-9._-]+/g, "")
      .replace(/-+/g, "-") || "unknown"
  );
}

function normalizeLanguage(value, tags = []) {
  const explicit = String(value || "").trim();
  const tagLanguage = normalizeList(tags)
    .map((tag) => String(tag).toLowerCase())
    .find((tag) => tag.startsWith("language:"));
  const language = explicit && explicit.toLowerCase() !== "unknown" ? explicit : tagLanguage?.split(":")[1];

  if (!language) {
    return "unknown";
  }

  const normalized = language.trim().toLowerCase();
  const aliases = {
    english: "en",
    multilingual: "multilingual",
    multi: "multilingual",
    japanese: "ja",
    korean: "ko",
    chinese: "zh",
    spanish: "es",
    french: "fr",
    german: "de",
    hindi: "hi",
  };

  return aliases[normalized] || normalized;
}

function normalizeLicenseGroups(value) {
  const text = joinFieldValue(value).toLowerCase();
  if (!text || text === "unknown" || text.includes("not specified")) {
    return ["unknown"];
  }

  const groups = Object.entries(LICENSE_GROUPS)
    .filter(([, signals]) => signals.some((signal) => text.includes(signal)))
    .map(([group]) => group);

  return groups.length ? groups : [normalizeKey(text)];
}

function normalizeModalityKey(value) {
  const key = normalizeKey(value);
  const aliases = {
    "time-series": "time_series",
    timeseries: "time_series",
    table: "tabular",
    images: "image",
    speech: "audio",
  };

  return aliases[key] || key;
}

function inferModalities(dataset) {
  const tags = normalizeList(dataset.tags).map((tag) => String(tag).toLowerCase());
  const explicit = tags
    .filter((tag) => tag.startsWith("modality:"))
    .map((tag) => normalizeModalityKey(tag.split(":")[1]));
  const formats = normalizeList(dataset.formats).map((format) => String(format).toLowerCase());
  const tasks = normalizeList(dataset.task_types).map((task) => String(task).toLowerCase());
  const text = `${dataset.title || ""} ${dataset.description || ""} ${tags.join(" ")} ${formats.join(" ")} ${tasks.join(
    " "
  )}`.toLowerCase();
  const modalities = new Set(explicit);

  Object.entries(MODALITY_KEYWORDS).forEach(([modality, signals]) => {
    if (signals.some((signal) => text.includes(signal))) {
      modalities.add(normalizeModalityKey(modality));
    }
  });

  return modalities.size ? Array.from(modalities) : ["unknown"];
}

function parseSizeBucket(dataset) {
  const tags = normalizeList(dataset.tags).map((tag) => String(tag).toLowerCase());
  const sizeTag = tags.find((tag) => tag.startsWith("size_categories:"));
  if (sizeTag) {
    const category = sizeTag.split(":")[1] || "";
    if (category.includes("n<1k") || category.includes("<1k")) {
      return "tiny";
    }
    if (category.includes("1k<n<10k") || category.includes("1k<n<100k")) {
      return "small";
    }
    if (category.includes("10k<n<100k") || category.includes("100k<n<1m")) {
      return "medium";
    }
    if (category.includes("1m<n") || category.includes("10m<n") || category.includes("1b<n")) {
      return "large";
    }
  }

  const raw = String(dataset.size || "").toLowerCase();
  if (!raw || raw === "unknown") {
    return "unknown";
  }

  const number = Number((raw.match(/[\d.]+/) || [0])[0]);
  if (!number) {
    return "unknown";
  }
  if (raw.includes("kb") || raw.includes("rows") || number < 100) {
    return "small";
  }
  if (raw.includes("mb") && number < 500) {
    return "medium";
  }
  if (raw.includes("gb") || raw.includes("tb") || number >= 500) {
    return "large";
  }
  return "unknown";
}

function getUpdatedBucket(value) {
  const timestamp = Date.parse(value);
  if (!timestamp) {
    return "unknown";
  }

  const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
  if (ageDays <= 365) {
    return "last_year";
  }
  if (ageDays <= 365 * 3) {
    return "last_3_years";
  }
  return "older";
}

function createTermSet(tokens) {
  return new Set(tokens.filter(Boolean));
}

function isStoredIndexUsable(storedIndex, datasets) {
  return Boolean(
    storedIndex &&
      storedIndex.terms &&
      Object.keys(storedIndex.terms).length > 0 &&
      Number(storedIndex.metadata?.document_count || 0) === datasets.length
  );
}

function buildRuntimeIndex(datasets, stopwords) {
  const terms = {};

  datasets.forEach((dataset, docId) => {
    SEARCH_FIELDS.forEach((field) => {
      const text = joinFieldValue(dataset[field]);
      const counts = {};

      tokenize(text, stopwords).forEach((token) => {
        counts[token] = (counts[token] || 0) + 1;
      });

      Object.entries(counts).forEach(([token, count]) => {
        if (!terms[token]) {
          terms[token] = Object.fromEntries(SEARCH_FIELDS.map((name) => [name, {}]));
        }
        terms[token][field][String(docId)] = count;
      });
    });
  });

  return {
    metadata: {
      document_count: datasets.length,
      search_fields: SEARCH_FIELDS,
    },
    terms,
  };
}

function precomputeDataset(dataset, stopwords) {
  const titleText = joinFieldValue(dataset.title);
  const tagsText = joinFieldValue(dataset.tags);
  const taskTypesText = joinFieldValue(dataset.task_types);
  const formatsText = joinFieldValue(dataset.formats);
  const descriptionText = joinFieldValue(dataset.description);

  return {
    source: getSourceKey(dataset),
    formats: normalizeList(dataset.formats).map((format) => String(format).toLowerCase()),
    tasks: normalizeList(dataset.task_types).map((task) => String(task).toLowerCase()),
    languages: [normalizeLanguage(dataset.language, dataset.tags)],
    licenses: normalizeLicenseGroups(dataset.license),
    modalities: inferModalities(dataset),
    sizes: [parseSizeBucket(dataset)],
    updated: [getUpdatedBucket(dataset.last_updated)],
    text: {
      title: titleText.toLowerCase(),
      tags: tagsText.toLowerCase(),
      task_types: taskTypesText.toLowerCase(),
      formats: formatsText.toLowerCase(),
      description: descriptionText.toLowerCase(),
    },
    tokens: {
      title: createTermSet(tokenize(titleText, stopwords)),
      tags: createTermSet(tokenize(tagsText, stopwords)),
      task_types: createTermSet(tokenize(taskTypesText, stopwords)),
      formats: createTermSet(tokenize(formatsText, stopwords)),
      description: createTermSet(tokenize(descriptionText, stopwords)),
    },
  };
}

function hydrateDatasets(datasets, stopwords) {
  return datasets.map((dataset) => ({
    ...dataset,
    _search: precomputeDataset(dataset, stopwords),
  }));
}

function buildPrefixMap(index) {
  const prefixMap = {};

  Object.keys(index.terms || {}).forEach((term) => {
    const maxLength = Math.min(term.length, 12);
    for (let length = 3; length <= maxLength; length += 1) {
      const prefix = term.slice(0, length);
      if (!prefixMap[prefix]) {
        prefixMap[prefix] = [];
      }
      prefixMap[prefix].push(term);
    }
  });

  return prefixMap;
}

function buildFilterIndexes(datasets) {
  const sources = new Map();
  const formats = new Map();
  const tasks = new Map();
  const languages = new Map();
  const licenses = new Map();
  const modalities = new Map();
  const sizes = new Map();
  const updated = new Map();

  datasets.forEach((dataset, index) => {
    const docId = String(index);
    const addToMap = (map, key) => {
      if (!key) {
        return;
      }
      if (!map.has(key)) {
        map.set(key, new Set());
      }
      map.get(key).add(docId);
    };

    addToMap(sources, dataset._search.source);
    dataset._search.formats.forEach((format) => addToMap(formats, format));
    dataset._search.tasks.forEach((task) => addToMap(tasks, task));
    dataset._search.languages.forEach((language) => addToMap(languages, language));
    dataset._search.licenses.forEach((license) => addToMap(licenses, license));
    dataset._search.modalities.forEach((modality) => addToMap(modalities, modality));
    dataset._search.sizes.forEach((size) => addToMap(sizes, size));
    dataset._search.updated.forEach((bucket) => addToMap(updated, bucket));
  });

  return { sources, formats, tasks, languages, licenses, modalities, sizes, updated };
}

function loadDataStore() {
  const rawDatasets = readJson(DATASETS_PATH, []);
  const stopwords = readStopwords();
  const storedIndex = readJson(INDEX_PATH, { metadata: {}, terms: {} });
  const index = isStoredIndexUsable(storedIndex, rawDatasets)
    ? storedIndex
    : buildRuntimeIndex(rawDatasets, stopwords);
  const datasets = hydrateDatasets(rawDatasets, stopwords);

  return {
    datasets,
    stopwords,
    index,
    prefixMap: buildPrefixMap(index),
    filterIndexes: buildFilterIndexes(datasets),
  };
}

function loadData() {
  if (!dataStore) {
    dataStore = loadDataStore();
  }
  return dataStore;
}

function toArrayParam(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
  }
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildFilters(queryParams = {}) {
  return {
    sources: toArrayParam(queryParams.sources).map((value) => value.toLowerCase()),
    formats: toArrayParam(queryParams.formats).map((value) => value.toLowerCase()),
    tasks: toArrayParam(queryParams.tasks).map((value) => value.toLowerCase()),
    languages: toArrayParam(queryParams.languages).map((value) => value.toLowerCase()),
    licenses: toArrayParam(queryParams.licenses).map((value) => value.toLowerCase()),
    modalities: toArrayParam(queryParams.modalities).map((value) => value.toLowerCase()),
    sizes: toArrayParam(queryParams.sizes).map((value) => value.toLowerCase()),
    updated: toArrayParam(queryParams.updated).map((value) => value.toLowerCase()),
  };
}

function intersectSets(left, right) {
  const [small, large] = left.size < right.size ? [left, right] : [right, left];
  const output = new Set();
  for (const item of small) {
    if (large.has(item)) {
      output.add(item);
    }
  }
  return output;
}

function unionLookupValues(indexMap, values) {
  if (values.length === 0) {
    return null;
  }

  const output = new Set();
  values.forEach((value) => {
    const ids = indexMap.get(value);
    if (ids) {
      ids.forEach((id) => output.add(id));
    }
  });
  return output;
}

function getFilterCandidateIds(filters, filterIndexes) {
  const groups = [
    unionLookupValues(filterIndexes.sources, filters.sources),
    unionLookupValues(filterIndexes.formats, filters.formats),
    unionLookupValues(filterIndexes.tasks, filters.tasks),
    unionLookupValues(filterIndexes.languages, filters.languages),
    unionLookupValues(filterIndexes.licenses, filters.licenses),
    unionLookupValues(filterIndexes.modalities, filters.modalities),
    unionLookupValues(filterIndexes.sizes, filters.sizes),
    unionLookupValues(filterIndexes.updated, filters.updated),
  ].filter(Boolean);

  if (groups.length === 0) {
    return null;
  }

  return groups.sort((left, right) => left.size - right.size).reduce((current, next) => intersectSets(current, next));
}

function matchesFilters(dataset, filters) {
  const sourceMatch = filters.sources.length === 0 || filters.sources.includes(dataset._search.source);
  const formatMatch =
    filters.formats.length === 0 || dataset._search.formats.some((format) => filters.formats.includes(format));
  const taskMatch = filters.tasks.length === 0 || dataset._search.tasks.some((task) => filters.tasks.includes(task));
  const languageMatch =
    filters.languages.length === 0 ||
    dataset._search.languages.some((language) => filters.languages.includes(language));
  const licenseMatch =
    filters.licenses.length === 0 || dataset._search.licenses.some((license) => filters.licenses.includes(license));
  const modalityMatch =
    filters.modalities.length === 0 ||
    dataset._search.modalities.some((modality) => filters.modalities.includes(modality));
  const sizeMatch = filters.sizes.length === 0 || dataset._search.sizes.some((size) => filters.sizes.includes(size));
  const updatedMatch =
    filters.updated.length === 0 || dataset._search.updated.some((bucket) => filters.updated.includes(bucket));

  return (
    sourceMatch &&
    formatMatch &&
    taskMatch &&
    languageMatch &&
    licenseMatch &&
    modalityMatch &&
    sizeMatch &&
    updatedMatch
  );
}

function makeWeightedTerm(raw, weight = 1) {
  return {
    raw,
    stemmed: stemToken(raw),
    weight,
    isFormat: EXPLICIT_FORMAT_TERMS.has(raw),
  };
}

function expandQueryWithSynonyms(query, raw) {
  const loweredQuery = query.trim().toLowerCase();
  const expansions = [];

  raw.forEach((token) => {
    (SYNONYM_PHRASES[token] || []).forEach((phrase) => expansions.push({ phrase, weight: 0.7 }));
  });

  Object.entries(SYNONYM_PHRASES).forEach(([trigger, phrases]) => {
    if (!trigger.includes(" ") || !loweredQuery.includes(trigger)) {
      return;
    }
    phrases.forEach((phrase) => expansions.push({ phrase, weight: 0.7 }));
  });

  return expansions;
}

function buildPhrases(rawWords, synonymExpansions) {
  const normalizedWords = rawWords.filter((token) => !GENERIC_QUERY_TERMS.has(token));
  const phrases = new Set();
  const addPhrase = (parts) => {
    const phrase = parts.join(" ").trim();
    if (phrase.split(" ").length > 1) {
      phrases.add(phrase);
    }
  };

  addPhrase(normalizedWords);
  for (let size = 2; size <= 3; size += 1) {
    for (let index = 0; index <= normalizedWords.length - size; index += 1) {
      addPhrase(normalizedWords.slice(index, index + size));
    }
  }
  synonymExpansions.forEach((expansion) => addPhrase(rawTokens(expansion.phrase)));

  return Array.from(phrases);
}

function buildQuerySignals(query, stopwords) {
  const raw = rawTokens(query);
  const weightedTermsByStem = new Map();

  raw.forEach((token) => {
    if (stopwords.has(token)) {
      return;
    }
    const weight = GENERIC_QUERY_TERMS.has(token) ? 0.2 : 1;
    const term = makeWeightedTerm(token, weight);
    const existing = weightedTermsByStem.get(term.stemmed);
    if (!existing || existing.weight < term.weight) {
      weightedTermsByStem.set(term.stemmed, term);
    }
  });

  const synonymExpansions = expandQueryWithSynonyms(query, raw);
  synonymExpansions.forEach((expansion) => {
    tokenize(expansion.phrase, stopwords).forEach((stemmed) => {
      if (!weightedTermsByStem.has(stemmed)) {
        weightedTermsByStem.set(stemmed, {
          raw: stemmed,
          stemmed,
          weight: expansion.weight,
          isFormat: EXPLICIT_FORMAT_TERMS.has(stemmed),
        });
      }
    });
  });

  const phrases = buildPhrases(raw, synonymExpansions);
  const fullPhrase = raw.filter((token) => !GENERIC_QUERY_TERMS.has(token)).join(" ").trim();
  const loweredQuery = query.trim().toLowerCase();
  const activeIntents = INTENT_PROFILES.filter((profile) =>
    profile.triggers.some((trigger) => loweredQuery.includes(trigger))
  );

  return { weightedTerms: Array.from(weightedTermsByStem.values()), phrases, fullPhrase, activeIntents };
}

function getPostingDocIds(postings) {
  const ids = new Set();
  Object.keys(FIELD_WEIGHTS).forEach((field) => {
    Object.keys(postings[field] || {}).forEach((docId) => ids.add(docId));
  });
  return ids;
}

function getCandidateIds(tokens, index, prefixMap) {
  const ids = new Set();

  tokens.forEach((token) => {
    const matchingTerms = new Set();
    if (index.terms[token]) {
      matchingTerms.add(token);
    }
    if (token.length >= 4) {
      (prefixMap[token] || []).forEach((term) => matchingTerms.add(term));
    }

    matchingTerms.forEach((term) => {
      getPostingDocIds(index.terms[term]).forEach((docId) => ids.add(docId));
    });
  });

  return ids;
}

function scoreFieldMatchesFromTokens(tokenSet, terms, baseBoost) {
  let score = 0;
  let matchedSpecificTerms = 0;

  for (const term of terms) {
    if (!term.stemmed || !tokenSet.has(term.stemmed)) {
      continue;
    }
    score += baseBoost * term.weight;
    if (term.weight >= 1) {
      matchedSpecificTerms += 1;
    }
  }

  return { score, matchedSpecificTerms };
}

function scorePhraseMatches(lowerText, phrases, boost) {
  let score = 0;
  let matches = 0;

  for (const phrase of phrases) {
    if (phrase && lowerText.includes(phrase)) {
      score += boost;
      matches += 1;
    }
  }

  return { score, matches };
}

function scoreIntentExpansion(lowerText, activeIntents) {
  let score = 0;

  for (const profile of activeIntents) {
    for (const term of profile.expansionTerms) {
      if (lowerText.includes(term)) {
        score += term.includes(" ") ? 4.5 : 2;
      }
    }
  }

  return score;
}

function scoreIntentPenalty(lowerText, activeIntents) {
  let penalty = 0;

  for (const profile of activeIntents) {
    for (const term of profile.negativeTerms) {
      if (lowerText.includes(term)) {
        penalty += term.includes(" ") ? 5 : 3;
      }
    }
  }

  return penalty;
}

function scoreDataset(dataset, weightedTerms, phrases, fullPhrase, activeIntents) {
  const search = dataset._search;
  let score = 0;
  let matchedSpecificTerms = 0;

  const titleTerms = scoreFieldMatchesFromTokens(search.tokens.title, weightedTerms, TERM_BOOSTS.title);
  const tagTerms = scoreFieldMatchesFromTokens(search.tokens.tags, weightedTerms, TERM_BOOSTS.tags);
  const taskTerms = scoreFieldMatchesFromTokens(search.tokens.task_types, weightedTerms, TERM_BOOSTS.task_types);
  const formatTerms = scoreFieldMatchesFromTokens(search.tokens.formats, weightedTerms, TERM_BOOSTS.formats);
  const descriptionTerms = scoreFieldMatchesFromTokens(
    search.tokens.description,
    weightedTerms,
    TERM_BOOSTS.description
  );

  score += titleTerms.score + tagTerms.score + taskTerms.score + formatTerms.score + descriptionTerms.score;
  matchedSpecificTerms +=
    titleTerms.matchedSpecificTerms +
    tagTerms.matchedSpecificTerms +
    taskTerms.matchedSpecificTerms +
    formatTerms.matchedSpecificTerms +
    descriptionTerms.matchedSpecificTerms;

  const titlePhrases = scorePhraseMatches(search.text.title, phrases, PHRASE_BOOSTS.title);
  const tagPhrases = scorePhraseMatches(search.text.tags, phrases, PHRASE_BOOSTS.tags);
  const descriptionPhrases = scorePhraseMatches(search.text.description, phrases, PHRASE_BOOSTS.description);

  score += titlePhrases.score + tagPhrases.score + descriptionPhrases.score;

  if (fullPhrase && search.text.title.includes(fullPhrase)) {
    score += 12;
  }

  const requestedFormats = weightedTerms.filter((term) => term.isFormat);
  for (const formatTerm of requestedFormats) {
    if (search.formats.includes(formatTerm.raw)) {
      score += 10;
    } else {
      score -= 2;
    }
  }

  score += scoreIntentExpansion(search.text.title, activeIntents) * 2;
  score += scoreIntentExpansion(search.text.tags, activeIntents) * 1.5;
  score += scoreIntentExpansion(search.text.description, activeIntents);

  score -=
    scoreIntentPenalty(search.text.title, activeIntents) * 1.2 +
    scoreIntentPenalty(search.text.tags, activeIntents) +
    scoreIntentPenalty(search.text.description, activeIntents) * 0.8;

  score += SOURCE_INTENT_WEIGHTS[search.source] || 0;
  for (const profile of activeIntents) {
    score += profile.sourceAdjustments?.[search.source] || 0;
  }

  if (search.source === "datagov" && matchedSpecificTerms < 2 && descriptionPhrases.matches === 0) {
    score -= 3;
  }

  if (
    matchedSpecificTerms === 0 &&
    titlePhrases.matches === 0 &&
    tagPhrases.matches === 0 &&
    descriptionPhrases.matches === 0
  ) {
    score -= 5;
  }

  return Number(score.toFixed(2));
}

function stripRuntimeFields(dataset) {
  const { _search, ...publicDataset } = dataset;
  if (!_search) {
    return publicDataset;
  }

  return {
    ...publicDataset,
    modalities: _search.modalities,
    license_groups: _search.licenses,
    size_group: _search.sizes[0],
    updated_group: _search.updated[0],
  };
}

function collectAvailableFilters(datasets) {
  const sources = {};
  const formats = {};
  const taskTypes = {};
  const languages = {};
  const licenses = {};
  const modalities = {};
  const sizes = {};
  const updated = {};
  const addCount = (target, key) => {
    if (key) {
      target[key] = (target[key] || 0) + 1;
    }
  };

  datasets.forEach((dataset) => {
    const search = dataset._search;
    const publicDataset = search ? stripRuntimeFields(dataset) : dataset;

    addCount(sources, publicDataset.source);
    normalizeList(publicDataset.formats).forEach((format) => addCount(formats, format));
    normalizeList(publicDataset.task_types).forEach((task) => addCount(taskTypes, task));

    if (search) {
      search.languages.forEach((language) => addCount(languages, language));
      search.licenses.forEach((license) => addCount(licenses, license));
      search.modalities.forEach((modality) => addCount(modalities, modality));
      search.sizes.forEach((size) => addCount(sizes, size));
      search.updated.forEach((bucket) => addCount(updated, bucket));
    } else {
      addCount(languages, normalizeLanguage(publicDataset.language, publicDataset.tags));
      normalizeLicenseGroups(publicDataset.license).forEach((license) => addCount(licenses, license));
      normalizeList(publicDataset.modalities).forEach((modality) => addCount(modalities, modality));
      addCount(sizes, publicDataset.size_group || parseSizeBucket(publicDataset));
      addCount(updated, publicDataset.updated_group || getUpdatedBucket(publicDataset.last_updated));
    }
  });

  return { sources, formats, task_types: taskTypes, languages, licenses, modalities, sizes, updated };
}

function limitCacheEntries(maxEntries = 200) {
  const keys = Object.keys(queryCache);
  if (keys.length <= maxEntries) {
    return;
  }

  keys
    .sort((left, right) => queryCache[left].createdAt - queryCache[right].createdAt)
    .slice(0, keys.length - maxEntries)
    .forEach((key) => {
      delete queryCache[key];
    });
}

export function searchDatasets(query, filters) {
  const store = loadData();
  const cacheKey = `${query.trim().toLowerCase()}|${JSON.stringify(filters)}`;
  const cached = queryCache[cacheKey];
  if (cached) {
    return cached.value;
  }

  const { weightedTerms, phrases, fullPhrase, activeIntents } = buildQuerySignals(query, store.stopwords);
  const tokens = weightedTerms.map((term) => term.stemmed).filter(Boolean);
  const filterCandidateIds = getFilterCandidateIds(filters, store.filterIndexes);
  const searchCandidateIds = getCandidateIds(tokens, store.index, store.prefixMap);
  let idsToScore;

  if (searchCandidateIds.size > 0 && filterCandidateIds) {
    idsToScore = Array.from(intersectSets(searchCandidateIds, filterCandidateIds));
  } else if (searchCandidateIds.size > 0) {
    idsToScore = Array.from(searchCandidateIds);
  } else if (filterCandidateIds) {
    idsToScore = Array.from(filterCandidateIds);
  } else {
    idsToScore = store.datasets.map((_, indexValue) => String(indexValue));
  }

  const results = idsToScore
    .map((docId) => {
      const dataset = store.datasets[Number(docId)];
      if (!dataset || !matchesFilters(dataset, filters)) {
        return null;
      }

      const score = scoreDataset(dataset, weightedTerms, phrases, fullPhrase, activeIntents);
      if (score <= 0) {
        return null;
      }

      return {
        ...stripRuntimeFields(dataset),
        score,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return (right.downloads || 0) - (left.downloads || 0);
    });

  queryCache[cacheKey] = {
    createdAt: Date.now(),
    value: results,
  };
  limitCacheEntries();
  return results;
}

export function getDatasets(filters, page = 1, limit = 12) {
  const store = loadData();
  const safeLimit = Math.min(Math.max(Number(limit) || 12, 1), 48);
  const safePage = Math.max(Number(page) || 1, 1);
  const filterCandidateIds = getFilterCandidateIds(filters, store.filterIndexes);
  const filtered = (
    filterCandidateIds
      ? Array.from(filterCandidateIds).map((id) => store.datasets[Number(id)])
      : store.datasets
  )
    .filter((dataset) => dataset && matchesFilters(dataset, filters))
    .map(stripRuntimeFields);
  const sorted = [...filtered].sort((left, right) => (right.downloads || 0) - (left.downloads || 0));
  const start = (safePage - 1) * safeLimit;

  return {
    page: safePage,
    limit: safeLimit,
    total: sorted.length,
    results: sorted.slice(start, start + safeLimit),
    available_filters: collectAvailableFilters(sorted),
  };
}

export function getSearchResponse(query, filters) {
  const store = loadData();
  if (!query) {
    const filterCandidateIds = getFilterCandidateIds(filters, store.filterIndexes);
    const filteredDatasets = (
      filterCandidateIds
        ? Array.from(filterCandidateIds).map((id) => store.datasets[Number(id)])
        : store.datasets
    )
      .filter((dataset) => dataset && matchesFilters(dataset, filters))
      .map(stripRuntimeFields);

    return {
      query,
      total: filteredDatasets.length,
      results: filteredDatasets.slice(0, 20),
      available_filters: collectAvailableFilters(filteredDatasets),
    };
  }

  const results = searchDatasets(query, filters);
  return {
    query,
    total: results.length,
    results: results.slice(0, 20),
    available_filters: collectAvailableFilters(results),
  };
}

export function getSourceStats() {
  const store = loadData();
  const counts = store.datasets.reduce((accumulator, dataset) => {
    accumulator[dataset.source] = (accumulator[dataset.source] || 0) + 1;
    return accumulator;
  }, {});

  return {
    sources: Object.entries(counts).map(([source, count]) => ({ source, count })),
  };
}

export function getHealth() {
  const store = loadData();
  return {
    status: "ok",
    datasets: store.datasets.length,
    indexedTerms: Object.keys(store.index.terms || {}).length,
    queryCacheEntries: Object.keys(queryCache).length,
  };
}
