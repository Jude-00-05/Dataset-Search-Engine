const SOURCE_TRUST_BONUS = {
  huggingface: 4,
  kaggle: 3,
  uci: 3,
  datagov: 2,
  github: 1,
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 8000;

let deepSearchCache = {};

function canonicalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch (error) {
    return String(url || "").trim();
  }
}

function normalizeList(values) {
  if (!values) {
    return [];
  }

  const asArray = Array.isArray(values) ? values : [values];
  const output = [];
  const seen = new Set();

  for (const raw of asArray) {
    if (raw === null || raw === undefined) {
      continue;
    }

    const value = String(raw).trim();
    if (!value) {
      continue;
    }

    const lowered = value.toLowerCase();
    if (seen.has(lowered)) {
      continue;
    }

    seen.add(lowered);
    output.push(value);
  }

  return output;
}

function tokenize(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

function titleSimilarity(left, right) {
  const a = String(left || "").toLowerCase().trim();
  const b = String(right || "").toLowerCase().trim();
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }

  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  if (longer.includes(shorter) && shorter.length >= 8) {
    return shorter.length / longer.length;
  }
  return 0;
}

function normalizeDeepResult(source, payload) {
  return {
    id: String(payload.id || `${source}:${payload.title || payload.url || "dataset"}`),
    title: String(payload.title || "Untitled dataset").trim(),
    description: String(payload.description || "").trim(),
    source,
    url: canonicalizeUrl(payload.url || ""),
    tags: normalizeList(payload.tags),
    task_types: normalizeList(payload.task_types),
    formats: normalizeList(payload.formats),
    license: String(payload.license || "Unknown"),
    size: String(payload.size || "Unknown"),
    downloads: Number(payload.downloads || 0),
    last_updated: String(payload.last_updated || ""),
    language: String(payload.language || "Unknown"),
    deep: true,
    score: 0,
  };
}

function computeDeepScore(query, dataset) {
  const queryTokens = tokenize(query);
  const title = String(dataset.title || "").toLowerCase();
  const description = String(dataset.description || "").toLowerCase();
  const tags = (dataset.tags || []).map((tag) => String(tag).toLowerCase());
  const taskTypes = (dataset.task_types || []).map((task) => String(task).toLowerCase());

  let score = 0;
  const joinedQuery = query.trim().toLowerCase();

  if (joinedQuery && title.includes(joinedQuery)) {
    score += 14;
  }

  for (const token of queryTokens) {
    if (title.includes(token)) {
      score += 5;
    }
    if (tags.some((tag) => tag.includes(token))) {
      score += 3;
    }
    if (taskTypes.some((task) => task.includes(token))) {
      score += 3;
    }
    if (description.includes(token)) {
      score += 1;
    }
  }

  score += SOURCE_TRUST_BONUS[dataset.source] || 0;
  score += Math.min(Math.log10((dataset.downloads || 0) + 1), 4);
  return Number(score.toFixed(2));
}

function dedupeDeepResults(results) {
  const deduped = [];

  for (const candidate of results) {
    const duplicate = deduped.find((existing) => {
      if (candidate.url && existing.url && candidate.url === existing.url) {
        return true;
      }
      if (candidate.source === existing.source && candidate.id === existing.id) {
        return true;
      }
      return titleSimilarity(candidate.title, existing.title) >= 0.95;
    });

    if (!duplicate) {
      deduped.push(candidate);
      continue;
    }

    if ((candidate.score || 0) > (duplicate.score || 0)) {
      Object.assign(duplicate, candidate);
    }
  }

  return deduped;
}

async function requestJson(url, options = {}, timeoutMs = SOURCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "DatasetSearchEngine/1.0",
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function requestText(url, options = {}, timeoutMs = SOURCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "DatasetSearchEngine/1.0",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function searchHuggingFace(query) {
  const params = new URLSearchParams({
    search: query,
    limit: "20",
    full: "true",
  });
  const payload = await requestJson(`https://huggingface.co/api/datasets?${params.toString()}`);
  return (payload || []).map((item) =>
    normalizeDeepResult("huggingface", {
      id: item.id,
      title: item.cardData?.pretty_name || item.id?.split("/").pop()?.replace(/[_-]+/g, " "),
      description: item.description || item.cardData?.description,
      url: item.id ? `https://huggingface.co/datasets/${item.id}` : "",
      tags: item.tags || [],
      task_types: item.cardData?.task_categories || [],
      formats: item.tags?.filter((tag) =>
        ["csv", "json", "parquet", "image", "audio", "text"].includes(String(tag).toLowerCase())
      ),
      license: item.cardData?.license,
      downloads: item.downloads,
      last_updated: String(item.lastModified || "").slice(0, 10),
      language: Array.isArray(item.cardData?.language) ? item.cardData.language[0] : item.cardData?.language,
    })
  );
}

async function searchGitHub(query) {
  const headers = {};
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const params = new URLSearchParams({
    q: `${query} dataset in:name,description,readme`,
    per_page: "15",
  });
  const payload = await requestJson(`https://api.github.com/search/repositories?${params.toString()}`, { headers });
  const items = payload.items || [];

  const keywords = ["dataset", "datasets", "corpus", "benchmark", "csv", "json", "parquet", "tsv"];
  return items
    .filter((item) => {
      const text = `${item.name || ""} ${item.description || ""} ${(item.topics || []).join(" ")}`.toLowerCase();
      const keywordSignal = keywords.some((keyword) => text.includes(keyword));
      const starSignal = Number(item.stargazers_count || 0) >= 5;
      return keywordSignal && starSignal;
    })
    .map((item) =>
      normalizeDeepResult("github", {
        id: item.full_name,
        title: item.name,
        description: item.description,
        url: item.html_url,
        tags: item.topics || [],
        task_types: ["dataset", "repository"],
        formats:
          item.topics?.filter((tag) => ["csv", "json", "parquet", "tsv"].includes(String(tag).toLowerCase())) || [],
        license: item.license?.spdx_id,
        downloads: item.stargazers_count,
        last_updated: String(item.updated_at || "").slice(0, 10),
        language: item.language,
      })
    );
}

async function searchDataGov(query) {
  const params = new URLSearchParams({
    q: query,
    rows: "20",
  });
  const payload = await requestJson(`https://catalog.data.gov/api/3/action/package_search?${params.toString()}`);
  return (payload.result?.results || []).map((item) =>
    normalizeDeepResult("datagov", {
      id: item.id,
      title: item.title,
      description: item.notes,
      url: item.name ? `https://catalog.data.gov/dataset/${item.name}` : "",
      tags: (item.tags || []).map((tag) => tag.display_name),
      task_types: ["open-data", "analysis"],
      formats: (item.resources || []).map((resource) => resource.format).filter(Boolean),
      license: item.license_title,
      last_updated: String(item.metadata_modified || "").slice(0, 10),
      language: "English",
    })
  );
}

async function searchUci(query) {
  const params = new URLSearchParams({ search: query });
  const responseText = await requestText(`https://archive.ics.uci.edu/datasets?${params.toString()}`);
  const matches = [...responseText.matchAll(/\/dataset\/(\d+)\/([^"'<> ]+)/g)];
  return matches.slice(0, 10).map((match) =>
    normalizeDeepResult("uci", {
      id: match[1],
      title: decodeURIComponent(match[2]).replace(/[+_-]+/g, " "),
      description: `Live result from the UCI Machine Learning Repository for query "${query}".`,
      url: `https://archive.ics.uci.edu/dataset/${match[1]}/${match[2]}`,
      task_types: ["dataset"],
      formats: ["csv"],
      license: "Unknown",
    })
  );
}

async function searchKaggle(query) {
  const ownerNameMap = {
    "mental health csv": "osmi/mental-health-in-tech-survey",
    "fresh vs rotten fruits": "sriramr/fruits-fresh-and-rotten-for-classification",
    "banana leaf disease image dataset": "debanga/fallarmyworm-leaf-image-dataset",
    "indian traffic dataset": "anandmahindra/indian-traffic-sign-dataset",
    "image classification datasets": "salader/dogs-vs-cats",
  };

  const mappedReference = ownerNameMap[query.trim().toLowerCase()];
  if (!mappedReference) {
    return [];
  }

  return [
    normalizeDeepResult("kaggle", {
      id: mappedReference,
      title: mappedReference.split("/").pop().replace(/[-_]+/g, " "),
      description: `Live mapped Kaggle result for query "${query}". Configure Kaggle credentials for broader coverage.`,
      url: `https://www.kaggle.com/datasets/${mappedReference}`,
      tags: ["kaggle", "dataset"],
      task_types: ["dataset"],
      formats: ["csv", "zip"],
      license: "Unknown",
    }),
  ];
}

async function withSourceTimeout(source, query) {
  return Promise.race([
    source.search(query),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${SOURCE_TIMEOUT_MS}ms`)), SOURCE_TIMEOUT_MS);
    }),
  ]);
}

const liveSources = [
  { name: "huggingface", search: searchHuggingFace },
  { name: "kaggle", search: searchKaggle },
  { name: "github", search: searchGitHub },
  { name: "uci", search: searchUci },
  { name: "datagov", search: searchDataGov },
];

function trimDeepCache(maxEntries = 100) {
  const keys = Object.keys(deepSearchCache);
  if (keys.length <= maxEntries) {
    return;
  }

  keys
    .sort((left, right) => deepSearchCache[left].timestamp - deepSearchCache[right].timestamp)
    .slice(0, keys.length - maxEntries)
    .forEach((key) => {
      delete deepSearchCache[key];
    });
}

export async function deepSearchDatasets(query) {
  const cacheKey = query.trim().toLowerCase();
  const cached = deepSearchCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { ...cached.payload, cached: true };
  }

  const settled = await Promise.allSettled(
    liveSources.map(async (source) => {
      const startedAt = Date.now();
      const results = await withSourceTimeout(source, query);
      console.log(`[deep-search] ${source.name}: ${results.length} results in ${Date.now() - startedAt}ms`);
      return { source: source.name, results };
    })
  );

  const aggregated = [];
  const sourceStatus = [];

  for (const [index, result] of settled.entries()) {
    const sourceName = liveSources[index].name;
    if (result.status === "fulfilled") {
      sourceStatus.push({
        source: sourceName,
        ok: true,
        count: result.value.results.length,
      });
      aggregated.push(...result.value.results);
    } else {
      console.warn(`[deep-search] source failed: ${sourceName}`, result.reason);
      sourceStatus.push({
        source: sourceName,
        ok: false,
        count: 0,
        error: String(result.reason?.message || result.reason || "Unknown error"),
      });
    }
  }

  const scored = aggregated
    .filter((item) => item.title && item.url)
    .map((item) => ({
      ...item,
      score: computeDeepScore(query, item),
      deep: true,
    }));

  const deduped = dedupeDeepResults(scored).sort((left, right) => {
    if ((right.score || 0) !== (left.score || 0)) {
      return (right.score || 0) - (left.score || 0);
    }
    return (right.downloads || 0) - (left.downloads || 0);
  });

  const payload = {
    query,
    total: deduped.length,
    results: deduped.slice(0, 20),
    sources: sourceStatus,
    cached: false,
  };

  deepSearchCache[cacheKey] = {
    timestamp: Date.now(),
    payload,
  };
  trimDeepCache();
  return payload;
}
